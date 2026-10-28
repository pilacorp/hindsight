"""Schedule content-free usage counter writes. Failures stay off the memory operation."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from hindsight_api.usage.view import operation_delta, user_id_from_schema

logger = logging.getLogger(__name__)


def note_operation(schema: str | None, operation: str, success: bool, cancelled: bool, prefix: str = "user") -> None:
    delta = operation_delta(operation, success=success, cancelled=cancelled)
    if delta is None or not schema:
        return
    user_id = user_id_from_schema(schema, prefix)
    if user_id is None:
        return
    _schedule(user_id, delta)


def note_tokens(
    schema: str | None,
    input_tokens: int,
    output_tokens: int,
    cached_input_tokens: int,
    prefix: str = "user",
) -> None:
    if not schema or (input_tokens == 0 and output_tokens == 0 and cached_input_tokens == 0):
        return
    user_id = user_id_from_schema(schema, prefix)
    if user_id is None:
        return
    _schedule(
        user_id,
        {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cached_input_tokens": cached_input_tokens,
        },
    )


def note_current_operation(operation: str, success: bool, cancelled: bool) -> None:
    """Record a terminal operation for the schema already bound to this task. Never raises."""
    try:
        from hindsight_api.engine.memory_engine import get_current_schema

        note_operation(get_current_schema(), operation, success, cancelled)
    except Exception:
        logger.exception("Usage operation note failed")


def note_current_tokens(input_tokens: int, output_tokens: int, cached_input_tokens: int) -> None:
    """Add reported LLM tokens for the current schema, including consolidation. Never raises."""
    try:
        from hindsight_api.engine.memory_engine import get_current_schema

        note_tokens(get_current_schema(), input_tokens, output_tokens, cached_input_tokens)
    except Exception:
        logger.exception("Usage token note failed")


def _schedule(user_id: str, delta: dict[str, int]) -> None:
    from hindsight_api.usage.store import get_usage_store

    store = get_usage_store()
    if store is None:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(store.add_counts(user_id, datetime.now(timezone.utc).date(), delta))
    task.add_done_callback(_log_task_failure)


def _log_task_failure(task: asyncio.Task) -> None:
    try:
        task.result()
    except asyncio.CancelledError:
        return
    except Exception:
        logger.exception("Usage counter write failed")
