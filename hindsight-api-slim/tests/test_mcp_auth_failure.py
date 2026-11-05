"""Auth failures on MCP must be HTTP 401, not a 200 tool payload."""

import ast
import inspect
from unittest.mock import AsyncMock, MagicMock

import pytest

from hindsight_api.extensions import AuthenticationError, Tenant, TenantContext, TenantExtension
from hindsight_api.mcp_tools import MCPToolsConfig, _run_tool


def _messages(send: AsyncMock) -> list[dict]:
    return [call.args[0] for call in send.await_args_list]


class TestToolDoesNotSwallowAuth:
    @pytest.mark.asyncio
    async def test_run_tool_propagates_authentication_error(self):
        from hindsight_api.api.mcp import _mcp_auth_failed

        token = _mcp_auth_failed.set(False)
        try:
            config = MCPToolsConfig(bank_id_resolver=lambda: "bank-a")

            async def run(_bank: str) -> dict:
                raise AuthenticationError("Authentication failed: 403")

            with pytest.raises(AuthenticationError, match="403"):
                await _run_tool(config, bank_id=None, as_json=True, action="listing banks", run=run)

            assert _mcp_auth_failed.get() is True
        finally:
            _mcp_auth_failed.reset(token)

    def test_every_broad_handler_reraises_authentication_error(self):
        import hindsight_api.mcp_tools as tools

        tree = ast.parse(inspect.getsource(tools))
        offenders: list[int] = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.ExceptHandler):
                continue
            caught = node.type
            if not isinstance(caught, ast.Name) or caught.id != "Exception":
                continue
            first = node.body[0]
            call = first.value if isinstance(first, ast.Expr) else None
            name = call.func.id if isinstance(call, ast.Call) and isinstance(call.func, ast.Name) else None
            if name != "_reraise_authentication_error":
                offenders.append(node.lineno)
        assert offenders == []


class TestHttp401:
    @staticmethod
    def _middleware(extension, app):
        from hindsight_api.api.mcp import MCPMiddleware

        memory = MagicMock()
        memory._tenant_extension = extension
        memory.resolve_bank_alias = AsyncMock(side_effect=lambda bank_id, **_: bank_id)
        return MCPMiddleware(
            app=None,
            memory=memory,
            multi_bank_app=app,
            single_bank_app=app,
        )

    @pytest.mark.asyncio
    async def test_gate_401_includes_www_authenticate(self):
        class Rejecting(TenantExtension):
            async def authenticate(self, context):
                raise AuthenticationError("Authentication failed: 403")

            async def list_tenants(self):
                return [Tenant(schema="public")]

        send = AsyncMock()
        scope = {
            "type": "http",
            "method": "POST",
            "path": "/mcp/",
            "headers": [(b"authorization", b"Bearer expired")],
        }
        await self._middleware(Rejecting({}), AsyncMock())(scope, AsyncMock(), send)

        start = _messages(send)[0]
        assert start["status"] == 401
        headers = {name.lower(): value for name, value in start["headers"]}
        assert headers[b"www-authenticate"] == b'Bearer error="invalid_token"'

    @pytest.mark.asyncio
    async def test_tool_auth_failure_rewrites_response_to_401(self):
        from hindsight_api.api.mcp import mark_mcp_authentication_failed

        class Accepting(TenantExtension):
            async def authenticate(self, context):
                return TenantContext(schema_name="user_abc")

            async def list_tenants(self):
                return [Tenant(schema="user_abc")]

        async def app(scope, receive, send):
            mark_mcp_authentication_failed()
            await send(
                {
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [(b"content-type", b"application/json")],
                }
            )
            await send({"type": "http.response.body", "body": b'{"error":"auth","banks":[]}'})

        send = AsyncMock()
        scope = {
            "type": "http",
            "method": "POST",
            "path": "/mcp/",
            "headers": [(b"authorization", b"Bearer still-presented")],
        }
        await self._middleware(Accepting({}), app)(scope, AsyncMock(), send)

        start = _messages(send)[0]
        assert start["status"] == 401
        headers = {name.lower(): value for name, value in start["headers"]}
        assert headers[b"www-authenticate"] == b'Bearer error="invalid_token"'

    def test_request_context_reuses_schema_from_the_gate(self):
        from hindsight_api.engine.memory_engine import _current_schema
        from hindsight_api.mcp_tools import _get_request_context

        config = MCPToolsConfig(bank_id_resolver=lambda: "bank-a")
        assert _get_request_context(config).authenticated_schema is None

        token = _current_schema.set("user_abc")
        try:
            assert _get_request_context(config).authenticated_schema == "user_abc"
        finally:
            _current_schema.reset(token)
