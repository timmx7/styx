/**
 * Styx client — drop-in replacement for the OpenAI SDK.
 *
 * Usage:
 *   import { Styx } from "@styx/sdk";
 *
 *   const client = new Styx({ apiKey: "af_..." });
 *   const response = await client.chat.completions.create({
 *     model: "gpt-4o",
 *     messages: [{ role: "user", content: "Hello!" }],
 *   });
 *
 * Streaming:
 *   const stream = await client.chat.completions.create({
 *     model: "gpt-4o",
 *     messages: [{ role: "user", content: "Hello!" }],
 *     stream: true,
 *   });
 *   for await (const chunk of stream) {
 *     process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
 *   }
 */

import type {
  StyxConfig,
  StyxErrorBody,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ModelListResponse,
  EmbeddingCreateRequest,
  EmbeddingCreateResponse,
} from "./types";
import {
  StyxError,
  AuthenticationError,
  PermissionError,
  RateLimitError,
  BudgetExceededError,
  TimeoutError,
} from "./errors";
import { Stream } from "./stream";
import { VERSION } from "./version";

const DEFAULT_BASE_URL = "https://api.styx.ai";
const DEFAULT_TIMEOUT = 120_000;
const DEFAULT_MAX_RETRIES = 2;

// ---------------------------------------------------------------------------
// Response wrapper — attaches x-styx-* headers to non-streaming results
// ---------------------------------------------------------------------------

export interface APIResponse<T> {
  data: T;
  response: {
    headers: Record<string, string>;
    status: number;
  };
}

/**
 * Wraps a parsed body with response metadata.  The wrapper is transparent:
 * all properties of T are spread onto the object so callers can use it as if
 * it were just T, while the `response` property holds headers/status.
 */
function wrapResponse<T extends object>(
  body: T,
  fetchResponse: Response,
): T & { response: { headers: Record<string, string>; status: number } } {
  const headers: Record<string, string> = {};
  fetchResponse.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return { ...body, response: { headers, status: fetchResponse.status } };
}

// ---------------------------------------------------------------------------
// Overloads for chat.completions.create
// ---------------------------------------------------------------------------

/** When stream: true, the return type is a Stream of chunks. */
type ChatCompletionCreateParams = ChatCompletionRequest;

