"""Small live-endpoint polling load probe.

Set AIMZ_API_URL, AIMZ_ACCESS_TOKEN, and AIMZ_MATCH_ID before running.
This intentionally uses the same 12-second cadence as the mobile app.
"""

import asyncio
import os
import statistics
import time

import httpx

API_URL = os.getenv("AIMZ_API_URL", "http://127.0.0.1:8000")
TOKEN = os.environ["AIMZ_ACCESS_TOKEN"]
MATCH_ID = os.environ["AIMZ_MATCH_ID"]
CLIENTS = int(os.getenv("AIMZ_LOAD_CLIENTS", "1000"))
ROUNDS = int(os.getenv("AIMZ_LOAD_ROUNDS", "3"))


async def poll(client: httpx.AsyncClient) -> tuple[float, int]:
    started = time.perf_counter()
    response = await client.get(
        f"{API_URL}/api/v1/matches/{MATCH_ID}/live",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    return (time.perf_counter() - started) * 1000, response.status_code


async def main() -> None:
    limits = httpx.Limits(max_connections=CLIENTS, max_keepalive_connections=CLIENTS)
    latencies: list[float] = []
    statuses: list[int] = []
    async with httpx.AsyncClient(timeout=10, limits=limits) as client:
        for round_number in range(ROUNDS):
            results = await asyncio.gather(*(poll(client) for _ in range(CLIENTS)))
            latencies.extend(latency for latency, _ in results)
            statuses.extend(status for _, status in results)
            if round_number + 1 < ROUNDS:
                await asyncio.sleep(12)
    sorted_latencies = sorted(latencies)
    p95 = sorted_latencies[int(len(sorted_latencies) * 0.95) - 1]
    failures = sum(status not in {200, 304} for status in statuses)
    print(
        f"requests={len(statuses)} failures={failures} "
        f"mean_ms={statistics.mean(latencies):.1f} p95_ms={p95:.1f}"
    )
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    asyncio.run(main())
