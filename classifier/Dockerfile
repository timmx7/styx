# ─── Build stage ────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Copy source and train the ML model during build
COPY . .
ENV PYTHONPATH="/install/lib/python3.12/site-packages"
RUN python train_and_save.py

# ─── Runtime stage ──────────────────────────────────────────────
FROM python:3.12-slim

# Security: create non-root user
RUN groupadd --gid 1001 appuser && \
    useradd --uid 1001 --gid appuser --shell /bin/false --create-home appuser

WORKDIR /app

# Copy installed dependencies from builder
COPY --from=builder /install /usr/local

# Copy application code and trained model
COPY --from=builder --chown=appuser:appuser /build .

# Security: run as non-root user
USER appuser

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
