"""Content-free team usage totals for the public dashboard."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta

ACTIVITY = ("retain", "recall", "reflect")
COUNTERS = (
    "retain_success",
    "retain_failure",
    "recall_success",
    "recall_failure",
    "reflect_success",
    "reflect_failure",
    "input_tokens",
    "output_tokens",
    "cached_input_tokens",
)
_RANGES = {"today": 1, "7d": 7, "30d": 30}


def parse_range(value: str | None) -> tuple[str, int]:
    """Return ``(name, day_count)``. An omitted range is 7 days. Anything else unknown raises."""
    if value is None:
        return "7d", 7
    span = _RANGES.get(value)
    if span is None:
        raise ValueError(value)
    return value, span


def user_id_from_schema(schema: str, prefix: str = "user") -> str | None:
    """Restore a Supabase UUID from ``{prefix}_<uuid with underscores>``."""
    match = re.fullmatch(
        rf"{re.escape(prefix)}_([0-9a-f]{{8}})_([0-9a-f]{{4}})_([0-9a-f]{{4}})_([0-9a-f]{{4}})_([0-9a-f]{{12}})",
        schema,
    )
    if match is None:
        return None
    return "-".join(match.groups())


def schema_from_user_id(user_id: str, prefix: str = "user") -> str | None:
    """Schema name for a Supabase user, or None when ``user_id`` is not a UUID."""
    if user_id_from_schema(f"{prefix}_{user_id.replace('-', '_')}", prefix) != user_id:
        return None
    return f"{prefix}_{user_id.replace('-', '_')}"


def operation_delta(operation: str, *, success: bool, cancelled: bool) -> dict[str, int] | None:
    """Counter increment for a terminal retain, recall, or reflect. Cancellations count as neither."""
    if cancelled or operation not in ACTIVITY:
        return None
    return {f"{operation}_{'success' if success else 'failure'}": 1}


@dataclass(frozen=True)
class Member:
    user_id: str
    email: str | None


@dataclass(frozen=True)
class DailyUsage:
    user_id: str
    day: date
    retain_success: int = 0
    retain_failure: int = 0
    recall_success: int = 0
    recall_failure: int = 0
    reflect_success: int = 0
    reflect_failure: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0
    banks: int | None = None
    documents: int | None = None
    memory_units: int | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True)
class UsageView:
    body: dict
    omitted_user_ids: list[str]


def _window(today: date, span_days: int) -> list[date]:
    start = today - timedelta(days=span_days - 1)
    return [start + timedelta(days=offset) for offset in range(span_days)]


def _empty_activity() -> dict:
    return {name: {"success": 0, "failure": 0} for name in ACTIVITY}


def _empty_tokens() -> dict:
    return {"input": 0, "output": 0, "cached_input": 0}


def _empty_footprint() -> dict:
    return {"banks": 0, "documents": 0, "memory_units": 0}


def _add_activity(total: dict, row: DailyUsage) -> None:
    for name in ACTIVITY:
        total[name]["success"] += getattr(row, f"{name}_success")
        total[name]["failure"] += getattr(row, f"{name}_failure")


def _add_tokens(total: dict, row: DailyUsage) -> None:
    total["input"] += row.input_tokens
    total["output"] += row.output_tokens
    total["cached_input"] += row.cached_input_tokens


def _point(day: date) -> dict:
    point = {"day": day.isoformat()}
    for name in COUNTERS:
        point[name] = 0
    return point


def _has_footprint(row: DailyUsage) -> bool:
    return row.banks is not None or row.documents is not None or row.memory_units is not None


def build_usage_view(
    members: list[Member],
    rows: list[DailyUsage],
    *,
    today: date,
    range_name: str,
    span_days: int,
) -> UsageView:
    """Public payload. Current members with an email only; their rows are the team total."""
    days = _window(today, span_days)
    day_set = set(days)
    listed: list[Member] = []
    omitted: list[str] = []
    for member in members:
        email = (member.email or "").strip()
        if not email:
            omitted.append(member.user_id)
            continue
        listed.append(Member(member.user_id, email))
    listed.sort(key=lambda member: member.email or "")
    listed_ids = {member.user_id for member in listed}
    scoped = [row for row in rows if row.user_id in listed_ids and row.day in day_set]

    team_activity = _empty_activity()
    team_tokens = _empty_tokens()
    team_series = {day: _point(day) for day in days}
    member_bodies = []
    snapshot_at: datetime | None = None
    team_footprint = _empty_footprint()

    for member in listed:
        mine = [row for row in scoped if row.user_id == member.user_id]
        activity = _empty_activity()
        tokens = _empty_tokens()
        series = {day: _point(day) for day in days}
        footprint_row: DailyUsage | None = None
        for row in mine:
            _add_activity(activity, row)
            _add_tokens(tokens, row)
            point = series[row.day]
            for name in COUNTERS:
                point[name] += getattr(row, name)
            if _has_footprint(row) and (footprint_row is None or row.day >= footprint_row.day):
                footprint_row = row
        footprint = _empty_footprint()
        if footprint_row is not None:
            footprint = {
                "banks": footprint_row.banks or 0,
                "documents": footprint_row.documents or 0,
                "memory_units": footprint_row.memory_units or 0,
            }
            if footprint_row.updated_at is not None and (snapshot_at is None or footprint_row.updated_at > snapshot_at):
                snapshot_at = footprint_row.updated_at
        for name in ("banks", "documents", "memory_units"):
            team_footprint[name] += footprint[name]
        for row in mine:
            _add_activity(team_activity, row)
            _add_tokens(team_tokens, row)
            point = team_series[row.day]
            for name in COUNTERS:
                point[name] += getattr(row, name)
        member_bodies.append(
            {
                "email": member.email,
                "activity": activity,
                "tokens": tokens,
                "footprint": footprint,
                "series": [series[day] for day in days],
            }
        )

    return UsageView(
        body={
            "range": range_name,
            "snapshot_at": snapshot_at.isoformat() if snapshot_at is not None else None,
            "team": {
                "activity": team_activity,
                "tokens": team_tokens,
                "footprint": team_footprint,
                "series": [team_series[day] for day in days],
            },
            "members": member_bodies,
        },
        omitted_user_ids=omitted,
    )
