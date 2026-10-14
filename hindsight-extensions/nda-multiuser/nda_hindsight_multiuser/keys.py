"""API keys: format, generation, and peppered hashing.

A key is ``ndak_<prefix>_<secret>``:

- ``prefix`` is 8 url-safe characters. It is **not** secret; it is stored in
  the clear and indexed, so a lookup finds the one candidate row without
  scanning. It is also what a key is called in the UI and audit log.
- ``secret`` carries the entropy (32 random bytes, url-safe). Only its hash is
  stored. Verification recomputes the hash and compares in constant time.

The hash is ``HMAC-SHA256(key=pepper, msg=secret)``. The pepper is a
server-side secret (``HINDSIGHT_API_TENANT_KEY_PEPPER``) held outside the
database, so a database dump alone cannot verify or forge a key.

Pure stdlib, no database or server dependency — so it is unit-testable on its own.
"""

from __future__ import annotations

import hmac
import re
import secrets
from dataclasses import dataclass
from hashlib import sha256

_PREFIX_BYTES = 6  # 6 bytes -> 8 url-safe base64 chars, no padding
_SECRET_BYTES = 32
_KEY_RE = re.compile(r"^ndak_([A-Za-z0-9_-]{8})_([A-Za-z0-9_-]{43,})$")

__all__ = ["IssuedKey", "ParsedKey", "issue", "parse", "hash_secret", "verify_secret"]


@dataclass(frozen=True)
class IssuedKey:
    """A freshly minted key. ``full`` is shown to the caller exactly once."""

    prefix: str
    secret: str
    full: str


@dataclass(frozen=True)
class ParsedKey:
    prefix: str
    secret: str


def issue() -> IssuedKey:
    """Mint a new key. The full value is returned once and never stored."""
    prefix = secrets.token_urlsafe(_PREFIX_BYTES)
    secret = secrets.token_urlsafe(_SECRET_BYTES)
    return IssuedKey(prefix=prefix, secret=secret, full=f"ndak_{prefix}_{secret}")


def parse(full: str) -> ParsedKey | None:
    """Split a presented key into prefix and secret, or ``None`` if malformed."""
    if not isinstance(full, str):
        return None
    m = _KEY_RE.match(full)
    if m is None:
        return None
    return ParsedKey(prefix=m.group(1), secret=m.group(2))


def hash_secret(secret: str, *, pepper: str) -> str:
    """HMAC-SHA256 of the secret under the server-side pepper, as hex."""
    return hmac.new(pepper.encode("utf-8"), secret.encode("utf-8"), sha256).hexdigest()


def verify_secret(secret: str, *, pepper: str, stored_hash: str) -> bool:
    """Constant-time check that ``secret`` matches ``stored_hash`` under ``pepper``."""
    computed = hash_secret(secret, pepper=pepper)
    # compare_digest is constant-time for equal-length strings and returns
    # False (without raising) for anything else, so garbage stored_hash is safe.
    return hmac.compare_digest(computed, stored_hash)
