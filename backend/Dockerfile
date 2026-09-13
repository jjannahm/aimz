FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml alembic.ini ./
COPY app ./app
COPY migrations ./migrations
# Shipped so one-off data operations (e.g. the D1->RDS import) can run inside
# the container over SSM, the same way migrations do.
COPY scripts ./scripts

RUN pip install --no-cache-dir . \
    && useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin aimz

# The API needs nothing root can do. A process that is compromised through a
# request should not also own the container.
USER aimz

EXPOSE 8000

# --no-server-header: the response need not tell a stranger which server and
# version to look up vulnerabilities for.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header"]
