"""Public team usage dashboard. Planned cases from specs/usage-dashboard.md."""

from datetime import date, datetime, timezone
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hindsight_api.api import create_app
from hindsight_api.usage.http import UsageReadError, team_usage_payload
from hindsight_api.usage.view import (
    DailyUsage,
    Member,
    build_usage_view,
    operation_delta,
    parse_range,
    user_id_from_schema,
)

TODAY = date(2026, 10, 28)
USER_A = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
USER_B = "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee"
USER_GONE = "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee"


def _row(user_id: str, day: date, **counts) -> DailyUsage:
    return DailyUsage(user_id=user_id, day=day, **counts)


def test_seven_day_window_sums_inside_and_drops_the_day_before():
    members = [Member(USER_A, "a@example.com")]
    rows = [
        _row(USER_A, date(2026, 10, 22), retain_success=2, retain_failure=1, input_tokens=10),
        _row(USER_A, date(2026, 10, 21), retain_success=9, input_tokens=99),
        _row(USER_A, date(2026, 10, 28), recall_success=3, output_tokens=4, cached_input_tokens=1),
    ]
    body = build_usage_view(members, rows, today=TODAY, range_name="7d", span_days=7).body
    activity = body["team"]["activity"]
    assert activity["retain"] == {"success": 2, "failure": 1}
    assert activity["recall"] == {"success": 3, "failure": 0}
    assert activity["reflect"] == {"success": 0, "failure": 0}
    assert body["team"]["tokens"] == {"input": 10, "output": 4, "cached_input": 1}
    assert [point["day"] for point in body["team"]["series"]][0] == "2026-10-22"
    assert [point["day"] for point in body["team"]["series"]][-1] == "2026-10-28"
    assert len(body["team"]["series"]) == 7


def test_deleted_user_row_is_left_out_of_members_and_the_team_total():
    members = [Member(USER_A, "a@example.com")]
    rows = [
        _row(USER_A, TODAY, retain_success=1),
        _row(USER_GONE, TODAY, retain_success=5, input_tokens=50),
    ]
    body = build_usage_view(members, rows, today=TODAY, range_name="today", span_days=1).body
    assert body["team"]["activity"]["retain"]["success"] == 1
    assert body["team"]["tokens"]["input"] == 0
    assert [member["email"] for member in body["members"]] == ["a@example.com"]


def test_current_user_with_no_rows_is_listed_with_zeros():
    body = build_usage_view(
        [Member(USER_A, "a@example.com")],
        [],
        today=TODAY,
        range_name="7d",
        span_days=7,
    ).body
    member = body["members"][0]
    assert member["email"] == "a@example.com"
    assert member["activity"]["retain"] == {"success": 0, "failure": 0}
    assert member["tokens"] == {"input": 0, "output": 0, "cached_input": 0}
    assert member["footprint"] == {"banks": 0, "documents": 0, "memory_units": 0}


def test_members_are_sorted_by_email_and_blank_email_is_omitted():
    view = build_usage_view(
        [Member(USER_A, "  "), Member(USER_B, "b@example.com"), Member(USER_GONE, None)],
        [_row(USER_A, TODAY, retain_success=4)],
        today=TODAY,
        range_name="today",
        span_days=1,
    )
    assert [member["email"] for member in view.body["members"]] == ["b@example.com"]
    assert view.body["team"]["activity"]["retain"]["success"] == 0
    assert USER_A in view.omitted_user_ids


def test_footprint_uses_the_latest_snapshot_in_the_range():
    rows = [
        _row(
            USER_A,
            date(2026, 10, 27),
            banks=1,
            documents=2,
            memory_units=3,
            updated_at=datetime(2026, 10, 27, 1, 0, tzinfo=timezone.utc),
        ),
        _row(
            USER_A,
            TODAY,
            banks=4,
            documents=5,
            memory_units=6,
            updated_at=datetime(2026, 10, 28, 2, 0, tzinfo=timezone.utc),
        ),
    ]
    body = build_usage_view(
        [Member(USER_A, "a@example.com")],
        rows,
        today=TODAY,
        range_name="7d",
        span_days=7,
    ).body
    assert body["team"]["footprint"] == {"banks": 4, "documents": 5, "memory_units": 6}
    assert body["snapshot_at"] == "2026-10-28T02:00:00+00:00"


