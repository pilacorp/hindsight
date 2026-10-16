"""MCP OAuth gateway for self-hosted Hindsight (#10).

Gives local MCP agents an OAuth 2.1 + DCR + PKCE connection that refreshes
itself, while Hindsight keeps using the unchanged `supabase-tenant` extension:
the gateway logs the user into Supabase, holds their Supabase tokens, and
proxies MCP traffic to Hindsight with a *Supabase* access JWT (refreshed before
expiry). The agent only ever holds an opaque gateway token.

ponytail: in-memory stores (clients/codes/sessions) — fine for a single-replica
dev/pilot gateway; move to Redis/DB if it needs to scale or survive restarts.
"""
import base64
import hashlib
import os
import secrets
import time

import httpx
from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response, StreamingResponse

SUPABASE_URL = os.environ["GATEWAY_SUPABASE_URL"].rstrip("/")
SUPABASE_ANON_KEY = os.environ["GATEWAY_SUPABASE_ANON_KEY"]
HINDSIGHT_URL = os.environ["GATEWAY_HINDSIGHT_URL"].rstrip("/")
PUBLIC_URL = os.environ["GATEWAY_PUBLIC_URL"].rstrip("/")
ACCESS_TTL = int(os.environ.get("GATEWAY_ACCESS_TTL", "3600"))
REFRESH_SKEW = 120  # refresh the Supabase token this many seconds before it expires

app = FastAPI(title="Hindsight MCP OAuth gateway")

# --- in-memory stores -------------------------------------------------------
_clients: dict[str, dict] = {}   # client_id -> {redirect_uris: [...]}
_codes: dict[str, dict] = {}     # code -> {client_id, redirect_uri, challenge, supa, exp}
_sessions: dict[str, dict] = {}  # gateway_access -> {supa_access, supa_refresh, supa_exp}
_refresh: dict[str, str] = {}    # gateway_refresh -> gateway_access


def _now() -> int:
    return int(time.time())


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


# --- discovery --------------------------------------------------------------
@app.get("/.well-known/oauth-authorization-server")
def as_metadata():
    return {
        "issuer": PUBLIC_URL,
        "authorization_endpoint": f"{PUBLIC_URL}/authorize",
        "token_endpoint": f"{PUBLIC_URL}/token",
        "registration_endpoint": f"{PUBLIC_URL}/register",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
    }


@app.get("/.well-known/oauth-protected-resource")
def protected_resource():
    # Points MCP clients at this gateway as both the resource and its AS.
    return {"resource": f"{PUBLIC_URL}/mcp", "authorization_servers": [PUBLIC_URL]}


# --- dynamic client registration (RFC 7591) ---------------------------------
@app.post("/register")
async def register(request: Request):
    body = await request.json()
    redirect_uris = body.get("redirect_uris") or []
    if not isinstance(redirect_uris, list) or not redirect_uris:
        raise HTTPException(400, "redirect_uris required")
    client_id = "c_" + secrets.token_urlsafe(16)
    _clients[client_id] = {"redirect_uris": redirect_uris}
    # Public client (PKCE, no secret), per MCP guidance.
    return JSONResponse(
        {
            "client_id": client_id,
            "redirect_uris": redirect_uris,
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
        },
        status_code=201,
    )


# --- authorization: login form -> Supabase password grant -> code -----------
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


def _check_authorize(client_id: str, redirect_uri: str, method: str) -> None:
    client = _clients.get(client_id)
    if not client or redirect_uri not in client["redirect_uris"]:
        raise HTTPException(400, "invalid client_id or redirect_uri")
    if method != "S256":
        raise HTTPException(400, "code_challenge_method must be S256")


@app.get("/authorize", response_class=HTMLResponse)
def authorize_form(
    client_id: str, redirect_uri: str, code_challenge: str,
    code_challenge_method: str = "S256", state: str = "", response_type: str = "code",
):
    _check_authorize(client_id, redirect_uri, code_challenge_method)
    return _LOGIN_FORM.format(
        error="", client_id=client_id, redirect_uri=redirect_uri, state=state, code_challenge=code_challenge
    )


