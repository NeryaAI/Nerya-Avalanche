"""Avalanche C-Chain integrations used by the normal Nerya runtime.

The first-party LFJ adapter is intentionally read-only.  It discovers the
current USDC/WAVAX LB pairs from the router factories and compares quotes at a
single block.  Signing and execution remain in Nerya's existing financial
gateway and approval flow; this module never loads a wallet or sends a tx.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable

from ..connectors.evm_native import EVMNative
from ..core.errors import TradingError


AVALANCHE_CHAIN_ID = 43114
AVALANCHE_RPC = "https://api.avax.network/ext/bc/C/rpc"
LFJ_ROUTER = "0x18556DA13313f3532c54711497A8FedAC273220E"
NATIVE_USDC = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"
WAVAX = "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7"

# Keccak-256 function selectors.  Keeping the tiny read ABI local avoids a
# web3/ethers runtime dependency for a read-only quote tool.
_GET_WNATIVE = "0x6c9c0078"
_GET_FACTORY = "0x88cc58e4"
_GET_FACTORY_V21 = "0x5c5035cb"
_GET_ALL_LB_PAIRS = "0x6622e0d7"
_GET_TOKEN_X = "0x05e8746d"
_GET_TOKEN_Y = "0xda10610c"
_GET_SWAP_OUT = "0xa0d376cf"


def _word(value: int) -> str:
    return hex(int(value))[2:].rjust(64, "0")


def _address_word(address: str) -> str:
    raw = str(address).lower().removeprefix("0x")
    if len(raw) != 40 or any(ch not in "0123456789abcdef" for ch in raw):
        raise TradingError(f"invalid EVM address: {address!r}")
    return raw.rjust(64, "0")


def _decode_address(result: str) -> str:
    raw = str(result or "").removeprefix("0x")
    if len(raw) < 64:
        raise TradingError("malformed address return from Avalanche RPC")
    return "0x" + raw[-40:]


def _decode_u256_words(result: str, count: int) -> list[int]:
    raw = str(result or "").removeprefix("0x")
    if len(raw) < count * 64:
        raise TradingError("malformed numeric return from Avalanche RPC")
    return [int(raw[i * 64:(i + 1) * 64], 16) for i in range(count)]


def _decode_pairs(result: str) -> list[dict[str, Any]]:
    """Decode ``LBPairInformation[]`` (four static words per tuple)."""
    raw = str(result or "").removeprefix("0x")
    if len(raw) < 128:
        return []
    offset = int(raw[:64], 16) * 2
    if offset + 64 > len(raw):
        raise TradingError("malformed LFJ pair-array offset")
    length = int(raw[offset:offset + 64], 16)
    if length > 256:
        raise TradingError("refusing implausibly large LFJ pair array")
    cursor = offset + 64
    rows: list[dict[str, Any]] = []
    for _ in range(length):
        chunk = raw[cursor:cursor + 256]
        if len(chunk) < 256:
            raise TradingError("truncated LFJ pair-array result")
        rows.append({
            "bin_step": int(chunk[0:64], 16),
            "pair": "0x" + chunk[64 + 24:128],
            "created_by_owner": bool(int(chunk[128:192], 16)),
            "ignored_for_routing": bool(int(chunk[192:256], 16)),
        })
        cursor += 256
    return rows


def _eth_call(connector: EVMNative, to: str, data: str, block: str) -> str:
    result = connector._rpc("eth_call", [{"to": to, "data": data}, block])
    if not isinstance(result, str) or not result.startswith("0x"):
        raise TradingError("Avalanche eth_call returned malformed data")
    return result


def lfj_market_snapshot(
    sizes_usdc: Iterable[float] = (100.0, 1000.0, 8500.0),
    *,
    rpc_url: str = AVALANCHE_RPC,
    connector: EVMNative | None = None,
) -> dict[str, Any]:
    """Return current read-only LFJ USDC/WAVAX quotes on Avalanche.

    Every quote is taken at the same block.  No signer, allowance, simulation
    shortcut or transaction broadcast is used.
    """
    sizes = [float(value) for value in sizes_usdc]
    if not sizes or len(sizes) > 12 or any(value <= 0 or value > 1_000_000 for value in sizes):
        raise TradingError("sizes_usdc must contain 1-12 positive values <= 1,000,000")

    conn = connector or EVMNative(
        chain="avalanche", chain_id=AVALANCHE_CHAIN_ID,
        rpc_url=rpc_url, live=False,
    )
    if conn.get_chain_id() != AVALANCHE_CHAIN_ID:
        raise TradingError("Avalanche LFJ quote tool requires chainId 43114")

    block_number = conn.get_block_number()
    block_tag = hex(block_number)
    block = conn._rpc("eth_getBlockByNumber", [block_tag, False])
    if not isinstance(block, dict) or not isinstance(block.get("hash"), str):
        raise TradingError("could not resolve Avalanche quote block")

    wrapped = _decode_address(_eth_call(conn, LFJ_ROUTER, _GET_WNATIVE, block_tag))
    if wrapped.lower() != WAVAX.lower():
        raise TradingError("LFJ router wrapped-native token does not match WAVAX")

    factories = [
        (_decode_address(_eth_call(conn, LFJ_ROUTER, _GET_FACTORY_V21, block_tag)), "LFJ V2.1"),
        (_decode_address(_eth_call(conn, LFJ_ROUTER, _GET_FACTORY, block_tag)), "LFJ V2.2"),
    ]
    candidates: list[dict[str, Any]] = []
    pair_args = _address_word(WAVAX) + _address_word(NATIVE_USDC)
    for factory, version in factories:
        encoded = _eth_call(conn, factory, _GET_ALL_LB_PAIRS + pair_args, block_tag)
        for info in _decode_pairs(encoded):
            if info["ignored_for_routing"]:
                continue
            pair = info["pair"]
            token_x = _decode_address(_eth_call(conn, pair, _GET_TOKEN_X, block_tag))
            token_y = _decode_address(_eth_call(conn, pair, _GET_TOKEN_Y, block_tag))
            identities = {token_x.lower(), token_y.lower()}
            if identities != {WAVAX.lower(), NATIVE_USDC.lower()}:
                continue
            # Input is USDC. swapForY is true when token X is the input token.
            swap_for_y = token_x.lower() == NATIVE_USDC.lower()
            candidates.append({
                "pair": pair,
                "version": version,
                "binStep": int(info["bin_step"]),
                "swapForY": swap_for_y,
            })

    if not candidates:
        raise TradingError("LFJ returned no routable USDC/WAVAX pools")

    quotes: list[dict[str, Any]] = []
    for size in sizes:
        amount = int(round(size * 1_000_000))
        best: dict[str, Any] | None = None
        for row in candidates:
            data = (
                _GET_SWAP_OUT
                + _address_word(row["pair"])
                + _word(amount)
                + _word(1 if row["swapForY"] else 0)
            )
            left, output, fee = _decode_u256_words(
                _eth_call(conn, LFJ_ROUTER, data, block_tag), 3,
            )
            output_wavax = output / 1e18
            candidate = {
                "inputUsdc": size,
                "outputWavax": output_wavax,
                "feeInputUsdc": fee / 1e6,
                "feeBps": (fee * 10_000 / amount) if amount else 0.0,
                "effectiveUsdcPerWavax": (size / output_wavax) if output_wavax else 0.0,
                "completelyFillable": left == 0 and output > 0,
                "pair": row["pair"],
                "version": row["version"],
                "binStep": row["binStep"],
            }
            if candidate["completelyFillable"] and (
                best is None or candidate["outputWavax"] > best["outputWavax"]
            ):
                best = candidate
        quotes.append(best or {
            "inputUsdc": size,
            "outputWavax": 0.0,
            "feeInputUsdc": 0.0,
            "feeBps": 0.0,
            "effectiveUsdcPerWavax": 0.0,
            "completelyFillable": False,
            "version": "LFJ",
        })

    ts = int(str(block.get("timestamp", "0x0")), 16)
    return {
        "kind": "avalanche_lfj_market_research",
        "chainId": AVALANCHE_CHAIN_ID,
        "network": "Avalanche C-Chain",
        "readOnly": True,
        "newTransactionSubmitted": False,
        "blockNumber": block_number,
        "blockHash": block["hash"],
        "observedAt": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
        "router": LFJ_ROUTER,
        "nativeUsdc": NATIVE_USDC,
        "wrappedAvax": WAVAX,
        "quotes": quotes,
        "sources": [
            "https://developers.lfj.gg/deployment-addresses/avalanche",
            "https://developers.lfj.gg/concepts/fees",
        ],
        "limitations": [
            "Quotes are block-specific and must be refreshed before trading.",
            "LFJ bin step is price spacing, not the current fee rate.",
            "This read-only adapter never loads a signer or submits a transaction.",
        ],
    }


__all__ = [
    "AVALANCHE_CHAIN_ID", "AVALANCHE_RPC", "LFJ_ROUTER", "NATIVE_USDC",
    "WAVAX", "lfj_market_snapshot",
]
