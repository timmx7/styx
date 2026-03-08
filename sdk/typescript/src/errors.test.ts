import { describe, it, expect } from "vitest";
import {
  StyxError,
  AuthenticationError,
  PermissionError,
  RateLimitError,
  BudgetExceededError,
  TimeoutError,
} from "./errors";

describe("StyxError", () => {
  it("sets message, status, and type", () => {
    const err = new StyxError("Something failed", 500, "server_error");
    expect(err.message).toBe("Something failed");
    expect(err.status).toBe(500);
    expect(err.type).toBe("server_error");
    expect(err.name).toBe("StyxError");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StyxError);
  });

  it("defaults type to api_error", () => {
    const err = new StyxError("fail", 400);
    expect(err.type).toBe("api_error");
  });

  it("includes optional code and provider", () => {
    const err = new StyxError("fail", 400, "api_error", "model_not_found", "openai");
    expect(err.code).toBe("model_not_found");
    expect(err.provider).toBe("openai");
  });

  it("has undefined code/provider when not provided", () => {
    const err = new StyxError("fail", 400);
    expect(err.code).toBeUndefined();
    expect(err.provider).toBeUndefined();
  });
});

describe("AuthenticationError", () => {
  it("sets correct defaults", () => {
    const err = new AuthenticationError();
    expect(err.message).toBe("Invalid or missing API key");
    expect(err.status).toBe(401);
    expect(err.type).toBe("authentication_error");
    expect(err.name).toBe("AuthenticationError");
    expect(err).toBeInstanceOf(StyxError);
  });

  it("accepts custom message", () => {
    const err = new AuthenticationError("Key expired");
    expect(err.message).toBe("Key expired");
    expect(err.status).toBe(401);
  });
});

describe("PermissionError", () => {
  it("sets correct defaults", () => {
    const err = new PermissionError();
    expect(err.message).toBe("Permission denied");
    expect(err.status).toBe(403);
    expect(err.type).toBe("permission_error");
    expect(err.name).toBe("PermissionError");
    expect(err).toBeInstanceOf(StyxError);
  });

  it("accepts custom message", () => {
    const err = new PermissionError("Forbidden resource");
    expect(err.message).toBe("Forbidden resource");
    expect(err.status).toBe(403);
  });
});

describe("RateLimitError", () => {
  it("sets correct defaults", () => {
    const err = new RateLimitError();
    expect(err.message).toBe("Rate limit exceeded");
    expect(err.status).toBe(429);
    expect(err.type).toBe("rate_limit_error");
    expect(err.name).toBe("RateLimitError");
    expect(err.retryAfter).toBeUndefined();
  });

  it("includes retryAfter", () => {
    const err = new RateLimitError("Too fast", 30);
    expect(err.retryAfter).toBe(30);
  });
});

describe("BudgetExceededError", () => {
  it("sets correct defaults", () => {
    const err = new BudgetExceededError();
    expect(err.message).toBe("Monthly budget exceeded");
    expect(err.status).toBe(429);
    expect(err.type).toBe("budget_exceeded");
    expect(err.name).toBe("BudgetExceededError");
    expect(err).toBeInstanceOf(RateLimitError.prototype.constructor === RateLimitError ? StyxError : StyxError);
  });
});

describe("TimeoutError", () => {
  it("sets correct defaults", () => {
    const err = new TimeoutError();
    expect(err.message).toBe("Request timed out");
    expect(err.status).toBe(408);
    expect(err.type).toBe("timeout_error");
    expect(err.name).toBe("TimeoutError");
  });
});

describe("Error hierarchy", () => {
  it("all custom errors extend StyxError", () => {
    expect(new AuthenticationError()).toBeInstanceOf(StyxError);
    expect(new PermissionError()).toBeInstanceOf(StyxError);
    expect(new RateLimitError()).toBeInstanceOf(StyxError);
    expect(new BudgetExceededError()).toBeInstanceOf(StyxError);
    expect(new TimeoutError()).toBeInstanceOf(StyxError);
  });

  it("all custom errors extend Error", () => {
    expect(new AuthenticationError()).toBeInstanceOf(Error);
    expect(new PermissionError()).toBeInstanceOf(Error);
    expect(new RateLimitError()).toBeInstanceOf(Error);
    expect(new BudgetExceededError()).toBeInstanceOf(Error);
    expect(new TimeoutError()).toBeInstanceOf(Error);
  });

  it("can be caught with try/catch", () => {
    expect(() => {
      throw new AuthenticationError();
    }).toThrow(StyxError);
  });
});
