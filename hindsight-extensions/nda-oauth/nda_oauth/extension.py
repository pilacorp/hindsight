"""MCP OAuth as a Hindsight HTTP extension (#10, cohesion variant).

Instead of a separate gateway service, Hindsight itself speaks MCP OAuth 2.1
(DCR + PKCE) through this HTTP extension, delegating login to Supabase. The
token handed to the agent IS the Supabase access token (with the Supabase
refresh token as the OAuth refresh token), so the agent calls Hindsight's MCP
endpoint **directly** and the unchanged `supabase-tenant` tenant extension
verifies it. No proxy, no server-side session store.

Endpoints:
- root:  /.well-known/oauth-authorization-server, /.well-known/oauth-protected-resource
- /ext:  /oauth/register (DCR), /oauth/authorize (login → code), /oauth/token (code+PKCE / refresh)

Config (env HINDSIGHT_API_HTTP_*):
- HINDSIGHT_API_HTTP_SUPABASE_URL      -> config["supabase_url"]  (required; e.g. http://host.docker.internal:8010)
- HINDSIGHT_API_HTTP_SUPABASE_ANON_KEY -> config["supabase_anon_key"] (required; apikey for GoTrue)

ponytail: auth codes + registered clients are in-memory (single-process dev/pilot);
move to a shared store to scale or survive restarts.
"""
import base64
import hashlib
import secrets
import time
import urllib.parse

import aiohttp
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from hindsight_api.extensions import HttpExtension


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


_LOGIN_FORM = """<!doctype html><html><head><meta charset=utf-8>
<title>Sign in — Hindsight</title><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{{font-family:system-ui;background:#0b0b0c;color:#e7e7e7;display:grid;place-items:center;height:100vh;margin:0}}
form{{background:#17171a;padding:28px;border-radius:12px;width:300px;display:grid;gap:12px}}
input{{padding:10px;border-radius:8px;border:1px solid #333;background:#0b0b0c;color:#fff}}
button{{padding:10px;border-radius:8px;border:0;background:#4f46e5;color:#fff;font-weight:600;cursor:pointer}}
.e{{color:#f87171;font-size:13px;min-height:16px}}</style></head>
<body><form method=post>
<strong>Hindsight memory — sign in</strong>
<input name=email type=email placeholder=email autocomplete=email required autofocus>
<input name=password type=password placeholder=password autocomplete=current-password required>
<div class=e>{error}</div>
<input type=hidden name=client_id value="{client_id}">
<input type=hidden name=redirect_uri value="{redirect_uri}">
<input type=hidden name=state value="{state}">
<input type=hidden name=code_challenge value="{code_challenge}">
<button type=submit>Sign in</button>
</form></body></html>"""


