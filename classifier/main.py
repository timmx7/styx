"""Styx Classifier Service — Heuristics v1 + ML v2.

Classifies incoming prompts as simple, medium, or complex.
Uses a trained ML model when available, falls back to heuristics.

Runs on :8001, called by the Go router before forwarding.
"""

import logging
import os
import re
from pathlib import Path

import joblib
from fastapi import FastAPI
from pydantic import BaseModel

logger = logging.getLogger("classifier")

app = FastAPI(title="Styx Classifier", version="0.2.0")

# ─── ML Model loading ───────────────────────────────────────────
MODEL_PATH = os.getenv("MODEL_PATH", "/app/model.pkl")
_ml_model = None
_model_info = {"loaded": False, "type": "heuristics-only", "accuracy": None}

try:
    if Path(MODEL_PATH).exists():
        data = joblib.load(MODEL_PATH)
        _ml_model = data["pipeline"]
        _model_info = {
            "loaded": True,
            "type": "tfidf-randomforest",
            "accuracy": data.get("cv_accuracy"),
            "classes": data.get("classes", []),
            "n_samples": data.get("n_samples", 0),
        }
        logger.info(f"ML model loaded from {MODEL_PATH} (accuracy={data.get('cv_accuracy', '?')})")
    else:
        logger.info(f"No ML model found at {MODEL_PATH}, using heuristics only")
except Exception as e:
    logger.warning(f"Failed to load ML model: {e}, using heuristics only")


class ClassifyRequest(BaseModel):
    prompt: str
    max_tokens: int = 0
    has_system_prompt: bool = False


class ClassifyResponse(BaseModel):
    complexity: str  # "simple", "medium", "complex"
    confidence: float
    reason: str
    toxicity: float = 0.0


# ─── Heuristic rules ────────────────────────────────────────────

COMPLEX_KEYWORDS = [
    r"\banalyze\b", r"\banalysis\b", r"\breview\b", r"\baudit\b",
    r"\bcompare\b", r"\bcontrast\b", r"\bevaluate\b", r"\bcritique\b",
    r"\brefactor\b", r"\barchitect\b", r"\bdesign\b", r"\bimplement\b",
    r"\bdebug\b", r"\boptimize\b", r"\bexplain in detail\b",
    r"\blegal\b", r"\bcontract\b", r"\bcompliance\b", r"\bregulat\b",
    r"\bstrateg\b", r"\bframework\b", r"\bmulti-step\b",
    r"\bwrite a full\b", r"\bbuild a\b", r"\bcreate a complete\b",
]

MEDIUM_KEYWORDS = [
    r"\bsummarize\b", r"\bsummary\b", r"\brewrite\b", r"\btranslate\b",
    r"\bconvert\b", r"\bgenerate\b", r"\blist\b", r"\boutline\b",
    r"\bdescribe\b", r"\bexplain\b", r"\bwrite\b", r"\bdraft\b",
    r"\bformat\b", r"\bextract\b", r"\bclassify\b",
]

TOXIC_KEYWORDS = [
    r"\bkill\b", r"\bhack\b", r"\bsteal\b", r"\bmurder\b", r"\battack\b",
    r"\bbypass\b", r"\bexploit\b", r"\bmalware\b", r"\bvirus\b", r"\bphishing\b"
]


def classify_heuristic(req: ClassifyRequest) -> ClassifyResponse:
    """Classify a prompt using heuristic rules."""
    prompt_lower = req.prompt.lower()
    prompt_len = len(req.prompt)
    reasons: list[str] = []
    score = 0

    # Length heuristic
    if prompt_len > 2000:
        score += 3
        reasons.append("long_prompt")
    elif prompt_len > 500:
        score += 1
        reasons.append("medium_prompt")
    elif prompt_len < 100:
        score -= 2
        reasons.append("short_prompt")

    # max_tokens heuristic
    if req.max_tokens > 2000:
        score += 2
        reasons.append("high_max_tokens")
    elif req.max_tokens > 500:
        score += 1
        reasons.append("medium_max_tokens")

    # System prompt
    if req.has_system_prompt:
        score += 1
        reasons.append("has_system_prompt")

    # Keyword matching
    complex_hits = sum(1 for kw in COMPLEX_KEYWORDS if re.search(kw, prompt_lower))
    medium_hits = sum(1 for kw in MEDIUM_KEYWORDS if re.search(kw, prompt_lower))

    if complex_hits >= 2:
        score += 3
        reasons.append(f"complex_keywords({complex_hits})")
    elif complex_hits == 1:
        score += 1
        reasons.append(f"complex_keyword({complex_hits})")

    if medium_hits >= 2:
        score += 1
        reasons.append(f"medium_keywords({medium_hits})")

    # Code detection
    code_indicators = ["```", "def ", "function ", "class ", "import ", "SELECT ", "CREATE TABLE"]
    code_hits = sum(1 for ind in code_indicators if ind in req.prompt)
    if code_hits >= 2:
        score += 2
        reasons.append("contains_code")

    # Simple Q&A
    if req.prompt.strip().endswith("?") and prompt_len < 200:
        score -= 1
        reasons.append("simple_question")

    # Final classification
    if score >= 4:
        complexity = "complex"
        confidence = min(0.95, 0.6 + score * 0.05)
    elif score >= 1:
        complexity = "medium"
        confidence = min(0.90, 0.5 + score * 0.1)
    else:
        complexity = "simple"
        confidence = min(0.95, 0.7 + abs(score) * 0.05)

    toxic_hits = sum(1 for kw in TOXIC_KEYWORDS if re.search(kw, prompt_lower))
    toxicity = min(1.0, toxic_hits * 0.4)

    return ClassifyResponse(
        complexity=complexity,
        confidence=round(confidence, 2),
        reason="heuristic:" + ("+".join(reasons) if reasons else "default_simple"),
        toxicity=toxicity,
    )


def classify_ml(req: ClassifyRequest) -> ClassifyResponse | None:
    """Classify using the ML model. Returns None if model unavailable."""
    if _ml_model is None:
        return None

    try:
        proba = _ml_model.predict_proba([req.prompt])[0]
        classes = _ml_model.classes_
        max_idx = proba.argmax()
        confidence = float(proba[max_idx])
        complexity = classes[max_idx]

        # Only trust ML if confidence is above threshold
        if confidence < 0.5:
            return None

        return ClassifyResponse(
            complexity=complexity,
            confidence=round(confidence, 3),
            reason=f"ml:tfidf-rf(conf={confidence:.3f})",
            toxicity=0.0,
        )
    except Exception as e:
        logger.warning(f"ML classification failed: {e}")
        return None


@app.post("/classify", response_model=ClassifyResponse)
async def classify(req: ClassifyRequest) -> ClassifyResponse:
    # Try ML first
    ml_result = classify_ml(req)
    if ml_result is not None:
        return ml_result
    # Fall back to heuristics
    return classify_heuristic(req)


@app.get("/model-info")
async def model_info():
    return _model_info


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "classifier",
        "version": "0.2.0",
        "ml_model_loaded": _model_info["loaded"],
    }
