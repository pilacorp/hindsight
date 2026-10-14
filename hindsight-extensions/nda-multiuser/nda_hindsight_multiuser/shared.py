"""The one AuthStore shared by the tenant and HTTP extensions.

Both extensions run in the same API process but are separate instances, so a
revoke through the HTTP extension must invalidate the cache the tenant
extension reads. They share a single store set here at tenant-extension
startup; the HTTP extension reads it lazily at request time (its router is
built before startup).
"""

from __future__ import annotations

from .store import AuthStore

_store: AuthStore | None = None


def set_store(store: AuthStore) -> None:
    global _store
    _store = store


def get_store() -> AuthStore:
    if _store is None:
        raise RuntimeError(
            "NDA auth store is not initialized. The tenant extension "
            "(nda_hindsight_multiuser.tenant:NdaTenantExtension) must be loaded and started."
        )
    return _store
