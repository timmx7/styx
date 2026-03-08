FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o /styx-router ./cmd/server

FROM alpine:3.19

RUN apk --no-cache add ca-certificates

# Security: create non-root user
RUN addgroup -g 1001 -S appuser && \
    adduser -u 1001 -S appuser -G appuser

WORKDIR /app

COPY --from=builder --chown=appuser:appuser /styx-router .
COPY --chown=appuser:appuser config/config.yaml ./config/config.yaml
COPY --chown=appuser:appuser config/model_pricing.json ./config/model_pricing.json

# Security: run as non-root user
USER appuser

EXPOSE 8080

CMD ["./styx-router"]
