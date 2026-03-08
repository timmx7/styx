"""
Styx Semantic Cache Service

Checks if a prompt is semantically similar to a cached one using
Qdrant vector search + all-MiniLM-L6-v2 embeddings.
"""

import asyncio
import hashlib
import json
import logging
import os
import time
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from qdrant_client import QdrantClient
from qdrant_client.http.exceptions import UnexpectedResponse
from qdrant_client.models import (
    Distance,
    PointStruct,
    VectorParams,
)
from sentence_transformers import SentenceTransformer

# ─── Config ─────────────────────────────────────────────────────

QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
SIMILARITY_THRESHOLD = float(os.getenv("CACHE_SIMILARITY_THRESHOLD", "0.95"))
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", "86400"))  # 24h
COLLECTION_NAME = "styx_cache"
EMBEDDING_DIM = 384  # all-MiniLM-L6-v2 output dimension

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cache-service")

# ─── App ────────────────────────────────────────────────────────

app = FastAPI(title="Styx Cache Service", version="1.0.0")

@app.on_event("startup")
async def startup_event() -> None:
    logger.info("Warming up Semantic Cache Service...")
    get_model()
    get_qdrant()
    logger.info("Warmup complete.")

# Lazy-loaded globals
_model: SentenceTransformer | None = None
_qdrant: QdrantClient | None = None


def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        logger.info("Loading embedding model: %s", EMBEDDING_MODEL)
        _model = SentenceTransformer(EMBEDDING_MODEL)
        logger.info("Embedding model loaded")
    return _model


def get_qdrant() -> QdrantClient:
    global _qdrant
    if _qdrant is None:
        logger.info("Connecting to Qdrant: %s", QDRANT_URL)
        _qdrant = QdrantClient(url=QDRANT_URL, timeout=10)
        _ensure_collection()
        logger.info("Qdrant connected")
    return _qdrant


def _ensure_collection() -> None:
    """Create the cache collection if it doesn't exist."""
    client = _qdrant  # already set by caller
    assert client is not None
    try:
        client.get_collection(COLLECTION_NAME)
        logger.info("Collection '%s' already exists", COLLECTION_NAME)
    except (UnexpectedResponse, Exception):
        logger.info("Creating collection '%s'", COLLECTION_NAME)
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(
                size=EMBEDDING_DIM,
                distance=Distance.COSINE,
            ),
        )


# ─── Schemas ────────────────────────────────────────────────────


class CacheCheckRequest(BaseModel):
    prompt: str
    project_id: str = ""
    model: str = ""


class CacheCheckResponse(BaseModel):
    hit: bool
    response: dict[str, Any] | None = None
    similarity_score: float = 0.0


class CacheStoreRequest(BaseModel):
    prompt: str
    project_id: str = ""
    model: str = ""
    response: dict[str, Any]


class CacheStoreResponse(BaseModel):
    stored: bool
    point_id: str = ""


# ─── Endpoints ──────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "model": EMBEDDING_MODEL}


@app.post("/cache/check", response_model=CacheCheckResponse)
async def cache_check(req: CacheCheckRequest) -> CacheCheckResponse:
    """Check if a semantically similar prompt exists in cache."""
    if not req.prompt.strip():
        return CacheCheckResponse(hit=False)

    try:
        model = get_model()
        qdrant = get_qdrant()

        # Embed the prompt (offload blocking call to thread pool)
        loop = asyncio.get_running_loop()
        raw_embedding = await loop.run_in_executor(None, model.encode, req.prompt)
        embedding = raw_embedding.tolist()

        # Search for similar vectors
        results = qdrant.search(
            collection_name=COLLECTION_NAME,
            query_vector=embedding,
            limit=1,
            score_threshold=SIMILARITY_THRESHOLD,
        )

        if not results:
            return CacheCheckResponse(hit=False)

        hit = results[0]

        # Check TTL
        stored_at = hit.payload.get("stored_at", 0)
        if time.time() - stored_at > CACHE_TTL_SECONDS:
            logger.debug("Cache hit expired (age=%ds)", time.time() - stored_at)
            return CacheCheckResponse(hit=False)

        # Optional: filter by project_id or model for stricter matching
        if req.project_id and hit.payload.get("project_id") != req.project_id:
            return CacheCheckResponse(hit=False)

        cached_response = json.loads(hit.payload.get("response_json", "{}"))

        logger.info(
            "Cache HIT (score=%.4f, model=%s)",
            hit.score,
            hit.payload.get("model", "?"),
        )

        return CacheCheckResponse(
            hit=True,
            response=cached_response,
            similarity_score=float(hit.score),
        )

    except Exception as e:
        logger.error("Cache check failed: %s", e)
        # On error, just miss — don't block the request
        return CacheCheckResponse(hit=False)


@app.post("/cache/store", response_model=CacheStoreResponse)
async def cache_store(req: CacheStoreRequest) -> CacheStoreResponse:
    """Store a prompt→response pair in the semantic cache."""
    if not req.prompt.strip():
        return CacheStoreResponse(stored=False)

    try:
        model = get_model()
        qdrant = get_qdrant()

        # Embed the prompt (offload blocking call to thread pool)
        loop = asyncio.get_running_loop()
        raw_embedding = await loop.run_in_executor(None, model.encode, req.prompt)
        embedding = raw_embedding.tolist()

        # Create a deterministic point ID from prompt hash
        prompt_hash = hashlib.sha256(req.prompt.encode()).hexdigest()
        # Qdrant uses unsigned 64-bit ints for IDs (or strings with UUID)
        point_id = prompt_hash[:16]  # use as string ID

        response_json = json.dumps(req.response, ensure_ascii=False)

        qdrant.upsert(
            collection_name=COLLECTION_NAME,
            points=[
                PointStruct(
                    id=point_id,
                    vector=embedding,
                    payload={
                        "prompt_hash": prompt_hash,
                        "project_id": req.project_id,
                        "model": req.model,
                        "response_json": response_json,
                        "stored_at": time.time(),
                    },
                )
            ],
        )

        logger.info("Cache STORE (model=%s, project=%s)", req.model, req.project_id)

        return CacheStoreResponse(stored=True, point_id=point_id)

    except Exception as e:
        logger.error("Cache store failed: %s", e)
        return CacheStoreResponse(stored=False)