@app.post("/authorize")
async def authorize_submit(
    email: str = Form(...), password: str = Form(...),
    client_id: str = Form(...), redirect_uri: str = Form(...),
    code_challenge: str = Form(...), state: str = Form(""),
):
    _check_authorize(client_id, redirect_uri, "S256")
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"{SUPABASE_URL}/auth/v1/token",
            params={"grant_type": "password"},
            headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
            json={"email": email, "password": password},
        )
    if r.status_code != 200:
        return HTMLResponse(
            _LOGIN_FORM.format(
                error="Invalid email or password.", client_id=client_id,
                redirect_uri=redirect_uri, state=state, code_challenge=code_challenge,
            ),
            status_code=401,
        )
    supa = r.json()
    code = secrets.token_urlsafe(24)
    _codes[code] = {
        "client_id": client_id, "redirect_uri": redirect_uri, "challenge": code_challenge,
        "supa_access": supa["access_token"], "supa_refresh": supa["refresh_token"],
        "supa_exp": _now() + int(supa.get("expires_in", 3600)), "exp": _now() + 120,
    }
    sep = "&" if "?" in redirect_uri else "?"
    url = f"{redirect_uri}{sep}code={code}"
    if state:
        url += f"&state={state}"
    return RedirectResponse(url, status_code=302)


# --- token: code exchange (PKCE) + refresh ----------------------------------
def _issue_session(supa_access: str, supa_refresh: str, supa_exp: int) -> dict:
    access = "g_" + secrets.token_urlsafe(24)
    refresh = "gr_" + secrets.token_urlsafe(24)
    _sessions[access] = {"supa_access": supa_access, "supa_refresh": supa_refresh, "supa_exp": supa_exp}
    _refresh[refresh] = access
    return {"access_token": access, "token_type": "bearer", "expires_in": ACCESS_TTL, "refresh_token": refresh}


@app.post("/token")
async def token(
    grant_type: str = Form(...), code: str = Form(None), code_verifier: str = Form(None),
    redirect_uri: str = Form(None), client_id: str = Form(None), refresh_token: str = Form(None),
):
    if grant_type == "authorization_code":
        entry = _codes.pop(code or "", None)
        if not entry or entry["exp"] < _now():
            raise HTTPException(400, "invalid or expired code")
        if entry["client_id"] != client_id or entry["redirect_uri"] != redirect_uri:
            raise HTTPException(400, "client/redirect mismatch")
        # PKCE S256: base64url(sha256(verifier)) must equal the stored challenge.
        if _b64url(hashlib.sha256((code_verifier or "").encode()).digest()) != entry["challenge"]:
            raise HTTPException(400, "PKCE verification failed")
        return _issue_session(entry["supa_access"], entry["supa_refresh"], entry["supa_exp"])

    if grant_type == "refresh_token":
        access = _refresh.get(refresh_token or "")
        sess = _sessions.get(access or "")
        if not sess:
            raise HTTPException(400, "invalid refresh_token")
        await _refresh_supabase(sess)
        return {"access_token": access, "token_type": "bearer", "expires_in": ACCESS_TTL, "refresh_token": refresh_token}

    raise HTTPException(400, "unsupported grant_type")


async def _refresh_supabase(sess: dict) -> None:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"{SUPABASE_URL}/auth/v1/token",
            params={"grant_type": "refresh_token"},
            headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
            json={"refresh_token": sess["supa_refresh"]},
        )
    if r.status_code != 200:
        raise HTTPException(401, "Supabase refresh failed")
    supa = r.json()
    sess["supa_access"] = supa["access_token"]
    sess["supa_refresh"] = supa["refresh_token"]
    sess["supa_exp"] = _now() + int(supa.get("expires_in", 3600))


# --- MCP proxy: inject a fresh Supabase JWT ---------------------------------
@app.api_route("/mcp/{path:path}", methods=["GET", "POST", "DELETE"])
async def mcp_proxy(path: str, request: Request):
    auth = request.headers.get("authorization", "")
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    sess = _sessions.get(token)
    if not sess:
        return JSONResponse({"error": "invalid_token"}, status_code=401,
                            headers={"WWW-Authenticate": f'Bearer resource_metadata="{PUBLIC_URL}/.well-known/oauth-protected-resource"'})
    if sess["supa_exp"] - REFRESH_SKEW < _now():
        await _refresh_supabase(sess)

    body = await request.body()
    # Forward everything but swap Authorization for the Supabase JWT.
    fwd = {k: v for k, v in request.headers.items() if k.lower() not in ("authorization", "host", "content-length")}
    fwd["Authorization"] = f"Bearer {sess['supa_access']}"
    target = f"{HINDSIGHT_URL}/mcp/{path}"
    client = httpx.AsyncClient(timeout=None)
    req = client.build_request(request.method, target, params=request.query_params, headers=fwd, content=body)
    upstream = await client.send(req, stream=True)
    hdrs = {k: v for k, v in upstream.headers.items() if k.lower() not in ("content-length", "transfer-encoding", "connection")}

    async def body_iter():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(body_iter(), status_code=upstream.status_code, headers=hdrs)


@app.get("/health")
def health():
    return Response("ok", media_type="text/plain")
