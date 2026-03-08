"""Alert service — create and manage budget/system alerts."""

import html as html_mod
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy import extract, select, desc, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.alert import Alert

logger = logging.getLogger("alert_service")


async def create_alert(
    db: AsyncSession,
    *,
    project_id: str,
    team_id: str,
    alert_type: str,
    severity: str,
    title: str,
    message: str,
    budget_cents: int | None = None,
    spent_cents: int | None = None,
    threshold_pct: int | None = None,
) -> Alert:
    """Create a new alert."""
    alert = Alert(
        project_id=project_id,
        team_id=team_id,
        alert_type=alert_type,
        severity=severity,
        title=title,
        message=message,
        budget_cents=budget_cents,
        spent_cents=spent_cents,
        threshold_pct=threshold_pct,
    )
    db.add(alert)
    await db.flush()
    logger.info(
        "Alert created: type=%s severity=%s project=%s",
        alert_type,
        severity,
        project_id,
    )
    return alert


async def _send_alert_notifications(alert: Alert) -> None:
    """Send alert notifications via configured channels (Slack, email).

    This is fire-and-forget — notification failures never block the main flow.
    """
    # ─── Slack webhook notification ───────────────────────────────
    slack_webhook_url = getattr(settings, "slack_webhook_url", "")
    if slack_webhook_url:
        # SSRF protection: validate the Slack webhook URL targets a public host
        from app.services.webhook_service import _is_safe_url

        if not await _is_safe_url(slack_webhook_url):
            logger.warning(
                "Slack webhook URL blocked: targets private/internal network",
                extra={"url": slack_webhook_url[:50]},
            )
            slack_webhook_url = ""  # skip sending
    if slack_webhook_url:
        try:
            severity_emoji = {"critical": "🔴", "warning": "🟡", "info": "🔵"}.get(
                alert.severity, "⚪"
            )
            payload = {
                "text": f"{severity_emoji} *{alert.title}*",
                "blocks": [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": (
                                f"{severity_emoji} *{alert.title}*\n"
                                f"{alert.message}\n\n"
                                f"• *Type:* `{alert.alert_type}`\n"
                                f"• *Severity:* `{alert.severity}`\n"
                                f"• *Project:* `{alert.project_id}`"
                            ),
                        },
                    }
                ],
            }
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(slack_webhook_url, json=payload)
                if resp.status_code == 200:
                    logger.info("Slack notification sent for alert %s", alert.id)
                else:
                    logger.warning(
                        "Slack notification failed: status=%d body=%s",
                        resp.status_code,
                        resp.text[:200],
                    )
        except Exception as exc:
            logger.warning("Slack notification error: %s", exc)

    # ─── Email notification (via configured email provider) ───────
    try:
        from app.services.email_service import get_email_provider

        provider = get_email_provider()
        severity_label = alert.severity.upper()
        safe_title = html_mod.escape(alert.title)
        safe_message = html_mod.escape(alert.message)
        safe_type = html_mod.escape(alert.alert_type)
        safe_severity = html_mod.escape(alert.severity)
        safe_project = html_mod.escape(alert.project_id)
        subject = f"[Styx {severity_label}] {alert.title}"
        html_body = f"""
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: {'#dc2626' if alert.severity == 'critical' else '#f59e0b'};">
                {safe_title}
            </h2>
            <p>{safe_message}</p>
            <hr style="border: 1px solid #e5e7eb;">
            <table style="width: 100%; font-size: 14px;">
                <tr><td><strong>Type:</strong></td><td>{safe_type}</td></tr>
                <tr><td><strong>Severity:</strong></td><td>{safe_severity}</td></tr>
                <tr><td><strong>Project:</strong></td><td>{safe_project}</td></tr>
            </table>
            <p style="margin-top: 20px; font-size: 12px; color: #6b7280;">
                This is an automated notification from Styx.
                <a href="{settings.frontend_url}/alerts">View all alerts</a>
            </p>
        </div>
        """
        # Send to a notification email if configured
        notification_email = getattr(settings, "notification_email", "")
        if notification_email:
            await provider.send(
                to_email=notification_email,
                subject=subject,
                html_body=html_body,
                text_body=subject,
            )
            logger.info("Email notification sent for alert %s", alert.id)
    except Exception as exc:
        logger.warning("Email notification error: %s", exc)


