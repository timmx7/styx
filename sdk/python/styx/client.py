import os
from typing import Optional, Dict
from openai import OpenAI, AsyncOpenAI

_SDK_VERSION = "1.0.0"

def _build_styx_kwargs(
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    project_id: Optional[str] = None,
    target_provider: Optional[str] = None,
    routing_strategy: Optional[str] = None,
    end_user_id: Optional[str] = None,
    default_headers: Optional[Dict[str, str]] = None,
    **kwargs
) -> Dict:
    """Helper to construct kwargs for the OpenAI client subclasses."""
    api_key = api_key or os.environ.get("STYX_API_KEY")
    base_url = base_url or os.environ.get("STYX_BASE_URL", "https://api.styx.ai/v1")

    if not api_key:
        raise ValueError(
            "The STYX_API_KEY environment variable is missing or empty; either provide it, "
            "or instantiate the Styx client with an api_key argument."
        )

    headers = dict(default_headers) if default_headers else {}

    if project_id:
        headers["x-project-id"] = project_id
    if target_provider:
        headers["x-target-provider"] = target_provider
    if routing_strategy:
        headers["x-routing-strategy"] = routing_strategy
    if end_user_id:
        headers["x-end-user-id"] = end_user_id

    kwargs.update({
        "api_key": api_key,
        "base_url": base_url,
        "default_headers": headers,
    })
    return kwargs


class Styx(OpenAI):
    """
    Synchronous Styx client that extends the official OpenAI Python SDK.
    All calls are routed through the Styx gateway.
    """

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        project_id: Optional[str] = None,
        target_provider: Optional[str] = None,
        routing_strategy: Optional[str] = None,
        end_user_id: Optional[str] = None,
        **kwargs
    ):
        super().__init__(
            **_build_styx_kwargs(
                api_key=api_key,
                base_url=base_url,
                project_id=project_id,
                target_provider=target_provider,
                routing_strategy=routing_strategy,
                end_user_id=end_user_id,
                **kwargs
            )
        )


class AsyncStyx(AsyncOpenAI):
    """
    Asynchronous Styx client that extends the official AsyncOpenAI Python SDK.
    All calls are routed through the Styx gateway.
    """

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        project_id: Optional[str] = None,
        target_provider: Optional[str] = None,
        routing_strategy: Optional[str] = None,
        end_user_id: Optional[str] = None,
        **kwargs
    ):
        super().__init__(
            **_build_styx_kwargs(
                api_key=api_key,
                base_url=base_url,
                project_id=project_id,
                target_provider=target_provider,
                routing_strategy=routing_strategy,
                end_user_id=end_user_id,
                **kwargs
            )
        )
