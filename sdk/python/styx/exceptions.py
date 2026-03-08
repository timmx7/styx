"""Custom exceptions for the Styx SDK."""

from __future__ import annotations

from typing import Any, Optional


class StyxError(Exception):
    """Base exception for all Styx SDK errors.

    Attributes:
        message: Human-readable error description.
        status_code: HTTP status code from the API response, if available.
        body: Raw response body, if available.
        request_id: Styx request ID for debugging, if available.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        body: Optional[Any] = None,
        request_id: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.body = body
        self.request_id = request_id

    def __repr__(self) -> str:
        attrs = [f"message={self.message!r}"]
        if self.status_code is not None:
            attrs.append(f"status_code={self.status_code}")
        if self.request_id is not None:
            attrs.append(f"request_id={self.request_id!r}")
        return f"{self.__class__.__name__}({', '.join(attrs)})"


class AuthenticationError(StyxError):
    """Raised when the API key is invalid or missing (HTTP 401)."""

    def __init__(
        self,
        message: str = "Invalid or missing API key.",
        **kwargs: Any,
    ) -> None:
        super().__init__(message, **kwargs)


class PermissionDeniedError(StyxError):
    """Raised when the API key lacks permissions for the requested resource (HTTP 403)."""

    def __init__(
        self,
        message: str = "Permission denied for this resource.",
        **kwargs: Any,
    ) -> None:
        super().__init__(message, **kwargs)


class NotFoundError(StyxError):
    """Raised when the requested resource does not exist (HTTP 404)."""

    def __init__(
        self,
        message: str = "The requested resource was not found.",
        **kwargs: Any,
    ) -> None:
        super().__init__(message, **kwargs)


class RateLimitError(StyxError):
    """Raised when the rate limit has been exceeded (HTTP 429).

    Attributes:
        retry_after: Seconds to wait before retrying, if provided by the server.
    """

    def __init__(
        self,
        message: str = "Rate limit exceeded. Please retry after a delay.",
        *,
        retry_after: Optional[float] = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(message, **kwargs)
        self.retry_after = retry_after


class BudgetExceededError(StyxError):
    """Raised when the project or organization budget has been exceeded (HTTP 402).

    This is an Styx-specific error that occurs when spend tracking
    detects the configured budget limit has been reached.
    """

    def __init__(
        self,
        message: str = "Budget limit exceeded. Update your budget settings in the Styx dashboard.",
        **kwargs: Any,
    ) -> None:
        super().__init__(message, **kwargs)


class BadRequestError(StyxError):
    """Raised when the request is malformed (HTTP 400)."""

    def __init__(
        self,
        message: str = "The request was malformed.",
        **kwargs: Any,
    ) -> None:
        super().__init__(message, **kwargs)


class InternalServerError(StyxError):
    """Raised when the Styx server encounters an internal error (HTTP 500+)."""

    def __init__(
        self,
        message: str = "An internal server error occurred.",
        **kwargs: Any,
    ) -> None:
        super().__init__(message, **kwargs)


class ConnectionError(StyxError):
    """Raised when the SDK cannot connect to the Styx server."""

    def __init__(
        self,
        message: str = "Could not connect to the Styx server.",
        **kwargs: Any,
    ) -> None:
        super().__init__(message, **kwargs)


class TimeoutError(StyxError):
    """Raised when a request to the Styx server times out."""

    def __init__(
        self,
        message: str = "The request to Styx timed out.",
        **kwargs: Any,
    ) -> None:
        super().__init__(message, **kwargs)


class StreamError(StyxError):
    """Raised when an error occurs during SSE stream processing."""

    def __init__(
        self,
        message: str = "An error occurred while processing the stream.",
        **kwargs: Any,
    ) -> None:
        super().__init__(message, **kwargs)


# Mapping from HTTP status codes to exception classes.
STATUS_CODE_TO_EXCEPTION: dict[int, type[StyxError]] = {
    400: BadRequestError,
    401: AuthenticationError,
    402: BudgetExceededError,
    403: PermissionDeniedError,
    404: NotFoundError,
    408: TimeoutError,
    429: RateLimitError,
    500: InternalServerError,
    502: InternalServerError,
    503: InternalServerError,
    504: InternalServerError,
}


def raise_for_status(
    status_code: int,
    body: Any = None,
    request_id: Optional[str] = None,
) -> None:
    """Raise an appropriate StyxError based on the HTTP status code.

    Args:
        status_code: The HTTP status code from the response.
        body: The parsed response body, if available.
        request_id: The Styx request ID, if available.

    Raises:
        StyxError: A subclass matching the status code.
    """
    if 200 <= status_code < 300:
        return

    # Extract a human-readable message from the body if possible.
    message: Optional[str] = None
    if isinstance(body, dict):
        error_obj = body.get("error", body)
        if isinstance(error_obj, dict):
            message = error_obj.get("message")
        elif isinstance(error_obj, str):
            message = error_obj

    exc_cls = STATUS_CODE_TO_EXCEPTION.get(status_code, StyxError)
    kwargs: dict[str, Any] = {
        "status_code": status_code,
        "body": body,
        "request_id": request_id,
    }

    if exc_cls is RateLimitError:
        raise exc_cls(message=message or "Rate limit exceeded.", **kwargs)

    if message:
        raise exc_cls(message=message, **kwargs)
    raise exc_cls(message=f"HTTP {status_code} error", **kwargs)
