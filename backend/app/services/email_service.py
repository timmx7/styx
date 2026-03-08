"""Email service: send transactional emails via console, SMTP, or SendGrid.

The email provider is configurable via the EMAIL_PROVIDER env variable.
In development, "console" prints emails to stdout for easy debugging.
In production, use "smtp" or "sendgrid".

All send functions are async and fire-and-forget: failures are logged
but never bubble up to the caller. An email that fails to send should
not block user-facing operations.
"""

import asyncio
import html as html_mod
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Protocol

import httpx

from app.config import settings

logger = logging.getLogger("email")


# ─── Email provider interface ──────────────────────────────────────

class EmailProvider(Protocol):
    """Interface for email sending backends."""

    async def send(self, to_email: str, subject: str, html_body: str, text_body: str) -> bool:
        """Send an email. Returns True on success, False on failure."""
        ...


# ─── Console provider (development) ───────────────────────────────

class ConsoleEmailProvider:
    """Prints emails to stdout — perfect for local development and tests."""

    async def send(self, to_email: str, subject: str, html_body: str, text_body: str) -> bool:
        border = "=" * 60
        logger.info(
            "\n%s\n"
            "📧 EMAIL (console provider)\n"
            "To: %s\n"
            "Subject: %s\n"
            "%s\n"
            "%s\n"
            "%s",
            border, to_email, subject, border, text_body, border,
        )
        return True


# ─── SMTP provider ────────────────────────────────────────────────

class SMTPEmailProvider:
    """Sends emails via SMTP (works with any SMTP server).

    Uses asyncio.to_thread to avoid blocking the event loop.
    """

    def _send_sync(self, to_email: str, subject: str, html_body: str, text_body: str) -> bool:
        """Synchronous SMTP send — runs in a thread pool."""
        msg = MIMEMultipart("alternative")
        msg["From"] = f"{settings.email_from_name} <{settings.email_from_address}>"
        msg["To"] = to_email
        msg["Subject"] = subject

        msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            if settings.smtp_use_tls:
                server.starttls()
            if settings.smtp_username:
                server.login(settings.smtp_username, settings.smtp_password)
            server.send_message(msg)
        return True

    async def send(self, to_email: str, subject: str, html_body: str, text_body: str) -> bool:
        try:
            await asyncio.to_thread(self._send_sync, to_email, subject, html_body, text_body)
            logger.info("email sent via SMTP", extra={"to": to_email, "subject": subject})
            return True
        except Exception:
            logger.exception("failed to send email via SMTP", extra={"to": to_email})
            return False


# ─── SendGrid provider ────────────────────────────────────────────

class SendGridEmailProvider:
    """Sends emails via the SendGrid v3 API."""

    API_URL = "https://api.sendgrid.com/v3/mail/send"

    async def send(self, to_email: str, subject: str, html_body: str, text_body: str) -> bool:
        try:
            payload = {
                "personalizations": [{"to": [{"email": to_email}]}],
                "from": {
                    "email": settings.email_from_address,
                    "name": settings.email_from_name,
                },
                "subject": subject,
                "content": [
                    {"type": "text/plain", "value": text_body},
                    {"type": "text/html", "value": html_body},
                ],
            }
            headers = {
                "Authorization": f"Bearer {settings.sendgrid_api_key}",
                "Content-Type": "application/json",
            }
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(self.API_URL, json=payload, headers=headers)
                resp.raise_for_status()

            logger.info("email sent via SendGrid", extra={"to": to_email, "subject": subject})
            return True
        except Exception:
            logger.exception("failed to send email via SendGrid", extra={"to": to_email})
            return False


# ─── Provider factory ─────────────────────────────────────────────

def _get_provider() -> EmailProvider:
    """Return the configured email provider instance."""
    match settings.email_provider:
        case "smtp":
            return SMTPEmailProvider()
        case "sendgrid":
            return SendGridEmailProvider()
        case _:
            return ConsoleEmailProvider()


_provider: EmailProvider | None = None


def get_email_provider() -> EmailProvider:
    """Lazy-initialize and return the email provider singleton."""
    global _provider
    if _provider is None:
        _provider = _get_provider()
    return _provider


# ─── Email templates ──────────────────────────────────────────────

