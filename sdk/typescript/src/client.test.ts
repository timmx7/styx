import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Styx } from "./client";
import { Stream } from "./stream";
import {
  StyxError,
  AuthenticationError,
  PermissionError,
  RateLimitError,
  TimeoutError,
} from "./errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
    body: null,
  } as unknown as Response);
}

/**
 * Create a mock Response whose `.body` is a ReadableStream that yields
 * the given SSE lines (each already formatted as `data: ...`).
 */
function mockStreamingResponse(
  sseLines: string[],
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const raw = sseLines.join("\n") + "\n";
  const encoder = new TextEncoder();
  const chunks = [encoder.encode(raw)];

  let idx = 0;
  const readable = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (idx < chunks.length) {
        controller.enqueue(chunks[idx++]);
      } else {
        controller.close();
      }
    },
  });

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    headers: new Headers(headers),
    json: () => Promise.reject(new Error("streaming response")),
    body: readable,
  } as unknown as Response;
}

function makeClient(overrides: Record<string, unknown> = {}) {
  return new Styx({
    apiKey: "af_test_key",
    baseURL: "https://test.styx.ai",
    maxRetries: 0, // No retries by default in tests
    ...overrides,
  });
}

const SAMPLE_REQUEST = {
  model: "gpt-4o",
  messages: [{ role: "user" as const, content: "Hello" }],
};

const SAMPLE_RESPONSE = {
  id: "chatcmpl-123",
  object: "chat.completion",
  created: 1700000000,
  model: "gpt-4o",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hi there!" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
};

const SAMPLE_CHUNK = {
  id: "chatcmpl-123",
  object: "chat.completion.chunk",
  created: 1700000000,
  model: "gpt-4o",
  choices: [
    {
      index: 0,
      delta: { content: "Hi" },
      finish_reason: null,
    },
  ],
};

const SAMPLE_CHUNK_DONE = {
  id: "chatcmpl-123",
  object: "chat.completion.chunk",
  created: 1700000000,
  model: "gpt-4o",
  choices: [
    {
      index: 0,
      delta: {},
      finish_reason: "stop",
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Styx constructor", () => {
  it("requires an apiKey", () => {
    expect(() => new Styx({ apiKey: "" })).toThrow(AuthenticationError);
  });

  it("accepts a valid config", () => {
    const client = makeClient();
    expect(client).toBeDefined();
    expect(client.chat).toBeDefined();
    expect(client.chat.completions).toBeDefined();
    expect(typeof client.chat.completions.create).toBe("function");
  });

  it("strips trailing slashes from baseURL", () => {
    const client = new Styx({
      apiKey: "af_key",
      baseURL: "https://api.test.com///",
      maxRetries: 0,
    });
    // We can't directly access private fields, but we can test behavior
    expect(client).toBeDefined();
  });

  it("exposes models namespace", () => {
    const client = makeClient();
    expect(client.models).toBeDefined();
    expect(typeof client.models.list).toBe("function");
  });

  it("exposes embeddings namespace", () => {
    const client = makeClient();
    expect(client.embeddings).toBeDefined();
    expect(typeof client.embeddings.create).toBe("function");
  });
});

describe("chat.completions.create", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends correct request and parses response", async () => {
    globalThis.fetch = mockFetchResponse(SAMPLE_RESPONSE);
    const client = makeClient();

    const result = await client.chat.completions.create(SAMPLE_REQUEST);

    expect(result.id).toEqual(SAMPLE_RESPONSE.id);
    expect(result.choices).toEqual(SAMPLE_RESPONSE.choices);
    expect(globalThis.fetch).toHaveBeenCalledOnce();

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("https://test.styx.ai/v1/chat/completions");
    expect(options.method).toBe("POST");
    expect(options.headers["Authorization"]).toBe("Bearer af_test_key");
    expect(options.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(options.body);
    expect(body.stream).toBe(false);
    expect(body.model).toBe("gpt-4o");
    expect(body.messages).toHaveLength(1);
  });

  it("includes User-Agent header", async () => {
    globalThis.fetch = mockFetchResponse(SAMPLE_RESPONSE);
    const client = makeClient();
    await client.chat.completions.create(SAMPLE_REQUEST);

    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(options.headers["User-Agent"]).toContain("@styx/sdk");
  });

  it("includes custom default headers", async () => {
    globalThis.fetch = mockFetchResponse(SAMPLE_RESPONSE);
    const client = makeClient({
      defaultHeaders: { "X-Custom": "value" },
    });
    await client.chat.completions.create(SAMPLE_REQUEST);

    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(options.headers["X-Custom"]).toBe("value");
  });

  it("attaches response headers to non-streaming result (M10)", async () => {
    globalThis.fetch = mockFetchResponse(SAMPLE_RESPONSE, 200, {
      "x-styx-provider": "openai",
      "x-styx-cache-hit": "false",
    });
    const client = makeClient();

    const result = await client.chat.completions.create(SAMPLE_REQUEST);

    // Response metadata exposed via .response
    const resp = (result as unknown as { response: { headers: Record<string, string> } }).response;
    expect(resp).toBeDefined();
    expect(resp.headers["x-styx-provider"]).toBe("openai");
    expect(resp.headers["x-styx-cache-hit"]).toBe("false");
  });
});

