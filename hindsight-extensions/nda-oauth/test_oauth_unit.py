#!/usr/bin/env python3
"""Unit checks for the security-critical pure logic in nda_oauth.extension:
redirect-URI validation and login-form HTML escaping (the XSS and open-redirect
guards). Stdlib only; stubs the server deps so it runs without the Hindsight
stack, unlike the e2e test_oauth_mcp.py which needs a live API.
"""
import sys
import types

# The module top-imports fastapi/aiohttp/hindsight_api for the HTTP wiring; the
# pure helpers tested here touch none of them, so stub them to import anywhere.
for _name in ("aiohttp", "fastapi", "fastapi.responses", "hindsight_api",
              "hindsight_api.extensions"):
    sys.modules.setdefault(_name, types.ModuleType(_name))
sys.modules["fastapi"].APIRouter = object
sys.modules["fastapi"].Request = object
sys.modules["fastapi.responses"].HTMLResponse = object
sys.modules["fastapi.responses"].JSONResponse = object
sys.modules["fastapi.responses"].RedirectResponse = object
sys.modules["hindsight_api.extensions"].HttpExtension = object

from nda_oauth.extension import _ok_redirect, _render_login  # noqa: E402


def test_redirect_allows_https_and_loopback():
    assert _ok_redirect("https://app.example.com/cb")
    assert _ok_redirect("http://localhost:0/callback")
    assert _ok_redirect("http://127.0.0.1:8080/cb")


def test_redirect_rejects_insecure_external_and_junk():
    assert not _ok_redirect("http://evil.com/cb")       # plain http, external host
    assert not _ok_redirect("http://169.254.169.254/")  # not a loopback host
    assert not _ok_redirect("ftp://localhost/cb")
    assert not _ok_redirect("javascript:alert(1)")
    assert not _ok_redirect("")


def test_login_form_escapes_injected_values():
    page = _render_login(error="", client_id='"><script>alert(1)</script>',
                         redirect_uri="x", state='"/>', code_challenge="z")
    assert "<script>alert(1)" not in page       # not rendered as live markup
    assert "&lt;script&gt;" in page             # escaped instead
    assert '"/>' not in page.split("value=")[-1] or "&quot;" in page


if __name__ == "__main__":
    test_redirect_allows_https_and_loopback()
    test_redirect_rejects_insecure_external_and_junk()
    test_login_form_escapes_injected_values()
    print("ok")
