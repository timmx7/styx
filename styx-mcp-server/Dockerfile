FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

RUN useradd -m -s /bin/false appuser && \
    chown -R appuser:appuser /app
USER appuser

# Default: SSE transport so other containers can reach it
ENV STYX_API_URL=http://backend:8000
ENV STYX_PROXY_URL=http://router:8080

EXPOSE 8090

CMD ["python", "server.py", "--transport", "sse"]