interface ChatCompletionCreateOverloads {
  (
    request: ChatCompletionCreateParams & { stream: true },
  ): Promise<Stream<ChatCompletionChunk>>;
  (
    request: ChatCompletionCreateParams & { stream?: false | undefined },
  ): Promise<ChatCompletionResponse>;
  (
    request: ChatCompletionCreateParams,
  ): Promise<ChatCompletionResponse | Stream<ChatCompletionChunk>>;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class Styx {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly _defaultHeaders: Record<string, string>;

  /** Namespaced API matching OpenAI's structure: `client.chat.completions.create(...)` */
  readonly chat: {
    completions: {
      create: ChatCompletionCreateOverloads;
    };
  };

  /** `client.models.list()` — GET /v1/models */
  readonly models: {
    list: () => Promise<ModelListResponse>;
  };

  /** `client.embeddings.create(params)` — POST /v1/embeddings */
  readonly embeddings: {
    create: (
      params: EmbeddingCreateRequest,
    ) => Promise<EmbeddingCreateResponse>;
  };

  constructor(config: StyxConfig) {
    if (!config.apiKey) {
      throw new AuthenticationError("apiKey is required");
    }

    this.apiKey = config.apiKey;
    this.baseURL = (config.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this._defaultHeaders = config.defaultHeaders ?? {};

    // Bind namespaced methods
    this.chat = {
      completions: {
        create: this.createChatCompletion.bind(this) as ChatCompletionCreateOverloads,
      },
    };

    this.models = {
      list: this.listModels.bind(this),
    };

    this.embeddings = {
      create: this.createEmbedding.bind(this),
    };
  }

  // -------------------------------------------------------------------------
  // Chat completions
  // -------------------------------------------------------------------------

  /**
   * Create a chat completion.
   * When `stream: true` is set, returns a `Stream<ChatCompletionChunk>`.
   * Otherwise returns a `ChatCompletionResponse`.
   */
  private async createChatCompletion(
    request: ChatCompletionCreateParams,
  ): Promise<ChatCompletionResponse | Stream<ChatCompletionChunk>> {
    if (request.stream) {
      return this.createStreamingCompletion(request);
    }

    const body = { ...request, stream: false };
    const fetchResponse = await this.rawRequest(
      "POST",
      "/v1/chat/completions",
      body,
    );
    const parsed = (await fetchResponse.json()) as ChatCompletionResponse;
    return wrapResponse(parsed, fetchResponse);
  }

  /**
   * Internal: create a streaming chat completion.
   * Returns a Stream<ChatCompletionChunk> that implements AsyncIterable.
   *
   * We do NOT pass an external AbortController to rawRequest so that each
   * retry attempt gets a fresh controller (C-SDK-2).  Instead we create a
   * new controller here and hand it to Stream for cancellation.
   */
  private async createStreamingCompletion(
    request: ChatCompletionCreateParams,
  ): Promise<Stream<ChatCompletionChunk>> {
    const body = { ...request, stream: true };

    const fetchResponse = await this.rawRequest(
      "POST",
      "/v1/chat/completions",
      body,
    );

    // H-SDK-8: Check response.ok before constructing the stream
    if (!fetchResponse.ok) {
      const errorBody = await fetchResponse.text().catch(() => "");
      throw new StyxError(
        `Stream request failed: ${fetchResponse.status} ${errorBody}`,
        fetchResponse.status,
      );
    }

    // Create a controller for the Stream so callers can cancel iteration.
    const controller = new AbortController();
    return Stream.fromResponse<ChatCompletionChunk>(fetchResponse, controller);
  }

  // -------------------------------------------------------------------------
  // Models
  // -------------------------------------------------------------------------

  /** GET /v1/models */
  private async listModels(): Promise<ModelListResponse> {
    const fetchResponse = await this.rawRequest("GET", "/v1/models");
    if (!fetchResponse.ok) await this.throwMappedError(fetchResponse);
    const parsed = (await fetchResponse.json()) as ModelListResponse;
    return wrapResponse(parsed, fetchResponse);
  }

  // -------------------------------------------------------------------------
  // Embeddings
  // -------------------------------------------------------------------------

  /** POST /v1/embeddings */
  private async createEmbedding(
    params: EmbeddingCreateRequest,
  ): Promise<EmbeddingCreateResponse> {
    const fetchResponse = await this.rawRequest(
      "POST",
      "/v1/embeddings",
      params,
    );
    if (!fetchResponse.ok) await this.throwMappedError(fetchResponse);
    const parsed = (await fetchResponse.json()) as EmbeddingCreateResponse;
    return wrapResponse(parsed, fetchResponse);
  }

  // -------------------------------------------------------------------------
  // Legacy streaming helper (kept for backward compat, delegates to Stream)
  // -------------------------------------------------------------------------

  /**
   * @deprecated Use `client.chat.completions.create({ ..., stream: true })` instead.
   * Stream a chat completion. Returns an async iterator of chunks.
   */
  async *stream(
    request: ChatCompletionRequest,
  ): AsyncGenerator<ChatCompletionChunk> {
    const s = await this.createStreamingCompletion(request);
    yield* s;
  }

  // -------------------------------------------------------------------------
  // HTTP layer
  // -------------------------------------------------------------------------

  /**
   * Raw fetch with retries, timeout, and error mapping.
   * A fresh AbortController is created for each attempt so that retries are
   * never blocked by a previously-aborted signal (C-SDK-2).
   */
  private async rawRequest(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const url = `${this.baseURL}${path}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff with jitter (M-SDK-3): 500ms, 1s, 2s, ... + random jitter
        const jitter = Math.random() * 200;
        const delay = Math.min(500 * Math.pow(2, attempt - 1) + jitter, 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Fresh controller per attempt — never reuse an aborted controller
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        // C-SDK-3: Only include Content-Type for methods that carry a body
        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.apiKey}`,
          "User-Agent": `@styx/sdk-typescript/${VERSION}`,
          ...this._defaultHeaders,
        };

        const hasBody = body !== undefined && /^(POST|PUT|PATCH)$/i.test(method);
        if (hasBody) {
          headers["Content-Type"] = "application/json";
        }

        const response = await fetch(url, {
          method,
          headers,
          body: hasBody ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok || (response.status < 500 && response.status !== 429)) {
          if (!response.ok) {
            await this.throwMappedError(response);
          }
          return response;
        }

        // Retryable: 5xx or 429
        if (response.status === 429) {
          // H-SDK-10: Handle both integer-seconds and HTTP-date Retry-After values
          const retryAfterHeader = response.headers.get("retry-after") ?? "1";
          let retryAfterSec = parseInt(retryAfterHeader, 10);
          if (isNaN(retryAfterSec)) {
            const date = new Date(retryAfterHeader);
            retryAfterSec = Math.max(1, Math.ceil((date.getTime() - Date.now()) / 1000));
            if (isNaN(retryAfterSec)) retryAfterSec = 1;
          }

          if (attempt === this.maxRetries) {
            throw new RateLimitError(undefined, retryAfterSec);
          }
          await new Promise((r) => setTimeout(r, retryAfterSec * 1000));
          continue;
        }

        // 5xx — retry
        lastError = new StyxError(
          `Server error: ${response.status}`,
          response.status,
        );
      } catch (err) {
        clearTimeout(timeoutId);

        if (err instanceof StyxError) throw err;

        if ((err as Error).name === "AbortError") {
          lastError = new TimeoutError();
          if (attempt === this.maxRetries) throw lastError;
          continue;
        }

        lastError = err as Error;
        if (attempt === this.maxRetries) {
          throw new StyxError(
            `Request failed: ${lastError.message}`,
            0,
            "network_error",
          );
        }
      }
    }

    throw lastError ?? new StyxError("Request failed after retries", 500);
  }

  /** Map HTTP error responses to typed errors. */
  private async throwMappedError(response: Response): Promise<never> {
    let body: Partial<StyxErrorBody> = {};
    try {
      body = (await response.json()) as Partial<StyxErrorBody>;
    } catch {
      // ignore parse errors
    }

    const rawBody = body as Record<string, unknown>;
    const detail =
      (rawBody.detail as string) ??
      (rawBody.error as Record<string, unknown>)?.message ??
      body.message ??
      response.statusText;
    const errorType =
      (rawBody.error as Record<string, unknown>)?.type as string | undefined ??
      body.type;

    switch (response.status) {
      case 401:
        throw new AuthenticationError(detail as string);
      case 402:
        throw new BudgetExceededError(detail as string);
      case 403:
        throw new PermissionError(detail as string);
      case 429:
        if (errorType === "budget_exceeded") {
          throw new BudgetExceededError(detail as string);
        }
        throw new RateLimitError(detail as string);
      default:
        throw new StyxError(
          detail as string,
          response.status,
          errorType ?? "api_error",
          body.code,
          body.provider,
        );
    }
  }
}