class NdaOAuthExtension(HttpExtension):
    def __init__(self, config: dict[str, str]) -> None:
        super().__init__(config)
        self.supabase_url = (config.get("supabase_url") or "").rstrip("/")
        self.supabase_anon_key = config.get("supabase_anon_key") or ""
        if not self.supabase_url or not self.supabase_anon_key:
            raise ValueError(
                "HINDSIGHT_API_HTTP_SUPABASE_URL and HINDSIGHT_API_HTTP_SUPABASE_ANON_KEY are required"
            )
        self._clients: dict[str, list[str]] = {}       # client_id -> redirect_uris
        self._codes: dict[str, dict] = {}              # code -> {client_id, redirect_uri, challenge, supa, exp}

    # --- Supabase calls (aiohttp per Hindsight's outbound-HTTP rule) --------
    async def _supabase_token(self, grant: str, payload: dict) -> tuple[int, dict]:
        url = f"{self.supabase_url}/auth/v1/token?grant_type={grant}"
        headers = {"apikey": self.supabase_anon_key, "Content-Type": "application/json"}
        async with aiohttp.ClientSession() as s:
            async with s.post(url, json=payload, headers=headers) as r:
                try:
                    return r.status, await r.json(content_type=None)
                except Exception:
                    return r.status, {}

    # --- root router: discovery --------------------------------------------
    def get_root_router(self, memory) -> APIRouter:
        router = APIRouter()

        def _issuer(request: Request) -> str:
            return str(request.base_url).rstrip("/")

        @router.get("/.well-known/oauth-authorization-server")
        async def as_metadata(request: Request):
            iss = _issuer(request)
            return {
                "issuer": iss,
                "authorization_endpoint": f"{iss}/ext/oauth/authorize",
                "token_endpoint": f"{iss}/ext/oauth/token",
                "registration_endpoint": f"{iss}/ext/oauth/register",
                "response_types_supported": ["code"],
                "grant_types_supported": ["authorization_code", "refresh_token"],
                "code_challenge_methods_supported": ["S256"],
                "token_endpoint_auth_methods_supported": ["none"],
            }

        @router.get("/.well-known/oauth-protected-resource")
        async def protected_resource(request: Request):
            iss = _issuer(request)
            return {"resource": iss, "authorization_servers": [iss]}

        return router

    # --- /ext router: DCR + authorize + token ------------------------------
    def get_router(self, memory) -> APIRouter:
        router = APIRouter(tags=["OAuth"])

        @router.post("/oauth/register", status_code=201)
        async def register(request: Request):
            body = await request.json()
            redirect_uris = body.get("redirect_uris") or []
            if not isinstance(redirect_uris, list) or not redirect_uris:
                return JSONResponse({"error": "invalid_redirect_uri"}, status_code=400)
            client_id = "c_" + secrets.token_urlsafe(16)
            self._clients[client_id] = redirect_uris
            return {
                "client_id": client_id, "redirect_uris": redirect_uris,
                "token_endpoint_auth_method": "none",
                "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
            }

        def _valid(client_id: str, redirect_uri: str) -> bool:
            return redirect_uri in self._clients.get(client_id, [])

        @router.get("/oauth/authorize", response_class=HTMLResponse)
        async def authorize_form(request: Request):
            q = request.query_params
            if not _valid(q.get("client_id", ""), q.get("redirect_uri", "")):
                return HTMLResponse("invalid client_id or redirect_uri", status_code=400)
            if q.get("code_challenge_method", "S256") != "S256":
                return HTMLResponse("code_challenge_method must be S256", status_code=400)
            return _LOGIN_FORM.format(error="", client_id=q.get("client_id", ""),
                                      redirect_uri=q.get("redirect_uri", ""), state=q.get("state", ""),
                                      code_challenge=q.get("code_challenge", ""))

        @router.post("/oauth/authorize")
        async def authorize_submit(request: Request):
            form = {k: v[0] for k, v in urllib.parse.parse_qs((await request.body()).decode()).items()}
            client_id, redirect_uri = form.get("client_id", ""), form.get("redirect_uri", "")
            if not _valid(client_id, redirect_uri):
                return JSONResponse({"error": "invalid client_id or redirect_uri"}, status_code=400)
            status, supa = await self._supabase_token(
                "password", {"email": form.get("email", ""), "password": form.get("password", "")})
            if status != 200 or "access_token" not in supa:
                return HTMLResponse(
                    _LOGIN_FORM.format(error="Invalid email or password.", client_id=client_id,
                                       redirect_uri=redirect_uri, state=form.get("state", ""),
                                       code_challenge=form.get("code_challenge", "")),
                    status_code=401)
            code = secrets.token_urlsafe(24)
            self._codes[code] = {
                "client_id": client_id, "redirect_uri": redirect_uri,
                "challenge": form.get("code_challenge", ""),
                "supa_access": supa["access_token"], "supa_refresh": supa.get("refresh_token", ""),
                "exp": int(time.time()) + 120,
            }
            sep = "&" if "?" in redirect_uri else "?"
            url = f"{redirect_uri}{sep}code={code}"
            if form.get("state"):
                url += "&state=" + urllib.parse.quote(form["state"])
            return RedirectResponse(url, status_code=302)

        @router.post("/oauth/token")
        async def token(request: Request):
            form = {k: v[0] for k, v in urllib.parse.parse_qs((await request.body()).decode()).items()}
            grant = form.get("grant_type", "")
            if grant == "authorization_code":
                entry = self._codes.pop(form.get("code", ""), None)
                if not entry or entry["exp"] < int(time.time()):
                    return JSONResponse({"error": "invalid_grant"}, status_code=400)
                if entry["client_id"] != form.get("client_id") or entry["redirect_uri"] != form.get("redirect_uri"):
                    return JSONResponse({"error": "invalid_grant"}, status_code=400)
                if _b64url(hashlib.sha256(form.get("code_verifier", "").encode()).digest()) != entry["challenge"]:
                    return JSONResponse({"error": "invalid_grant", "error_description": "PKCE"}, status_code=400)
                # Pass-through: the Supabase access token IS the OAuth access token,
                # so the agent calls Hindsight MCP directly and supabase-tenant verifies it.
                return {"access_token": entry["supa_access"], "token_type": "bearer",
                        "refresh_token": entry["supa_refresh"]}
            if grant == "refresh_token":
                status, supa = await self._supabase_token(
                    "refresh_token", {"refresh_token": form.get("refresh_token", "")})
                if status != 200 or "access_token" not in supa:
                    return JSONResponse({"error": "invalid_grant"}, status_code=400)
                return {"access_token": supa["access_token"], "token_type": "bearer",
                        "refresh_token": supa.get("refresh_token", "")}
            return JSONResponse({"error": "unsupported_grant_type"}, status_code=400)

        return router
