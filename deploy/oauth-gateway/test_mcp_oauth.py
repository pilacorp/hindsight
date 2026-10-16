#!/usr/bin/env python3
"""End-to-end test: a real MCP session obtained through the OAuth gateway.

Drives exactly what a coding agent's MCP client does, but headless — the gateway
accepts email/password on /authorize, so no browser is needed:

  1. OAuth 2.1: DCR -> /authorize (Supabase login) -> PKCE token exchange
  2. MCP over Streamable HTTP through the gateway: initialize -> initialized ->
     tools/list -> tools/call (list_banks)
  3. refresh_token -> the new session still drives MCP

Stdlib only. Config via env (defaults = the local dev stack):
  GATEWAY=http://localhost:8020  EMAIL=dev@local.test  PASSWORD=devpass123  BANK=mcptest
"""
import base64
import hashlib
import json
import os
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request

GATEWAY = os.environ.get("GATEWAY", "http://localhost:8020").rstrip("/")
EMAIL = os.environ.get("EMAIL", "dev@local.test")
PASSWORD = os.environ.get("PASSWORD", "devpass123")
BANK = os.environ.get("BANK", "mcptest")
REDIRECT = "http://localhost:0/callback"

PASS, FAIL = "\033[32mPASS\033[0m", "\033[31mFAIL\033[0m"
_fails = 0


def check(label, ok, extra=""):
    global _fails
    print(f"  [{PASS if ok else FAIL}] {label}{(' — ' + extra) if extra else ''}")
    if not ok:
        _fails += 1


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # don't follow — surface the 302 so we can read the code


def _req(method, url, data=None, headers=None, allow_redirect=True):
    body = None
    if data is not None:
        body = data if isinstance(data, bytes) else urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    opener = urllib.request.build_opener() if allow_redirect else urllib.request.build_opener(_NoRedirect)
    try:
        r = opener.open(req, timeout=30)
        return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


def _mcp_parse(raw: bytes):
    """A Streamable-HTTP MCP response is JSON or SSE (data: lines)."""
    text = raw.decode().replace("\r\n", "\n")
    try:
        return json.loads(text)
    except ValueError:
        for event in text.split("\n\n"):
            payload = "\n".join(l[5:].strip() for l in event.splitlines() if l.startswith("data:"))
            if payload:
                v = json.loads(payload)
                if isinstance(v, dict) and "id" in v:
                    return v
    raise ValueError("unparseable MCP response: " + text[:200])


def oauth_flow():
    print("1. OAuth (DCR -> authorize -> PKCE token)")
    # DCR
    s, b, _ = _req("POST", f"{GATEWAY}/register",
                   json.dumps({"redirect_uris": [REDIRECT]}).encode(),
                   {"Content-Type": "application/json"})
    client_id = json.loads(b)["client_id"]
    check("dynamic client registration", s == 201 and client_id.startswith("c_"), client_id)
    # PKCE
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    # authorize (Supabase login) -> 302 with code
    s, b, h = _req("POST", f"{GATEWAY}/authorize",
                   {"email": EMAIL, "password": PASSWORD, "client_id": client_id,
                    "redirect_uri": REDIRECT, "code_challenge": challenge, "state": "st"},
                   {"Content-Type": "application/x-www-form-urlencoded"}, allow_redirect=False)
    loc = h.get("Location", "")
    code = urllib.parse.parse_qs(urllib.parse.urlparse(loc).query).get("code", [""])[0]
    check("authorize -> code (Supabase login)", s == 302 and bool(code), code[:10] + "…")
    # token exchange with PKCE verifier
    s, b, _ = _req("POST", f"{GATEWAY}/token",
                   {"grant_type": "authorization_code", "code": code, "code_verifier": verifier,
                    "redirect_uri": REDIRECT, "client_id": client_id},
                   {"Content-Type": "application/x-www-form-urlencoded"})
    tok = json.loads(b)
    check("PKCE token exchange", s == 200 and "access_token" in tok, "expires_in=%s" % tok.get("expires_in"))
    return tok["access_token"], tok["refresh_token"]


def mcp_session(token, label="MCP"):
    hdr = {"Authorization": f"Bearer {token}", "Content-Type": "application/json",
           "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26"}
    # initialize
    s, b, h = _req("POST", f"{GATEWAY}/mcp/{BANK}/",
                   json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                               "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                                          "clientInfo": {"name": "mcp-oauth-test", "version": "0"}}}).encode(), hdr)
    session = h.get("Mcp-Session-Id") or h.get("mcp-session-id")
    srv = _mcp_parse(b).get("result", {}).get("serverInfo", {}) if s == 200 else {}
    check(f"{label}: initialize", s == 200 and bool(session), f"server={srv.get('name','?')} session={str(session)[:8]}…")
    if not session:
        return
    hdr["Mcp-Session-Id"] = session
    # initialized notification (no id, expect 202/200 no body)
    _req("POST", f"{GATEWAY}/mcp/{BANK}/",
         json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}).encode(), hdr)
    # tools/list
    s, b, _ = _req("POST", f"{GATEWAY}/mcp/{BANK}/",
                   json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}).encode(), hdr)
    tools = {t["name"] for t in _mcp_parse(b).get("result", {}).get("tools", [])}
    # Per-bank MCP endpoint (/mcp/<bank>/) exposes the bank-scoped tool set.
    want = {"recall", "retain", "list_memories"}
    check(f"{label}: tools/list has {sorted(want)}", want <= tools, f"{len(tools)} tools")
    # tools/call list_memories — a real, cheap round-trip through gateway→API→tenant.
    s, b, _ = _req("POST", f"{GATEWAY}/mcp/{BANK}/",
                   json.dumps({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                               "params": {"name": "list_memories", "arguments": {}}}).encode(), hdr)
    res = _mcp_parse(b).get("result", {})
    check(f"{label}: tools/call list_memories", s == 200 and not res.get("isError", False), "ok")


def main():
    print(f"MCP-over-OAuth test → {GATEWAY} (user {EMAIL}, bank {BANK})\n")
    access, refresh = oauth_flow()
    print("2. MCP session with the gateway token")
    mcp_session(access, "MCP")
    print("3. refresh_token, then MCP again")
    s, b, _ = _req("POST", f"{GATEWAY}/token",
                   {"grant_type": "refresh_token", "refresh_token": refresh},
                   {"Content-Type": "application/x-www-form-urlencoded"})
    new = json.loads(b).get("access_token", "")
    check("refresh_token", s == 200 and bool(new))
    mcp_session(new, "MCP (post-refresh)")
    print("4. no-token is rejected")
    s, _, _ = _req("POST", f"{GATEWAY}/mcp/{BANK}/", b"{}", {"Content-Type": "application/json"})
    check("no-token -> 401", s == 401)
    print(f"\n{'ALL PASSED' if _fails == 0 else str(_fails) + ' FAILED'}")
    sys.exit(1 if _fails else 0)


if __name__ == "__main__":
    main()