def test_cancelled_retain_does_not_change_counters():
    assert operation_delta("retain", success=False, cancelled=True) is None
    assert operation_delta("retain", success=True, cancelled=False) == {"retain_success": 1}
    assert operation_delta("retain", success=False, cancelled=False) == {"retain_failure": 1}
    assert operation_delta("consolidation", success=True, cancelled=False) is None


def test_user_id_round_trip_from_tenant_schema():
    assert user_id_from_schema(f"user_{USER_A.replace('-', '_')}") == USER_A
    assert user_id_from_schema("public") is None
    assert user_id_from_schema("user_not_a_uuid") is None


def test_parse_range_defaults_and_rejects_unknown():
    assert parse_range(None) == ("7d", 7)
    assert parse_range("today") == ("today", 1)
    assert parse_range("30d") == ("30d", 30)
    with pytest.raises(ValueError):
        parse_range("year")


def _walk_keys(value):
    if isinstance(value, dict):
        yield from value
        for child in value.values():
            yield from _walk_keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_keys(child)


@pytest.fixture
def usage_client():
    app = FastAPI()

    @app.get("/v1/default/usage/team")
    async def usage_team(range: str | None = None):
        return await team_usage_payload(
            range_value=range,
            extension_active=app.state.extension_active,
            today=TODAY,
            load=app.state.load,
        )

    app.state.extension_active = True
    app.state.load = _two_members
    return TestClient(app)


async def _two_members():
    return (
        [Member(USER_A, "a@example.com"), Member(USER_B, "b@example.com")],
        [
            _row(USER_A, TODAY, retain_success=2, input_tokens=5),
            _row(USER_B, TODAY, recall_success=1, output_tokens=7),
        ],
    )


def test_public_read_splits_two_members_and_hides_private_fields(usage_client):
    response = usage_client.get("/v1/default/usage/team", params={"range": "7d"})
    assert response.status_code == 200
    body = response.json()
    by_email = {member["email"]: member for member in body["members"]}
    assert by_email["a@example.com"]["activity"]["retain"]["success"] == 2
    assert by_email["b@example.com"]["activity"]["recall"]["success"] == 1
    assert by_email["a@example.com"]["activity"]["recall"]["success"] == 0
    forbidden = {"user_id", "bank_id", "document_id", "prompt", "memory", "content"}
    assert forbidden.isdisjoint(_walk_keys(body))


def test_unknown_range_is_400(usage_client):
    response = usage_client.get("/v1/default/usage/team", params={"range": "year"})
    assert response.status_code == 400


def test_inactive_extension_is_404(usage_client):
    usage_client.app.state.extension_active = False
    response = usage_client.get("/v1/default/usage/team")
    assert response.status_code == 404


def test_read_error_is_503_without_a_member_list(usage_client):
    async def broken():
        raise UsageReadError("db down")

    usage_client.app.state.load = broken
    response = usage_client.get("/v1/default/usage/team")
    assert response.status_code == 503
    assert "members" not in response.json()


class SupabaseTenantExtension:
    """Stands in for the real extension, which the route recognises by class name."""


class _FakeUsageStore:
    async def load_members_and_rows(self):
        return await _two_members()


@pytest.fixture
def registered_app_client(monkeypatch):
    """The real app's route, so the handler's own wiring is exercised, not a stand-in."""
    monkeypatch.delenv("HINDSIGHT_API_HTTP_EXTENSION", raising=False)

    def build(extension: object) -> TestClient:
        memory = MagicMock()
        memory.tenant_extension = extension
        return TestClient(create_app(memory, initialize_memory=False))

    return build


def test_registered_route_serves_members_when_the_extension_is_active(registered_app_client, monkeypatch):
    monkeypatch.setattr("hindsight_api.usage.store._STORE", _FakeUsageStore())
    response = registered_app_client(SupabaseTenantExtension()).get("/v1/default/usage/team")
    assert response.status_code == 200
    assert [member["email"] for member in response.json()["members"]] == ["a@example.com", "b@example.com"]


def test_registered_route_is_404_without_the_supabase_extension(registered_app_client):
    response = registered_app_client(object()).get("/v1/default/usage/team")
    assert response.status_code == 404
