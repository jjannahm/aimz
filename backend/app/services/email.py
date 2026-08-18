from email.message import EmailMessage

import aiosmtplib

from app.core.config import settings


async def send_password_reset(email: str, code: str) -> None:
    if not settings.smtp_host:
        if settings.environment == "production":
            raise RuntimeError("SMTP_HOST is required in production")
        return

    message = EmailMessage()
    message["From"] = str(settings.smtp_from_email)
    message["To"] = email
    message["Subject"] = "Your AIMZ Egypt password reset code"
    message.set_content(
        f"Your AIMZ Egypt password reset code is {code}. "
        f"It expires in {settings.password_reset_minutes} minutes."
    )
    await aiosmtplib.send(
        message,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_username,
        password=settings.smtp_password,
        start_tls=settings.smtp_start_tls,
    )
