"""HTTP payload for the public team usage read."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from datetime import date, datetime, timezone

from fastapi import HTTPException

from hindsight_api.usage.view import DailyUsage, Member, build_usage_view, parse_range

logger = logging.getLogger(__name__)


class UsageReadError(Exception):
    """The ledger or account directory could not be read. Nothing partial is returned."""


Loader = Callable[[], Awaitable[tuple[list[Member], list[DailyUsage]]]]


async def team_usage_payload(
    *,
    range_value: str | None,
    extension_active: bool,
    today: date | None = None,
    load: Loader,
) -> dict:
    if not extension_active:
        raise HTTPException(status_code=404, detail="Team usage is not enabled.")
    try:
        range_name, span_days = parse_range(range_value)
    except ValueError:
        raise HTTPException(status_code=400, detail="range must be today, 7d, or 30d") from None
    try:
        members, rows = await load()
    except UsageReadError:
        logger.exception("Team usage read failed")
        raise HTTPException(status_code=503, detail="Team usage is unavailable.") from None
    view = build_usage_view(
        members,
        rows,
        today=today or datetime.now(timezone.utc).date(),
        range_name=range_name,
        span_days=span_days,
    )
    if view.omitted_user_ids:
        logger.warning("Omitting team members with no email from public usage: %s", view.omitted_user_ids)
    return view.body
