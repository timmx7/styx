# ─── Build stage ────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

COPY requirements.txt .
COPY requirements-test.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt \
    && pip install --no-cache-dir --prefix=/install -r requirements-test.txt

# ─── Runtime stage ──────────────────────────────────────────────
FROM python:3.12-slim

# Security: create non-root user
RUN groupadd --gid 1001 appuser && \
    useradd --uid 1001 --gid appuser --shell /bin/false --create-home appuser

WORKDIR /app

ENV PYTHONPATH=/app

# Copy installed dependencies from builder
COPY --from=builder /install /usr/local

# Copy application code
COPY --chown=appuser:appuser . .

# Security: run as non-root user
USER appuser

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
