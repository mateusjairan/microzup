import asyncio
import sys


def configure_event_loop() -> None:
    """psycopg async não suporta ProactorEventLoop; no Windows usamos Selector."""
    if sys.platform != "win32":
        return
    policy_factory = getattr(asyncio, "WindowsSelectorEventLoopPolicy", None)
    if policy_factory is not None:
        asyncio.set_event_loop_policy(policy_factory())
