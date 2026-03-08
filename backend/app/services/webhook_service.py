"""Webhook delivery service — fires HTTP callbacks for subscribed events.

Delivery is async, with retry logic and automatic disabling after
repeated failures. Payloads are HMAC-signed with the webhook's secret.
"""

import hashlib
import hmac
import ipaddress
import json
import logging
import socket
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.webhook import WebhookEndpoint, WebhookDelivery

logger = logging.getLogger("webhook")

# Disable a webhook after this many consecutive failures
_MAX_CONSECUTIVE_FAILURES = 10

# Timeout for webhook delivery
_DELIVERY_TIMEOUT = 10  # seconds

# ─── SSRF protection ────────────────────────────────────────────────────

_BLOCKED_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),       # loopback
    ipaddress.ip_network("10.0.0.0/8"),         # private class A
    ipaddress.ip_network("172.16.0.0/12"),      # private class B
    ipaddress.ip_network("192.168.0.0/16"),     # private class C
    ipaddress.ip_network("169.254.0.0/16"),     # link-local (AWS metadata)
    ipaddress.ip_network("::1/128"),            # IPv6 loopback
    ipaddress.ip_network("fc00::/7"),           # IPv6 unique local
    ipaddress.ip_network("fe80::/10"),          # IPv6 link-local
]


async def _is_safe_url(url: str) -> bool:
    """Check if a webhook URL is safe (not targeting internal/private networks).

    Uses asyncio DNS resolution to avoid blocking the event loop.
    """
    import asyncio

    try:
        parsed = urlparse(url)
        hostname = parsed.hostname
        if not hostname:
            return False
        lower = hostname.lower()
        if lower in ("localhost", "metadata.google.internal"):
            return False
        if lower.endswith(".internal") or lower.endswith(".local"):
            return False
        loop = asyncio.get_running_loop()
        infos = await loop.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
        for info in infos:
            addr = info[4][0]
            ip = ipaddress.ip_address(addr)
            for network in _BLOCKED_NETWORKS:
                if ip in network:
                    return False
        return True
    except (socket.gaierror, ValueError, OSError):
        return False


def _sign_payload(payload: bytes, secret: str) -> str:
    """Create HMAC-SHA256 signature for webhook payload verification."""
    return hmac.new(
        secret.encode("utf-8"),
        payload,
        hashlib.sha256,
    ).hexdigest()


async def fire_event(
    db: AsyncSession,
    *,
    team_id: str,
    event: str,
    data: dict,
) -> int:
    """Send a webhook event to all active subscribers for this team.

    Returns the number of successful deliveries.
    """
    result = await db.execute(
        select(WebhookEndpoint).where(
            WebhookEndpoint.team_id == team_id,
            WebhookEndpoint.is_active.is_(True),
        )
    )
    webhooks = result.scalars().all()

    delivered = 0
    for wh in webhooks:
        # Check if this webhook subscribes to this event
        if wh.events and event not in wh.events:
            continue

        success = await _deliver(wh, event, data, db)
        if success:
            wh.last_triggered_at = datetime.now(timezone.utc)
            wh.consecutive_failures = 0
            delivered += 1
        else:
            current_failures = wh.consecutive_failures or 0
            wh.consecutive_failures = current_failures + 1
            if wh.consecutive_failures >= _MAX_CONSECUTIVE_FAILURES:
                wh.is_active = False
                logger.warning(
                    "webhook disabled after %d failures",
                    _MAX_CONSECUTIVE_FAILURES,
                    extra={"webhook_id": str(wh.id), "url": wh.url},
                )

    return delivered


async def _deliver(webhook: WebhookEndpoint, event: str, data: dict, db: AsyncSession | None = None) -> bool:
    """Deliver a single webhook with HMAC signature and retry.

    Includes SSRF protection: blocks delivery to private/internal networks.
    """
    delivery = WebhookDelivery(
        endpoint_id=webhook.id,
        event_type=event,
        payload=json.dumps(data),
        success=False,
    )
    if db:
        db.add(delivery)

    if not await _is_safe_url(webhook.url):
        logger.warning("webhook blocked: URL targets private network", extra={"url": webhook.url})
        delivery.response_body = "Blocked: Private network IP"
        if db:
            await db.flush()
        return False

    payload = json.dumps({
        "event": event,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data,
    }).encode("utf-8")

    signature = _sign_payload(payload, webhook.secret)

    headers = {
        "Content-Type": "application/json",
        "X-Styx-Event": event,
        "X-Styx-Signature": f"sha256={signature}",
        "X-Styx-Timestamp": str(int(time.time())),
        "User-Agent": "Styx-Webhook/1.0",
    }

    try:
        async with httpx.AsyncClient(timeout=_DELIVERY_TIMEOUT) as client:
            resp = await client.post(str(webhook.url), content=payload, headers=headers)
            delivery.response_status = resp.status_code
            delivery.response_body = str(resp.text)[:1024]

            if resp.status_code < 300:
                logger.debug("webhook delivered", extra={"url": webhook.url, "event": event})
                delivery.success = True
                if db:
                    await db.flush()
                return True
            else:
                logger.warning(
                    "webhook delivery failed",
                    extra={"url": webhook.url, "status": resp.status_code},
                )
                if db:
                    await db.flush()
                return False
    except Exception as exc:
        delivery.response_body = str(exc)[:1024]
        logger.warning("webhook delivery error", extra={"url": webhook.url, "error": str(exc)})
        if db:
            await db.flush()
        return False
