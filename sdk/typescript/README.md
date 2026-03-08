# @styx/sdk

Official TypeScript SDK for **Styx** — the intelligent AI API gateway.

Drop-in replacement for the OpenAI SDK. Just change the import.

## Installation

```bash
npm install @styx/sdk
```

## Quick Start

```ts
import { Styx } from "@styx/sdk";

const client = new Styx({ apiKey: "af_..." });

// Non-streaming
const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(response.choices[0].message.content);

// Streaming
const stream = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

## Configuration

```ts
const client = new Styx({
  apiKey: "af_...",             // Required — your Styx API key
  baseURL: "https://...",       // Default: https://api.styx.ai
  timeout: 120_000,             // Default: 120s
  maxRetries: 2,                // Default: 2 (retries on 5xx/429)
  defaultHeaders: { ... },      // Extra headers on every request
});
```

## Error Handling

```ts
import {
  StyxError,
  AuthenticationError,
  RateLimitError,
  BudgetExceededError,
  TimeoutError,
} from "@styx/sdk";

try {
  await client.chat.completions.create({ ... });
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.log("Budget limit reached");
  } else if (err instanceof RateLimitError) {
    console.log(`Rate limited. Retry after ${err.retryAfter}s`);
  } else if (err instanceof AuthenticationError) {
    console.log("Invalid API key");
  } else if (err instanceof TimeoutError) {
    console.log("Request timed out");
  } else if (err instanceof StyxError) {
    console.log(`API error ${err.status}: ${err.message}`);
  }
}
```

## Styx-Specific Response Headers

Responses include metadata from the gateway:

```ts
const res = await client.chat.completions.create({ ... });
console.log(res["x-styx-provider"]);  // "openai" | "anthropic" | ...
console.log(res["x-styx-cache-hit"]); // true if semantic cache hit
```

## Requirements

- Node.js >= 18.0.0
- TypeScript >= 5.0 (optional, for type checking)

## License

MIT
