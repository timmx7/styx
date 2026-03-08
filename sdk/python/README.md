# Styx Python SDK

The official Python SDK for [Styx](https://styx.ai) — the intelligent AI API gateway.

Drop-in replacement for the OpenAI Python SDK. One line change to access all AI models, reduce costs by 40%, and never experience downtime.

## Installation

```bash
pip install styx-sdk
```

## Quick Start

```python
from styx import Styx

client = Styx(api_key="sk_styx_xxx")

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello!"}],
)

print(response.choices[0].message.content)
print(response.metadata.provider)   # "openai"
print(response.metadata.cache_hit)  # True/False
print(response.metadata.latency_ms) # 42
```

## Async Support

```python
from styx import AsyncStyx

async with AsyncStyx(api_key="sk_styx_xxx") as client:
    response = await client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": "Hello!"}],
    )
```

## Streaming

```python
stream = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Write a poem"}],
    stream=True,
)

for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
```

## Embeddings

```python
response = client.embeddings.create(
    model="text-embedding-3-small",
    input="Hello world",
)

print(response.data[0].embedding[:5])
```

## Styx Metadata

Every response includes metadata about how Styx processed your request:

```python
response.metadata.provider    # Which AI provider served the request
response.metadata.cache_hit   # Whether the response was cached
response.metadata.latency_ms  # End-to-end latency
response.metadata.complexity  # Request complexity classification
response.metadata.request_id  # Unique ID for debugging
```

## Error Handling

```python
from styx import Styx, RateLimitError, BudgetExceededError

try:
    response = client.chat.completions.create(...)
except RateLimitError as e:
    print(f"Rate limited. Retry after: {e.retry_after}s")
except BudgetExceededError:
    print("Monthly budget exceeded!")
```

## Configuration

```python
client = Styx(
    api_key="sk_styx_xxx",
    base_url="https://api.styx.ai",  # or self-hosted
    timeout=120.0,                       # request timeout (seconds)
    max_retries=3,                       # auto-retry on 429/5xx
    default_headers={"X-Custom": "val"}, # extra headers
)
```

## Requirements

- Python 3.10+
- `httpx` for HTTP
- `pydantic` for types

## License

MIT
