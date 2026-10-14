"""HTTP extension: admin + user management under /ext/nda/v1.

Mounted by Hindsight at ``/ext``; routes here live under ``/nda/v1``. Every
route authenticates itself against the shared auth store — a missing or invalid
key is 401, the wrong kind of key is 403. No route reads, modifies, or deletes
another user's memory, banks, or documents; the management surface only touches
the ``nda_auth`` tables and provisions a schema on user creation.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from hindsight_api.extensions.http import HttpExtension

from . import shared
from .store import KIND_ADMIN, KIND_USER, AuthResult, HandleTaken, InvalidHandle, NotFound

if TYPE_CHECKING:
    from hindsight_api import MemoryEngine

__all__ = ["NdaHttpExtension"]


class CreateUser(BaseModel):
    handle: str
    display_name: str = ""
    issue_first_key: bool = False
    first_key_label: str = "initial"


class UpdateUser(BaseModel):
    display_name: str = Field(min_length=1)


class IssueKey(BaseModel):
    label: str = ""


class IssueAdminKey(BaseModel):
    name: str
    label: str = ""


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    return authorization[7:].strip()


async def _authed(authorization: str | None) -> AuthResult:
    result = await shared.get_store().authenticate(_bearer(authorization))
    if result is None:
        raise HTTPException(status_code=401, detail="invalid or inactive key")
    return result


async def require_admin(authorization: str | None = Header(default=None)) -> AuthResult:
    result = await _authed(authorization)
    if result.kind != KIND_ADMIN:
        raise HTTPException(status_code=403, detail="admin key required")
    return result


async def require_user(authorization: str | None = Header(default=None)) -> AuthResult:
    result = await _authed(authorization)
    if result.kind != KIND_USER:
        raise HTTPException(status_code=403, detail="user key required")
    return result


def _key_public(k) -> dict:
    return {
        "id": k.id,
        "prefix": k.prefix,
        "label": k.label,
        "status": k.status,
        "created_at": k.created_at,
        "last_used_at": k.last_used_at,
    }


def _user_public(u) -> dict:
    return {"handle": u.handle, "display_name": u.display_name, "status": u.status}


class NdaHttpExtension(HttpExtension):
    def get_router(self, memory: "MemoryEngine") -> APIRouter:
        router = APIRouter(tags=["NDA multi-user"])
        ext = self

        @router.get("/nda/v1/me")
        async def me(caller: AuthResult = Depends(require_user)):
            return {"handle": caller.handle, "kind": "user"}

        @router.get("/nda/v1/admin/whoami")
        async def whoami(caller: AuthResult = Depends(require_admin)):
            return {"admin": caller.admin_name, "kind": "admin"}

        @router.post("/nda/v1/admin/users", status_code=201)
        async def create_user(body: CreateUser, caller: AuthResult = Depends(require_admin)):
            store = shared.get_store()
            actor = f"admin:{caller.admin_name}"
            try:
                user = await store.create_user(body.handle, body.display_name, actor=actor)
            except HandleTaken as e:
                raise HTTPException(status_code=409, detail=str(e))
            except InvalidHandle as e:
                raise HTTPException(status_code=400, detail=str(e))
            # Provision the user's Hindsight schema now, so the first request
            # does not pay for it (and it is ready for the dashboard).
            await ext.context.run_migration(user.schema_name)
            out = {"user": _user_public(user)}
            if body.issue_first_key:
                issued, row = await store.issue_user_key(user.handle, body.first_key_label, actor=actor)
                out["key"] = {**_key_public(row), "secret": issued.full}  # shown once
            return out

        @router.get("/nda/v1/admin/users")
        async def list_users(caller: AuthResult = Depends(require_admin)):
            store = shared.get_store()
            users = await store.list_users()
            counts = {u.handle: 0 for u in users}
            for u in users:
                counts[u.handle] = sum(1 for k in await store.list_user_keys(u.handle) if k.status == "active")
            return {"users": [{**_user_public(u), "active_keys": counts[u.handle]} for u in users]}

        @router.get("/nda/v1/admin/users/{handle}")
        async def get_user(handle: str, caller: AuthResult = Depends(require_admin)):
            store = shared.get_store()
            user = await store.get_user(handle)
            if user is None or user.status == "deleted":
                raise HTTPException(status_code=404, detail="no such user")
            keys = [_key_public(k) for k in await store.list_user_keys(handle)]
            return {"user": _user_public(user), "keys": keys}

        @router.patch("/nda/v1/admin/users/{handle}")
        async def update_user(handle: str, body: UpdateUser, caller: AuthResult = Depends(require_admin)):
            try:
                user = await shared.get_store().update_user(
                    handle, display_name=body.display_name, actor=f"admin:{caller.admin_name}"
                )
            except NotFound:
                raise HTTPException(status_code=404, detail="no such user")
            return {"user": _user_public(user)}

        @router.post("/nda/v1/admin/users/{handle}/disable")
        async def disable_user(handle: str, caller: AuthResult = Depends(require_admin)):
            return await _set_status(handle, "disabled", caller)

        @router.post("/nda/v1/admin/users/{handle}/enable")
        async def enable_user(handle: str, caller: AuthResult = Depends(require_admin)):
            return await _set_status(handle, "active", caller)

        async def _set_status(handle: str, status: str, caller: AuthResult):
            try:
                user = await shared.get_store().set_user_status(
                    handle, status, actor=f"admin:{caller.admin_name}"
                )
            except NotFound:
                raise HTTPException(status_code=404, detail="no such user")
            return {"user": _user_public(user)}

        @router.delete("/nda/v1/admin/users/{handle}")
        async def delete_user(handle: str, caller: AuthResult = Depends(require_admin)):
            await shared.get_store().delete_user(handle, actor=f"admin:{caller.admin_name}")
            return {"deleted": handle, "note": "keys revoked; schema and memories retained"}

        @router.post("/nda/v1/admin/users/{handle}/keys", status_code=201)
        async def issue_key(handle: str, body: IssueKey, caller: AuthResult = Depends(require_admin)):
            try:
                issued, row = await shared.get_store().issue_user_key(
                    handle, body.label, actor=f"admin:{caller.admin_name}"
                )
            except NotFound:
                raise HTTPException(status_code=404, detail="no such user")
            return {"key": {**_key_public(row), "secret": issued.full}}  # shown once

        @router.get("/nda/v1/admin/users/{handle}/keys")
        async def list_keys(handle: str, caller: AuthResult = Depends(require_admin)):
            return {"keys": [_key_public(k) for k in await shared.get_store().list_user_keys(handle)]}

        @router.post("/nda/v1/admin/keys/{key_id}/revoke")
        async def revoke_key(key_id: str, caller: AuthResult = Depends(require_admin)):
            await shared.get_store().revoke_key(key_id, actor=f"admin:{caller.admin_name}")
            return {"revoked": key_id}

        @router.post("/nda/v1/admin/admins/keys", status_code=201)
        async def issue_admin_key(body: IssueAdminKey, caller: AuthResult = Depends(require_admin)):
            issued, row = await shared.get_store().issue_admin_key(
                body.name, body.label, actor=f"admin:{caller.admin_name}"
            )
            return {"key": {**_key_public(row), "secret": issued.full}}

        @router.post("/nda/v1/admin/admins/keys/{key_id}/revoke")
        async def revoke_admin_key(key_id: str, caller: AuthResult = Depends(require_admin)):
            await shared.get_store().revoke_key(key_id, actor=f"admin:{caller.admin_name}")
            return {"revoked": key_id}

        @router.get("/nda/v1/admin/audit")
        async def audit(limit: int = 100, caller: AuthResult = Depends(require_admin)):
            return {"events": await shared.get_store().list_audit(limit)}

        return router
