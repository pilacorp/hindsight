"""The one AuthStore shared by the tenant and HTTP extensions.

Both extensions run in the same API process but are separate instances, so a
revoke through the HTTP extension must invalidate the cache the tenant
extension reads. They share a single store set here at tenant-extension
startup; the HTTP extension reads it lazily at request time (its router is
built before startup).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from .store import AuthStore

_store: AuthStore | None = None
# The HTTP extension has no ExtensionContext (Hindsight does not pass one to it),
# so it cannot call run_migration itself. The tenant extension, which does have a
# context, registers its provisioner here at startup; the HTTP extension uses it
# to provision a new user's schema at creation time.
_provisioner: Callable[[str], Awaitable[None]] | None = None


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


def set_provisioner(fn: Callable[[str], Awaitable[None]]) -> None:
    global _provisioner
    _provisioner = fn


async def provision(schema: str) -> None:
    """Provision a tenant schema if a provisioner is registered.

    No-op when none is set: the tenant extension still provisions lazily on the
    user's first authenticated request, so creation without a provisioner is
    safe, just deferred.
    """
    if _provisioner is not None:
        await _provisioner(schema)