async def check_and_create_budget_alerts(
    db: AsyncSession,
    *,
    project_id: str,
    team_id: str,
    project_name: str,
    budget_cents: int,
    spent_cents: int,
    threshold_pct: int = 80,
) -> list[Alert]:
    """Check spend against budget thresholds and create alerts if needed.

    Creates alerts at:
    - threshold_pct (default 80%) → warning
    - 100% → critical (budget exceeded)
    """
    if budget_cents <= 0:
        return []

    pct_used = (spent_cents / budget_cents) * 100
    alerts_created: list[Alert] = []

    # Monthly dedup: only create one alert per type per project per calendar month
    now = datetime.now(timezone.utc)
    current_month = now.month
    current_year = now.year

    if pct_used >= 100:
        # Budget exceeded — check for existing alert THIS MONTH
        existing = await db.execute(
            select(Alert).where(
                Alert.project_id == project_id,
                Alert.alert_type == "budget_exceeded",
                extract("month", Alert.created_at) == current_month,
                extract("year", Alert.created_at) == current_year,
            ).order_by(desc(Alert.created_at)).limit(1)
        )
        if existing.scalar_one_or_none() is None:
            alert = await create_alert(
                db,
                project_id=project_id,
                team_id=team_id,
                alert_type="budget_exceeded",
                severity="critical",
                title=f"Budget exceeded for '{project_name}'",
                message=(
                    f"Project '{project_name}' has spent ${spent_cents/100:.2f} "
                    f"of its ${budget_cents/100:.2f} monthly budget. "
                    f"Requests will be blocked until the budget is increased or the month resets."
                ),
                budget_cents=budget_cents,
                spent_cents=spent_cents,
                threshold_pct=100,
            )
            alerts_created.append(alert)
            await _send_alert_notifications(alert)

    elif pct_used >= threshold_pct:
        # Warning threshold — check for existing alert THIS MONTH
        existing = await db.execute(
            select(Alert).where(
                Alert.project_id == project_id,
                Alert.alert_type == "budget_warning",
                extract("month", Alert.created_at) == current_month,
                extract("year", Alert.created_at) == current_year,
            ).order_by(desc(Alert.created_at)).limit(1)
        )
        if existing.scalar_one_or_none() is None:
            alert = await create_alert(
                db,
                project_id=project_id,
                team_id=team_id,
                alert_type="budget_warning",
                severity="warning",
                title=f"Budget alert for '{project_name}' ({pct_used:.0f}%)",
                message=(
                    f"Project '{project_name}' has used {pct_used:.0f}% of its "
                    f"${budget_cents/100:.2f} monthly budget (${spent_cents/100:.2f} spent). "
                    f"Consider increasing the budget or monitoring usage."
                ),
                budget_cents=budget_cents,
                spent_cents=spent_cents,
                threshold_pct=threshold_pct,
            )
            alerts_created.append(alert)
            await _send_alert_notifications(alert)

    return alerts_created


# ═══════════════════════════════════════════════════════════════════════
# Billing-specific alerts (Charon quota, Achilles credits)
# ═══════════════════════════════════════════════════════════════════════


async def check_quota_alert(
    db: AsyncSession,
    *,
    user_id: str,
    team_id: str,
    requests_used: int,
    requests_limit: int,
) -> Alert | None:
    """Create a warning alert when Charon quota reaches 80%. Monthly dedup."""
    if requests_limit <= 0:
        return None

    pct = (requests_used / requests_limit) * 100
    if pct < 80:
        return None

    now = datetime.now(timezone.utc)
    existing = await db.execute(
        select(Alert).where(
            Alert.team_id == team_id,
            Alert.alert_type == "quota_80pct",
            extract("month", Alert.created_at) == now.month,
            extract("year", Alert.created_at) == now.year,
        ).limit(1)
    )
    if existing.scalar_one_or_none() is not None:
        return None

    alert = await create_alert(
        db,
        project_id="",
        team_id=team_id,
        alert_type="quota_80pct",
        severity="warning",
        title=f"Request quota at {pct:.0f}%",
        message=(
            f"You have used {requests_used:,} of {requests_limit:,} monthly requests "
            f"({pct:.0f}%). Consider upgrading your plan."
        ),
        threshold_pct=80,
    )
    await _send_alert_notifications(alert)
    return alert


async def check_credits_low_alert(
    db: AsyncSession,
    *,
    user_id: str,
    team_id: str,
    balance_cents: int,
) -> Alert | None:
    """Create a warning alert when Achilles credit balance drops below $2. Monthly dedup."""
    if balance_cents >= 200:
        return None

    now = datetime.now(timezone.utc)
    existing = await db.execute(
        select(Alert).where(
            Alert.team_id == team_id,
            Alert.alert_type == "credits_low",
            extract("month", Alert.created_at) == now.month,
            extract("year", Alert.created_at) == now.year,
        ).limit(1)
    )
    if existing.scalar_one_or_none() is not None:
        return None

    alert = await create_alert(
        db,
        project_id="",
        team_id=team_id,
        alert_type="credits_low",
        severity="warning",
        title="Credit balance low",
        message=(
            f"Your credit balance is ${balance_cents / 100:.2f}. "
            f"Purchase more credits to avoid service interruption."
        ),
    )
    await _send_alert_notifications(alert)
    return alert


async def get_alerts_for_user(
    db: AsyncSession,
    team_ids: list[str],
    limit: int = 50,
    unread_only: bool = False,
) -> list[Alert]:
    """Get alerts for all teams the user owns."""
    if not team_ids:
        return []

    query = (
        select(Alert)
        .where(Alert.team_id.in_(team_ids))
        .order_by(desc(Alert.created_at))
        .limit(limit)
    )
    if unread_only:
        query = query.where(Alert.is_read.is_(False))

    result = await db.execute(query)
    return list(result.scalars().all())


async def mark_alert_read(
    db: AsyncSession, alert_id: str, team_ids: list[str] | None = None
) -> bool:
    """Mark a single alert as read. Optionally verify team ownership."""
    query = update(Alert).where(Alert.id == alert_id).values(is_read=True)
    if team_ids is not None:
        query = query.where(Alert.team_id.in_(team_ids))
    result = await db.execute(query)
    return result.rowcount > 0  # type: ignore


async def mark_all_read(db: AsyncSession, team_ids: list[str]) -> int:
    """Mark all alerts as read for the given teams."""
    result = await db.execute(
        update(Alert)
        .where(Alert.team_id.in_(team_ids), Alert.is_read.is_(False))
        .values(is_read=True)
    )
    return result.rowcount  # type: ignore
