"""Native Avalanche tools available in the standard Agent workspace."""

from __future__ import annotations

from ...integrations.avalanche import AVALANCHE_RPC, lfj_market_snapshot
from ..registry import make_native_descriptor
from ..types import PermissionScope, RiskLevel, ToolError, ToolErrorKind, ToolResult


def register_avalanche_tools(registry, deps, *, replace: bool = False) -> None:
    def lfj_market(call):
        try:
            sizes = call.arguments.get("sizes_usdc") or [100, 1000, 8500]
            rpc = AVALANCHE_RPC
            if deps.config is not None:
                rpc = deps.config.get("wallet.self_custody.rpc_urls.avalanche") or rpc
            data = lfj_market_snapshot(sizes, rpc_url=str(rpc))
            return ToolResult.from_json(
                tool_use_id=call.id, name=call.name, data=data,
                semantic_success=True,
            )
        except Exception:
            return ToolResult.from_error(
                tool_use_id=call.id,
                name=call.name,
                error=ToolError(
                    kind=ToolErrorKind.EXECUTION_ERROR,
                    message=(
                        "Avalanche LFJ quote is unavailable. No cached quote was "
                        "substituted and no transaction was submitted."
                    ),
                    retryable=True,
                ),
            )

    registry.register(make_native_descriptor(
        name="avalanche_lfj_market",
        description=(
            "Read current Avalanche C-Chain LFJ USDC/WAVAX spot quotes and compare "
            "order sizes across routable V2.1/V2.2 pools. Read-only: no wallet, "
            "approval, signing or transaction broadcast. Refresh before execution."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "sizes_usdc": {
                    "type": "array", "minItems": 1, "maxItems": 12,
                    "items": {"type": "number", "exclusiveMinimum": 0, "maximum": 1_000_000},
                },
            },
            "additionalProperties": False,
        },
        handler=lfj_market,
        risk=RiskLevel.READ,
        permission_scope=PermissionScope.NETWORK,
        read_only=True,
        is_concurrency_safe=False,
        tags=("avalanche", "lfj", "dex", "market", "read"),
        result_kind="json",
        auto_approve=True,
    ), replace=replace)


__all__ = ["register_avalanche_tools"]
