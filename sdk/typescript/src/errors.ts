/** Custom error classes for the Styx SDK. */

export class StyxError extends Error {
  readonly status: number;
  readonly type: string;
  readonly code: string | undefined;
  readonly provider: string | undefined;

  constructor(
    message: string,
    status: number,
    type: string = "api_error",
    code?: string,
    provider?: string,
  ) {
    super(message);
    this.name = "StyxError";
    this.status = status;
    this.type = type;
    this.code = code;
    this.provider = provider;
  }
}

export class AuthenticationError extends StyxError {
  constructor(message = "Invalid or missing API key") {
    super(message, 401, "authentication_error");
    this.name = "AuthenticationError";
  }
}

export class PermissionError extends StyxError {
  constructor(message = "Permission denied") {
    super(message, 403, "permission_error");
    this.name = "PermissionError";
  }
}

export class RateLimitError extends StyxError {
  readonly retryAfter: number | undefined;

  constructor(message = "Rate limit exceeded", retryAfter?: number) {
    super(message, 429, "rate_limit_error");
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class BudgetExceededError extends StyxError {
  constructor(message = "Monthly budget exceeded") {
    super(message, 402, "budget_exceeded");
    this.name = "BudgetExceededError";
  }
}

export class TimeoutError extends StyxError {
  constructor(message = "Request timed out") {
    super(message, 408, "timeout_error");
    this.name = "TimeoutError";
  }
}