async def send_password_reset_email(to_email: str, token: str, user_name: str | None = None) -> bool:
    """Send a password reset email with the reset link.

    Args:
        to_email: Recipient email address.
        token: The plain reset token (included in the link).
        user_name: Optional user name for personalization.

    Returns:
        True if the email was sent successfully.
    """
    reset_url = f"{settings.frontend_url}/auth/reset-password?token={token}"
    safe_name = html_mod.escape(user_name) if user_name else None
    greeting = f"Hi {safe_name}" if safe_name else "Hi"

    subject = "Reset your Styx password"

    text_body = (
        f"{greeting},\n\n"
        "We received a request to reset your password.\n\n"
        f"Click the link below to set a new password:\n{reset_url}\n\n"
        f"This link will expire in {settings.password_reset_token_expire_minutes} minutes.\n\n"
        "If you didn't request this, you can safely ignore this email.\n\n"
        "— The Styx team"
    )

    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #0f172a; font-size: 24px;">Styx</h1>
        </div>
        <p style="color: #334155; font-size: 16px;">{greeting},</p>
        <p style="color: #334155; font-size: 16px;">We received a request to reset your password.</p>
        <div style="text-align: center; margin: 30px 0;">
            <a href="{reset_url}"
               style="background-color: #2563eb; color: white; padding: 12px 32px;
                      text-decoration: none; border-radius: 6px; font-weight: 600;
                      font-size: 16px; display: inline-block;">
                Reset Password
            </a>
        </div>
        <p style="color: #64748b; font-size: 14px;">
            This link will expire in {settings.password_reset_token_expire_minutes} minutes.
        </p>
        <p style="color: #64748b; font-size: 14px;">
            If you didn't request this, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
        <p style="color: #94a3b8; font-size: 12px; text-align: center;">
            Styx &mdash; Intelligent AI Gateway
        </p>
    </div>
    """

    provider = get_email_provider()
    return await provider.send(to_email, subject, html_body, text_body)


async def send_email_verification(to_email: str, token: str, user_name: str | None = None) -> bool:
    """Send an email verification email with the verification link.

    Args:
        to_email: Recipient email address.
        token: The plain verification token (included in the link).
        user_name: Optional user name for personalization.

    Returns:
        True if the email was sent successfully.
    """
    verify_url = f"{settings.frontend_url}/auth/verify-email?token={token}"
    safe_name = html_mod.escape(user_name) if user_name else None
    greeting = f"Hi {safe_name}" if safe_name else "Hi"

    subject = "Verify your Styx email address"

    text_body = (
        f"{greeting},\n\n"
        "Welcome to Styx! Please verify your email address.\n\n"
        f"Click the link below to confirm your email:\n{verify_url}\n\n"
        f"This link will expire in {settings.email_verification_token_expire_hours} hours.\n\n"
        "— The Styx team"
    )

    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #0f172a; font-size: 24px;">Styx</h1>
        </div>
        <p style="color: #334155; font-size: 16px;">{greeting},</p>
        <p style="color: #334155; font-size: 16px;">Welcome to Styx! Please verify your email address to get started.</p>
        <div style="text-align: center; margin: 30px 0;">
            <a href="{verify_url}"
               style="background-color: #2563eb; color: white; padding: 12px 32px;
                      text-decoration: none; border-radius: 6px; font-weight: 600;
                      font-size: 16px; display: inline-block;">
                Verify Email
            </a>
        </div>
        <p style="color: #64748b; font-size: 14px;">
            This link will expire in {settings.email_verification_token_expire_hours} hours.
        </p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
        <p style="color: #94a3b8; font-size: 12px; text-align: center;">
            Styx &mdash; Intelligent AI Gateway
        </p>
    </div>
    """

    provider = get_email_provider()
    return await provider.send(to_email, subject, html_body, text_body)


async def send_team_invitation_email(
    to_email: str,
    token: str,
    team_name: str,
    role: str,
    inviter_name: str | None = None,
) -> bool:
    """Send a team invitation email with the accept link.

    Args:
        to_email: Recipient email address.
        token: The plain invitation token (included in the link).
        team_name: Name of the team the user is being invited to.
        role: The role the user will have (admin, member).
        inviter_name: Optional name of the person who sent the invite.

    Returns:
        True if the email was sent successfully.
    """
    accept_url = f"{settings.frontend_url}/teams/accept-invite?token={token}"
    safe_inviter = html_mod.escape(inviter_name) if inviter_name else "A team administrator"
    safe_team = html_mod.escape(team_name)
    inviter = safe_inviter

    subject = f"You're invited to join {safe_team} on Styx"

    text_body = (
        f"Hi,\n\n"
        f"{inviter} has invited you to join the team \"{team_name}\" "
        f"as a {role} on Styx.\n\n"
        f"Click the link below to accept the invitation:\n{accept_url}\n\n"
        f"This invitation will expire in {settings.team_invitation_expire_days} days.\n\n"
        "If you don't have an Styx account yet, you'll need to register first.\n\n"
        "— The Styx team"
    )

    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #0f172a; font-size: 24px;">Styx</h1>
        </div>
        <p style="color: #334155; font-size: 16px;">Hi,</p>
        <p style="color: #334155; font-size: 16px;">
            <strong>{safe_inviter}</strong> has invited you to join the team
            <strong>{safe_team}</strong> as a <strong>{html_mod.escape(role)}</strong>.
        </p>
        <div style="text-align: center; margin: 30px 0;">
            <a href="{accept_url}"
               style="background-color: #2563eb; color: white; padding: 12px 32px;
                      text-decoration: none; border-radius: 6px; font-weight: 600;
                      font-size: 16px; display: inline-block;">
                Accept Invitation
            </a>
        </div>
        <p style="color: #64748b; font-size: 14px;">
            This invitation will expire in {settings.team_invitation_expire_days} days.
        </p>
        <p style="color: #64748b; font-size: 14px;">
            If you don't have an Styx account yet, you'll need to register first.
        </p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
        <p style="color: #94a3b8; font-size: 12px; text-align: center;">
            Styx &mdash; Intelligent AI Gateway
        </p>
    </div>
    """

    provider = get_email_provider()
    return await provider.send(to_email, subject, html_body, text_body)
