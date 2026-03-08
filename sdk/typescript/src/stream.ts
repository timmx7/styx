/**
 * OpenAI-compatible Stream wrapper for SSE responses.
 *
 * Implements `AsyncIterable<T>` so callers can use `for await (const chunk of stream)`.
 * Also exposes a `controller` for cancellation, a `response` property for headers,
 * and a `toReadableStream()` method for Web Streams API compatibility.
 */

import { StyxError } from "./errors";

export interface StreamResponse {
  headers: Record<string, string>;
  status: number;
}

export class Stream<T> implements AsyncIterable<T> {
  /**
   * The AbortController used for this streaming request.
   * Call `stream.controller.abort()` to cancel.
   */
  readonly controller: AbortController;

  /**
   * Response metadata from the HTTP response, including x-styx-* headers.
   */
  readonly response: StreamResponse;

  private readonly _reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly _decoder: TextDecoder;
  private _buffer: string;
  private _done: boolean;

  constructor(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    controller: AbortController,
    response: StreamResponse,
  ) {
    this._reader = reader;
    this._decoder = new TextDecoder();
    this._buffer = "";
    this._done = false;
    this.controller = controller;
    this.response = response;
  }

  /**
   * Create a Stream from a raw fetch Response.
   * Extracts x-styx-* headers and sets up the SSE reader.
   */
  static fromResponse<T>(
    fetchResponse: Response,
    controller: AbortController,
  ): Stream<T> {
    if (!fetchResponse.body) {
      throw new StyxError("No response body for stream", 500);
    }

    const headers: Record<string, string> = {};
    fetchResponse.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const streamResponse: StreamResponse = {
      headers,
      status: fetchResponse.status,
    };

    const reader = fetchResponse.body.getReader();
    return new Stream<T>(reader, controller, streamResponse);
  }

  /**
   * AsyncIterator implementation. Parses SSE lines and yields parsed JSON chunks.
   * Handles `event: error` SSE events, mid-stream disconnection, and parse errors.
   */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    try {
      while (!this._done) {
        const { done, value } = await this._reader.read().catch((err) => {
          // Mid-stream disconnection
          throw new StyxError(
            `Stream disconnected: ${(err as Error).message}`,
            0,
            "stream_error",
          );
        });

        if (done) {
          this._done = true;
          break;
        }

        this._buffer += this._decoder.decode(value, { stream: true });
        const lines = this._buffer.split("\n");
        this._buffer = lines.pop() ?? "";

        let currentEvent: string | null = null;

        for (const line of lines) {
          const trimmed = line.trim();

          // Track SSE event type
          if (trimmed.startsWith("event: ")) {
            currentEvent = trimmed.slice(7).trim();
            continue;
          }

          // Skip empty lines and non-data lines
          if (!trimmed || !trimmed.startsWith("data: ")) {
            if (trimmed === "") {
              currentEvent = null;
            }
            continue;
          }

          const data = trimmed.slice(6);

          // Handle SSE error events
          if (currentEvent === "error") {
            let errorMessage = data;
            try {
              const errorBody = JSON.parse(data);
              errorMessage =
                errorBody.message ?? errorBody.error ?? data;
            } catch {
              // Use raw data string as error message
            }
            throw new StyxError(
              `Stream error: ${errorMessage}`,
              0,
              "stream_error",
            );
          }

          // Handle [DONE] signal
          if (data === "[DONE]") {
            this._done = true;
            return;
          }

          // Parse JSON chunk
          try {
            yield JSON.parse(data) as T;
          } catch {
            // Skip malformed chunks — H15: parse errors in chunks are silently ignored
          }

          currentEvent = null;
        }
      }
    } finally {
      this._reader.releaseLock();
    }
  }

  /**
   * Convert the stream to a Web ReadableStream.
   * Each chunk is a parsed T object.
   */
  toReadableStream(): ReadableStream<T> {
    const iterator = this[Symbol.asyncIterator]();

    return new ReadableStream<T>({
      async pull(controller) {
        try {
          const { done, value } = await iterator.next();
          if (done) {
            controller.close();
          } else {
            controller.enqueue(value);
          }
        } catch (err) {
          controller.error(err);
        }
      },
      cancel: () => {
        this.controller.abort();
      },
    });
  }
}
