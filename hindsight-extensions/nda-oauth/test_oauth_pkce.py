"""PKCE authorization checks without a running Hindsight or Supabase instance."""

import base64
import hashlib
from html.parser import HTMLParser
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from nda_oauth.extension import NdaOAuthExtension

REDIRECT = "http://127.0.0.1:8080/callback"
VERIFIER = "a" * 64
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()


class HiddenInputs(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.values: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "input" and attributes.get("type") == "hidden":
            name = attributes.get("name")
            value = attributes.get("value")
            if name is not None and value is not None:
                self.values[name] = value


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    extension = NdaOAuthExtension({"supabase_url": "https://auth.example.test", "supabase_anon_key": "test-anon"})
    monkeypatch.setattr(
        extension,
        "_supabase_token",
        AsyncMock(return_value=(200, {
            "access_token": "test-access", "refresh_token": "test-refresh", "expires_in": 3600,
        })),
    )
    app = FastAPI()
    app.include_router(extension.get_router(None), prefix="/ext")
    return TestClient(app)


@pytest.fixture
def authorization(client: TestClient) -> dict[str, str]:
    response = client.post("/ext/oauth/register", json={"redirect_uris": [REDIRECT]})
    assert response.status_code == 201
    return {"client_id": response.json()["client_id"], "redirect_uri": REDIRECT, "code_challenge": CHALLENGE}


@pytest.mark.parametrize("method", [None, "", "plain", "S512"])
@pytest.mark.parametrize("verb", ["GET", "POST"])
def test_authorize_requires_explicit_s256(
    client: TestClient, authorization: dict[str, str], verb: str, method: str | None
) -> None:
    if method is not None:
        authorization["code_challenge_method"] = method
    if verb == "GET":
        response = client.get("/ext/oauth/authorize", params=authorization)
    else:
        response = client.post("/ext/oauth/authorize", data=authorization, follow_redirects=False)
    assert response.status_code == 400


@pytest.mark.parametrize("exchange_delay", [0, 30])
def test_login_form_preserves_s256_for_code_exchange(
    client: TestClient, authorization: dict[str, str], monkeypatch: pytest.MonkeyPatch, exchange_delay: int
) -> None:
    monkeypatch.setattr("nda_oauth.extension.time.time", lambda: 1000)
    response = client.get("/ext/oauth/authorize", params={**authorization, "code_challenge_method": "S256"})
    assert response.status_code == 200
    form = HiddenInputs()
    form.feed(response.text)
    assert form.values["code_challenge_method"] == "S256"

    response = client.post(
        "/ext/oauth/authorize",
        data={**form.values, "email": "user@example.test", "password": "test-password"},
        follow_redirects=False,
    )
    assert response.status_code == 302
    code = parse_qs(urlparse(response.headers["location"]).query)["code"][0]
    monkeypatch.setattr("nda_oauth.extension.time.time", lambda: 1000 + exchange_delay)
    response = client.post(
        "/ext/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "client_id": authorization["client_id"],
            "redirect_uri": REDIRECT,
            "code_verifier": VERIFIER,
        },
    )
    assert response.status_code == 200
    assert response.json() == {
        "access_token": "test-access",
        "token_type": "bearer",
        "refresh_token": "test-refresh",
        "expires_in": 3600 - exchange_delay,
    }


def test_refresh_returns_expiry_and_rotated_tokens(client: TestClient) -> None:
    response = client.post(
        "/ext/oauth/token", data={"grant_type": "refresh_token", "refresh_token": "previous-refresh"}
    )
    assert response.status_code == 200
    assert response.json() == {
        "access_token": "test-access",
        "token_type": "bearer",
        "refresh_token": "test-refresh",
        "expires_in": 3600,
    }
