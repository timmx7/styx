/** Styx SDK types. */

export interface StyxConfig {
  /** Your Styx API key (starts with "af_") */
  apiKey: string;
  /** Base URL of the Styx gateway. Default: https://api.styx.ai */
  baseURL?: string;
  /** Request timeout in milliseconds. Default: 120000 (2 minutes) */
  timeout?: number;
  /** Maximum retries on 5xx errors. Default: 2 */
  maxRetries?: number;
  /** Custom headers to include in every request */
  defaultHeaders?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Function calling & multi-modal types (H-SDK-5/6/7)
// ---------------------------------------------------------------------------

/** A single text content part for multi-modal messages. */
export interface TextContentPart {
  type: "text";
  text: string;
}

/** An image URL content part for multi-modal messages. */
export interface ImageURLContentPart {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
}

/** Content part — text or image_url. */
export type ContentPart = TextContentPart | ImageURLContentPart;

/** A function description inside a tool call. */
export interface FunctionCall {
  name: string;
  arguments: string;
}

/** A tool call requested by the assistant. */
export interface ToolCall {
  id: string;
  type: "function";
  function: FunctionCall;
}

/** Message in OpenAI-compatible chat format. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool" | "function";
  content: string | ContentPart[] | null;
  /** Function/tool name (for role "function" or "tool"). */
  name?: string;
  /** Tool call ID this message is responding to (for role "tool"). */
  tool_call_id?: string;
  /** Tool calls requested by the assistant. */
  tool_calls?: ToolCall[];
}

/** Chat completion request body. */
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[];
  [key: string]: unknown;
}

/** Choice in a chat completion response. */
export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

/** Usage statistics from the response. */
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Chat completion response. */
export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: Usage;
  /** Styx-specific: which provider served this request */
  "x-styx-provider"?: string;
  /** Styx-specific: whether this was a cache hit */
  "x-styx-cache-hit"?: boolean;
}

/** A single Server-Sent Event chunk during streaming. */
export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Partial<ChatMessage>;
    finish_reason: string | null;
  }>;
}

/** Shape of an API error body returned by Styx or the upstream provider. */
export interface StyxErrorBody {
  status: number;
  message: string;
  type?: string;
  code?: string;
  provider?: string;
}

// ---------------------------------------------------------------------------
// Models endpoint types (GET /v1/models)
// ---------------------------------------------------------------------------

/** A single model entry returned by the API. */
export interface Model {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

/** Response shape for GET /v1/models. */
export interface ModelListResponse {
  object: "list";
  data: Model[];
}

// ---------------------------------------------------------------------------
// Embeddings endpoint types (POST /v1/embeddings)
// ---------------------------------------------------------------------------

/** Request body for creating embeddings. */
export interface EmbeddingCreateRequest {
  /** Model to use for embeddings (e.g. "text-embedding-ada-002"). */
  model: string;
  /** Input text(s) to embed. */
  input: string | string[];
  /** Optional encoding format. */
  encoding_format?: "float" | "base64";
  /** Optional number of dimensions (for models that support it). */
  dimensions?: number;
  [key: string]: unknown;
}

/** A single embedding vector. */
export interface Embedding {
  object: "embedding";
  index: number;
  embedding: number[];
}

/** Usage info for an embedding request. */
export interface EmbeddingUsage {
  prompt_tokens: number;
  total_tokens: number;
}

/** Response shape for POST /v1/embeddings. */
export interface EmbeddingCreateResponse {
  object: "list";
  data: Embedding[];
  model: string;
  usage: EmbeddingUsage;
}
