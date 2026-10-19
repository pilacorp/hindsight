#!/usr/bin/env python3
"""End-to-end test: MCP OAuth served by Hindsight itself (nda-oauth extension).

No gateway — the OAuth endpoints live on the API (/ext/oauth/*, /.well-known/*)
and the token handed back is the Supabase JWT, so the agent calls the API's MCP
endpoint directly and supabase-tenant verifies it. Drives the whole agent path
headless (the login form accepts email/password, so no browser needed).

Stdlib only. Config via env (defaults = the local dev stack):
  API=http://localhost:8891  EMAIL=dev@local.test  PASSWORD=devpass123
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

API = os.environ.get("API", "http://localhost:8891").rstrip("/")
EMAIL = os.environ.get("EMAIL", "dev@local.test")
PASSWORD = os.environ.get("PASSWORD", "devpass123")
REDIRECT = "http://localhost:0/callback"
PASS, FAIL = "\033[32mPASS\033[0m", "\033[31mFAIL\033[0m"
_fails = 0


def check(label, ok, extra=""):
    global _fails
    print(f"  [{PASS if ok else FAIL}] {label}{(' — ' + extra) if extra else ''}")
    _fails += 0 if ok else 1


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a):
        return None


def _req(method, url, data=None, headers=None, follow=True):
    body = data if isinstance(data, bytes) else (urllib.parse.urlencode(data).encode() if data else None)
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(_NoRedirect)
    try:
        r = opener.open(req, timeout=30)
        return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


def _mcp(b):
    t = b.decode().replace("\r\n", "\n")
    try:
        return json.loads(t)
    except ValueError:
        for ev in t.split("\n\n"):
            p = "\n".join(l[5:].strip() for l in ev.splitlines() if l.startswith("data:"))
            if p:
                return json.loads(p)
    return {}


def main():
    print(f"OAuth-in-Hindsight MCP test → {API} (user {EMAIL}, multi-bank /mcp/)\n")
    # discovery is served by the API itself
    s, b, _ = _req("GET", f"{API}/.well-known/oauth-authorization-server")
    meta = json.loads(b) if s == 200 else {}
    check("discovery on the API", s == 200 and "token_endpoint" in meta)

    print("1. OAuth (DCR -> authorize -> PKCE token), endpoints on /ext/oauth")
    s, b, _ = _req("POST", f"{API}/ext/oauth/register",
                   json.dumps({"redirect_uris": [REDIRECT]}).encode(), {"Content-Type": "application/json"})
    cid = json.loads(b)["client_id"]
    check("DCR", s == 201 and cid.startswith("c_"), cid)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    s, b, h = _req("POST", f"{API}/ext/oauth/authorize",
                   {"email": EMAIL, "password": PASSWORD, "client_id": cid, "redirect_uri": REDIRECT,
                    "code_challenge": challenge, "code_challenge_method": "S256", "state": "st"},
                   {"Content-Type": "application/x-www-form-urlencoded"}, follow=False)
    code = urllib.parse.parse_qs(urllib.parse.urlparse(h.get("Location", "")).query).get("code", [""])[0]
    check("authorize -> code (Supabase login)", s == 302 and bool(code))
    s, b, _ = _req("POST", f"{API}/ext/oauth/token",
                   {"grant_type": "authorization_code", "code": code, "code_verifier": verifier,
                    "redirect_uri": REDIRECT, "client_id": cid}, {"Content-Type": "application/x-www-form-urlencoded"})
    tok = json.loads(b)
    access, refresh = tok.get("access_token", ""), tok.get("refresh_token", "")
    check("token = Supabase JWT (pass-through)", s == 200 and access.count(".") == 2 and bool(refresh))

    print("2. MCP directly on the API with that token")
    hdr = {"Authorization": f"Bearer {access}", "Content-Type": "application/json",
           "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26"}
    s, b, h = _req("POST", f"{API}/mcp/",
                   json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                               "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                                          "clientInfo": {"name": "oauth-mcp-test", "version": "0"}}}).encode(), hdr)
    sid = h.get("Mcp-Session-Id")
    check("MCP initialize", s == 200 and bool(sid))
    hdr["Mcp-Session-Id"] = sid
    _req("POST", f"{API}/mcp/",
         json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}).encode(), hdr)
    s, b, _ = _req("POST", f"{API}/mcp/",
                   json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}).encode(), hdr)
    tools = {t["name"] for t in _mcp(b).get("result", {}).get("tools", [])}
    check("tools/list has recall/retain/list_banks", {"recall", "retain", "list_banks"} <= tools, f"{len(tools)} tools")

    print("3. refresh, then no-token rejected")
    s, b, _ = _req("POST", f"{API}/ext/oauth/token",
                   {"grant_type": "refresh_token", "refresh_token": refresh},
                   {"Content-Type": "application/x-www-form-urlencoded"})
    check("refresh_token -> new JWT", s == 200 and "access_token" in json.loads(b))
    s, _, _ = _req("POST", f"{API}/mcp/", b"{}", {"Content-Type": "application/json"})
    check("no-token MCP -> 401", s == 401)

    print(f"\n{'ALL PASSED' if _fails == 0 else str(_fails) + ' FAILED'}")
    sys.exit(1 if _fails else 0)


if __name__ == "__main__":
    main()