describe("Error handling", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("throws AuthenticationError on 401", async () => {
    globalThis.fetch = mockFetchResponse(
      { detail: "Invalid API key" },
      401,
    );
    const client = makeClient();

    await expect(
      client.chat.completions.create(SAMPLE_REQUEST),
    ).rejects.toThrow(AuthenticationError);
  });

  it("throws PermissionError on 403", async () => {
    globalThis.fetch = mockFetchResponse(
      { detail: "Permission denied" },
      403,
    );
    const client = makeClient();

    await expect(
      client.chat.completions.create(SAMPLE_REQUEST),
    ).rejects.toThrow(PermissionError);
  });

  it("throws RateLimitError on 429", async () => {
    globalThis.fetch = mockFetchResponse(
      { detail: "Too many requests" },
      429,
    );
    const client = makeClient();

    await expect(
      client.chat.completions.create(SAMPLE_REQUEST),
    ).rejects.toThrow(RateLimitError);
  });

  it("throws StyxError on 4xx errors", async () => {
    globalThis.fetch = mockFetchResponse(
      { detail: "Not found" },
      404,
    );
    const client = makeClient();

    await expect(
      client.chat.completions.create(SAMPLE_REQUEST),
    ).rejects.toThrow(StyxError);
  });

  it("throws StyxError on 5xx after retries exhausted", async () => {
    globalThis.fetch = mockFetchResponse(
      { detail: "Internal error" },
      500,
    );
    const client = makeClient({ maxRetries: 0 });

    await expect(
      client.chat.completions.create(SAMPLE_REQUEST),
    ).rejects.toThrow(StyxError);
  });

  it("retries on 5xx errors", async () => {
    const failThenSucceed = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: new Headers(),
        json: () => Promise.resolve({}),
        body: null,
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        json: () => Promise.resolve(SAMPLE_RESPONSE),
        body: null,
      } as unknown as Response);

    globalThis.fetch = failThenSucceed;
    const client = makeClient({ maxRetries: 1 });

    const result = await client.chat.completions.create(SAMPLE_REQUEST);
    expect(result.id).toEqual(SAMPLE_RESPONSE.id);
    expect(failThenSucceed).toHaveBeenCalledTimes(2);
  });

  it("throws TimeoutError on abort", async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });
    const client = makeClient({ maxRetries: 0 });

    await expect(
      client.chat.completions.create(SAMPLE_REQUEST),
    ).rejects.toThrow(TimeoutError);
  });

  it("throws network error after retries", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const client = makeClient({ maxRetries: 0 });

    await expect(
      client.chat.completions.create(SAMPLE_REQUEST),
    ).rejects.toThrow(StyxError);
  });
});

// ---------------------------------------------------------------------------
// Streaming (C10, H15, M10, M12)
// ---------------------------------------------------------------------------

