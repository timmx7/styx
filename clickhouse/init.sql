-- ClickHouse init script for Styx analytics
CREATE DATABASE IF NOT EXISTS styx;

CREATE TABLE IF NOT EXISTS styx.routing_logs (
    id UUID DEFAULT generateUUIDv4(),
    project_id String,
    provider String,
    model String,
    complexity String,
    latency_ms Int32,
    status_code Int32,
    cache_hit UInt8,
    was_fallback UInt8,
    input_tokens Int32,
    output_tokens Int32,
    cost_cents Int32,
    request_body Nullable(String),
    response_body Nullable(String),
    end_user_id Nullable(String),
    experiment_id Nullable(String),
    variant_id Nullable(String),
    created_at DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY (project_id, created_at)
PARTITION BY toYYYYMM(created_at)
TTL created_at + INTERVAL 90 DAY;
