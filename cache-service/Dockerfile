# ─── Build stage ────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

# Install build dependencies (only in builder stage, not in final image)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Pre-download the embedding model at build time
ENV PYTHONPATH="/install/lib/python3.12/site-packages"
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# ─── Runtime stage ──────────────────────────────────────────────
FROM python:3.12-slim

# Security: create non-root user
RUN groupadd --gid 1001 appuser && \
    useradd --uid 1001 --gid appuser --shell /bin/false --create-home appuser

WORKDIR /app

# Copy installed dependencies from builder (no build-essential here)
COPY --from=builder /install /usr/local

# Copy the pre-downloaded model cache
COPY --from=builder --chown=appuser:appuser /root/.cache/huggingface /home/appuser/.cache/huggingface

# Copy application code
COPY --chown=appuser:appuser . .

# Security: run as non-root user
USER appuser

EXPOSE 8002

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