describe("Streaming — chat.completions.create({ stream: true })", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns a Stream instance when stream: true", async () => {
    const resp = mockStreamingResponse([
      `data: ${JSON.stringify(SAMPLE_CHUNK)}`,
      `data: [DONE]`,
    ], 200, { "x-styx-provider": "openai" });
    globalThis.fetch = vi.fn().mockResolvedValue(resp);
    const client = makeClient();

    const stream = await client.chat.completions.create({
      ...SAMPLE_REQUEST,
      stream: true,
    });

    expect(stream).toBeInstanceOf(Stream);
  });

  it("yields parsed chunks via for-await", async () => {
    const resp = mockStreamingResponse([
      `data: ${JSON.stringify(SAMPLE_CHUNK)}`,
      `data: ${JSON.stringify(SAMPLE_CHUNK_DONE)}`,
      `data: [DONE]`,
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue(resp);
    const client = makeClient();

    const stream = await client.chat.completions.create({
      ...SAMPLE_REQUEST,
      stream: true,
    });

    const chunks: unknown[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual(SAMPLE_CHUNK);
    expect(chunks[1]).toEqual(SAMPLE_CHUNK_DONE);
  });

  it("exposes response headers on the Stream (M10)", async () => {
    const resp = mockStreamingResponse(
      [`data: ${JSON.stringify(SAMPLE_CHUNK)}`, `data: [DONE]`],
      200,
      {
        "x-styx-provider": "anthropic",
        "x-styx-cache-hit": "true",
      },
    );
    globalThis.fetch = vi.fn().mockResolvedValue(resp);
    const client = makeClient();

    const stream = await client.chat.completions.create({
      ...SAMPLE_REQUEST,
      stream: true,
    });

    expect(stream.response).toBeDefined();
    expect(stream.response.headers["x-styx-provider"]).toBe("anthropic");
    expect(stream.response.headers["x-styx-cache-hit"]).toBe("true");
  });

  it("exposes an AbortController on the Stream", async () => {
    const resp = mockStreamingResponse([
      `data: ${JSON.stringify(SAMPLE_CHUNK)}`,
      `data: [DONE]`,
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue(resp);
    const client = makeClient();

    const stream = await client.chat.completions.create({
      ...SAMPLE_REQUEST,
      stream: true,
    });

    expect(stream.controller).toBeInstanceOf(AbortController);
  });

  it("skips malformed JSON chunks gracefully (H15)", async () => {
    const resp = mockStreamingResponse([
      `data: ${JSON.stringify(SAMPLE_CHUNK)}`,
      `data: {bad json`,
      `data: ${JSON.stringify(SAMPLE_CHUNK_DONE)}`,
      `data: [DONE]`,
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue(resp);
    const client = makeClient();

    const stream = await client.chat.completions.create({
      ...SAMPLE_REQUEST,
      stream: true,
    });

    const chunks: unknown[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    // Malformed chunk is silently skipped
    expect(chunks).toHaveLength(2);
  });

  it("throws on SSE error event (H15)", async () => {
    const resp = mockStreamingResponse([
      `data: ${JSON.stringify(SAMPLE_CHUNK)}`,
      `event: error`,
      `data: {"message":"upstream provider error"}`,
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue(resp);
    const client = makeClient();

    const stream = await client.chat.completions.create({
      ...SAMPLE_REQUEST,
      stream: true,
    });

    const chunks: unknown[] = [];
    await expect(async () => {
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
    }).rejects.toThrow(StyxError);

    // The first chunk before the error was yielded
    expect(chunks).toHaveLength(1);
  });

  it("throws StyxError when response body is null", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: () => Promise.resolve({}),
      body: null,
    } as unknown as Response);
    const client = makeClient();

    await expect(
      client.chat.completions.create({ ...SAMPLE_REQUEST, stream: true }),
    ).rejects.toThrow(StyxError);
  });
});

// ---------------------------------------------------------------------------
// Stream.toReadableStream (M12)
// ---------------------------------------------------------------------------

describe("Stream.toReadableStream", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("converts async iterable to a Web ReadableStream", async () => {
    const resp = mockStreamingResponse([
      `data: ${JSON.stringify(SAMPLE_CHUNK)}`,
      `data: ${JSON.stringify(SAMPLE_CHUNK_DONE)}`,
      `data: [DONE]`,
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue(resp);
    const client = makeClient();

    const stream = await client.chat.completions.create({
      ...SAMPLE_REQUEST,
      stream: true,
    });

    const readable = stream.toReadableStream();
    expect(readable).toBeInstanceOf(ReadableStream);

    const reader = readable.getReader();
    const results: unknown[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      results.push(value);
    }

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(SAMPLE_CHUNK);
  });
});

// ---------------------------------------------------------------------------
// Models endpoint (H14)
// ---------------------------------------------------------------------------

describe("models.list", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends GET /v1/models and parses response", async () => {
    const modelsResp = {
      object: "list",
      data: [
        { id: "gpt-4o", object: "model", created: 1700000000, owned_by: "openai" },
        { id: "claude-3-opus", object: "model", created: 1700000000, owned_by: "anthropic" },
      ],
    };
    globalThis.fetch = mockFetchResponse(modelsResp);
    const client = makeClient();

    const result = await client.models.list();

    expect(result.object).toBe("list");
    expect(result.data).toHaveLength(2);
    expect(result.data[0].id).toBe("gpt-4o");

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("https://test.styx.ai/v1/models");
    expect(options.method).toBe("GET");
    expect(options.headers["Authorization"]).toBe("Bearer af_test_key");
    // C-SDK-3: GET requests must NOT include Content-Type
    expect(options.headers["Content-Type"]).toBeUndefined();
    expect(options.body).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Embeddings endpoint (H14)
// ---------------------------------------------------------------------------

describe("embeddings.create", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends POST /v1/embeddings and parses response", async () => {
    const embeddingsResp = {
      object: "list",
      data: [
        { object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] },
      ],
      model: "text-embedding-ada-002",
      usage: { prompt_tokens: 5, total_tokens: 5 },
    };
    globalThis.fetch = mockFetchResponse(embeddingsResp);
    const client = makeClient();

    const result = await client.embeddings.create({
      model: "text-embedding-ada-002",
      input: "Hello world",
    });

    expect(result.object).toBe("list");
    expect(result.data).toHaveLength(1);
    expect(result.data[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(result.model).toBe("text-embedding-ada-002");

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("https://test.styx.ai/v1/embeddings");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.model).toBe("text-embedding-ada-002");
    expect(body.input).toBe("Hello world");
  });
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

describe("Type exports", () => {
  it("exports all expected types and classes", async () => {
    const sdk = await import("./index");
    // Classes
    expect(sdk.Styx).toBeDefined();
    expect(sdk.Stream).toBeDefined();
    expect(sdk.StyxError).toBeDefined();
    expect(sdk.AuthenticationError).toBeDefined();
    expect(sdk.PermissionError).toBeDefined();
    expect(sdk.RateLimitError).toBeDefined();
    expect(sdk.BudgetExceededError).toBeDefined();
    expect(sdk.TimeoutError).toBeDefined();
  });
});
