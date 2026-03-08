# Changelog

All notable changes to the Styx Python SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-02-14

### Added

- Initial release of the Styx Python SDK.
- `Styx` synchronous client with OpenAI-compatible interface.
- `AsyncStyx` asynchronous client with full async/await support.
- `client.chat.completions.create()` for chat completions.
- `client.embeddings.create()` for text embeddings.
- `client.models.list()` to list available models.
- SSE streaming support via `SSEStream` and `AsyncSSEStream`.
- Automatic retry with exponential backoff and jitter.
- `Retry-After` header support for rate limiting.
- Full exception hierarchy: `AuthenticationError`, `RateLimitError`,
  `BudgetExceededError`, `ConnectionError`, `TimeoutError`, etc.
- `StyxMetadata` on every response: provider, cache hit, latency,
  complexity, request ID.
- Type hints and `py.typed` marker (PEP 561).
- Python 3.10+ support.
