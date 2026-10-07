from __future__ import annotations

import pytest

from nerya.integrations.avalanche import (
    AVALANCHE_CHAIN_ID,
    LFJ_ROUTER,
    NATIVE_USDC,
    WAVAX,
    _address_word,
    _decode_pairs,
    _word,
    lfj_market_snapshot,
)


pytestmark = pytest.mark.smoke


FACTORY_21 = "0x" + "11" * 20
FACTORY_22 = "0x" + "22" * 20
PAIR = "0x" + "33" * 20


def _address_result(address: str) -> str:
    return "0x" + _address_word(address)


def _pairs_result(rows: list[tuple[int, str, bool, bool]]) -> str:
    payload = _word(len(rows))
    for bin_step, pair, owner, ignored in rows:
        payload += _word(bin_step) + _address_word(pair) + _word(owner) + _word(ignored)
    return "0x" + _word(32) + payload


class FakeAvalanche:
    def get_chain_id(self) -> int:
        return AVALANCHE_CHAIN_ID

    def get_block_number(self) -> int:
        return 123456

    def _rpc(self, method, params):
        if method == "eth_getBlockByNumber":
            return {"hash": "0x" + "ab" * 32, "timestamp": hex(1_700_000_000)}
        assert method == "eth_call"
        call, _block = params
        target = call["to"].lower()
        data = call["data"].lower()
        if target == LFJ_ROUTER.lower() and data == "0x6c9c0078":
            return _address_result(WAVAX)
        if target == LFJ_ROUTER.lower() and data == "0x5c5035cb":
            return _address_result(FACTORY_21)
        if target == LFJ_ROUTER.lower() and data == "0x88cc58e4":
            return _address_result(FACTORY_22)
        if target == FACTORY_21.lower() and data.startswith("0x6622e0d7"):
            return _pairs_result([])
        if target == FACTORY_22.lower() and data.startswith("0x6622e0d7"):
            return _pairs_result([(10, PAIR, False, False)])
        if target == PAIR.lower() and data == "0x05e8746d":
            return _address_result(NATIVE_USDC)
        if target == PAIR.lower() and data == "0xda10610c":
            return _address_result(WAVAX)
        if target == LFJ_ROUTER.lower() and data.startswith("0xa0d376cf"):
            # selector + address + uint128 amount + bool
            amount = int(data[8 + 64:8 + 128], 16)
            out = amount * 10**12 // 10
            fee = amount // 2000
            return "0x" + _word(0) + _word(out) + _word(fee)
        raise AssertionError((method, target, data[:10]))


def test_decode_lfj_pair_array():
    decoded = _decode_pairs(_pairs_result([(10, PAIR, True, False)]))
    assert decoded == [{
        "bin_step": 10,
        "pair": PAIR,
        "created_by_owner": True,
        "ignored_for_routing": False,
    }]


def test_lfj_market_snapshot_is_read_only_and_selects_fillable_quote():
    result = lfj_market_snapshot([100, 1000], connector=FakeAvalanche())
    assert result["chainId"] == 43114
    assert result["readOnly"] is True
    assert result["newTransactionSubmitted"] is False
    assert result["blockNumber"] == 123456
    assert [row["inputUsdc"] for row in result["quotes"]] == [100.0, 1000.0]
    assert all(row["completelyFillable"] for row in result["quotes"])
    assert all(row["version"] == "LFJ V2.2" for row in result["quotes"])
    assert all(row["pair"].lower() == PAIR.lower() for row in result["quotes"])


def test_lfj_market_snapshot_rejects_bad_sizes_before_rpc():
    with pytest.raises(Exception):
        lfj_market_snapshot([], connector=FakeAvalanche())
    with pytest.raises(Exception):
        lfj_market_snapshot([0], connector=FakeAvalanche())
