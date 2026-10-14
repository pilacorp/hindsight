"""Key format, generation, and peppered hashing."""

import re

import pytest

from nda_hindsight_multiuser import keys


def test_issue_returns_prefix_secret_and_full_key():
    issued = keys.issue()
    assert issued.full.startswith("ndak_")
    assert issued.full == f"ndak_{issued.prefix}_{issued.secret}"
    # Prefix is non-secret and used for the DB lookup; fixed length, url-safe.
    assert re.fullmatch(r"[A-Za-z0-9_-]{8}", issued.prefix)
    # Secret carries the entropy.
    assert len(issued.secret) >= 32


def test_two_issues_differ():
    a, b = keys.issue(), keys.issue()
    assert a.prefix != b.prefix
    assert a.secret != b.secret
    assert a.full != b.full


def test_parse_roundtrip():
    issued = keys.issue()
    parsed = keys.parse(issued.full)
    assert parsed is not None
    assert parsed.prefix == issued.prefix
    assert parsed.secret == issued.secret


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "nope",
        "ndak_only",
        "ndak__emptyprefix",  # empty prefix
        "wrong_prefix_secret",
        "ndak_shortpfx_secret",  # prefix not 8 chars
        "ndak_abcd1234_",  # empty secret
        "ndak_abcd1234_sec_ret",  # extra separator in secret
    ],
)
def test_parse_rejects_malformed(bad):
    assert keys.parse(bad) is None


def test_hash_is_deterministic_and_depends_on_pepper():
    issued = keys.issue()
    h1 = keys.hash_secret(issued.secret, pepper="p1")
    h2 = keys.hash_secret(issued.secret, pepper="p1")
    h3 = keys.hash_secret(issued.secret, pepper="p2")
    assert h1 == h2
    assert h1 != h3
    # The stored hash is not the secret.
    assert issued.secret not in h1


def test_verify_accepts_correct_and_rejects_wrong():
    issued = keys.issue()
    stored = keys.hash_secret(issued.secret, pepper="pep")
    assert keys.verify_secret(issued.secret, pepper="pep", stored_hash=stored) is True
    assert keys.verify_secret("not-the-secret", pepper="pep", stored_hash=stored) is False
    # Wrong pepper never verifies, even with the right secret.
    assert keys.verify_secret(issued.secret, pepper="other", stored_hash=stored) is False


def test_verify_handles_garbage_without_raising():
    assert keys.verify_secret("x", pepper="pep", stored_hash="not-hex") is False
    assert keys.verify_secret("x", pepper="pep", stored_hash="") is False
