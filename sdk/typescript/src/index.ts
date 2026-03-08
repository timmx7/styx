/**
 * @styx/sdk — Official TypeScript SDK for Styx
 *
 * Drop-in replacement for the OpenAI SDK. Just change the import:
 *
 * ```ts
 * // Before
 * import OpenAI from "openai";
 * const client = new OpenAI({ apiKey: "sk-..." });
 *
 * // After
 * import { Styx } from "@styx/sdk";
 * const client = new Styx({ apiKey: "af_..." });
 * ```
 *
 * Everything else stays the same — same API, same types, same streaming.
 */

export { Styx } from "./client";
export type { APIResponse } from "./client";
export { Stream } from "./stream";
export type {
  StyxConfig,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatChoice,
  Usage,
  StyxErrorBody,
  Model,
  ModelListResponse,
  EmbeddingCreateRequest,
  EmbeddingCreateResponse,
  Embedding,
  EmbeddingUsage,
  ContentPart,
  TextContentPart,
  ImageURLContentPart,
  ToolCall,
  FunctionCall,
} from "./types";
export {
  StyxError,
  AuthenticationError,
  PermissionError,
  RateLimitError,
  BudgetExceededError,
  TimeoutError,
} from "./errors";
