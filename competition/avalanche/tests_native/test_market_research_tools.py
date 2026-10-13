"""Offline checks: public evidence tools cannot become wallet or trading tools."""
import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from nerya.tools.types import RiskLevel, PermissionScope

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("native_avalanche_read_tools", ROOT / "native-plugin/plugin.py")
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


class Context:
    def __init__(self, workspace):
        self.workspace = workspace
        self.tools = {}

    def get_service(self, name):
        assert name == "paths"
        return SimpleNamespace(root=self.workspace)

    def register_tool(self, descriptor):
        self.tools[descriptor.name] = descriptor
        return lambda: self.tools.pop(descriptor.name, None)


def registered(monkeypatch):
    monkeypatch.setenv("NERYA_COMPETITION", "avalanche")
    monkeypatch.setenv("NERYA_COMPETITION_ROOT", str(ROOT))
    ctx = Context(ROOT / ".runtime/native-workspace")
    plugin.PLUGIN.setup(ctx)
    return ctx.tools


def test_three_native_tools_are_read_only_and_no_arbitrary_paths(monkeypatch):
    tools = registered(monkeypatch)
    assert set(tools) == {"avalanche_verify_receipt","avalanche_strategy_research","avalanche_lfj_market"}
    for tool in tools.values():
        assert tool.risk == RiskLevel.READ and tool.read_only
        assert tool.input_schema["properties"] == {}
        assert tool.input_schema["additionalProperties"] is False
        assert tool.permission_scope not in (PermissionScope.SECRETS, PermissionScope.SYSTEM)


def test_normal_workspace_cannot_register_these_tools(monkeypatch,tmp_path):
    monkeypatch.setenv("NERYA_COMPETITION", "avalanche")
    monkeypatch.setenv("NERYA_COMPETITION_ROOT", str(ROOT))
    with pytest.raises(RuntimeError,match="isolated"):
        plugin.PLUGIN.setup(Context(tmp_path))


def test_missing_competition_mode_is_rejected(monkeypatch):
    monkeypatch.delenv("NERYA_COMPETITION",raising=False)
    monkeypatch.setenv("NERYA_COMPETITION_ROOT",str(ROOT))
    with pytest.raises(RuntimeError):
        plugin.PLUGIN.setup(Context(ROOT / ".runtime/native-workspace"))


def test_mainnet_read_adapter_has_no_signer_or_transaction_surface():
    text = (ROOT / "scripts/research-lfj-mainnet.mjs").read_text()
    assert "allowed.has(method)" in text
    assert "actual!==43114" in text
    assert "--no-save" in text
    for banned in ("Wallet", "getSigner", "sendTransaction", "eth_send", "fromEncryptedJson", "privateKey", "signTypedData"):
        assert banned not in text


def test_wrong_chain_result_is_not_reported_as_success(monkeypatch):
    tools = registered(monkeypatch)
    monkeypatch.setattr(plugin.subprocess,"run",lambda *a,**k:SimpleNamespace(returncode=0,stdout=json.dumps({
        "chainId":31337,"readOnly":True,"newTransactionSubmitted":False,"signerLoaded":False})))
    result = tools["avalanche_lfj_market"].handler(SimpleNamespace(id="test-call"))
    assert result.is_error


def test_research_summary_digest_and_scope():
    folder = ROOT / "research/2026-10-07"
    if not (folder / "summary.json").is_file():
        pytest.skip("Public research artifacts have not been generated in this checkout")
    summary = json.loads((folder / "summary.json").read_text())
    assert hashlib.sha256((folder / "研究报告.zh-CN.md").read_bytes()).hexdigest() == summary["reportSha256"]
    assert summary["liveProfitClaim"] is False
    assert summary["developerResearchNotModelAuthored"] is True
    checks = json.loads((folder / "independent-verification.json").read_text())
    assert checks["status"] == "passed" and len(checks["checks"]) == 8
    assert checks["strictUnseenOutOfSample"] is False


def test_decision_critical_facts_survive_as_structured_fields(monkeypatch):
    if not (ROOT / "research/2026-10-07/summary.json").is_file():
        pytest.skip("Public research artifacts not generated")
    tools = registered(monkeypatch)
    result = tools["avalanche_strategy_research"].handler(SimpleNamespace(id="research-test"))
    assert not result.is_error
    data = result.content[0].data
    assert data["closedSignal"]["close"] == 11.608
    assert data["closedSignal"]["prior20High"] == 12.008
    assert data["closedSignal"]["flatAccountNewBuySignal"] is False
    assert 41 < data["doubleCostReturnPct"] < 42
    assert 42 < data["gmxCrossSourceReturnPct"] < 43
    assert data["completedTrades"] == 2
    assert len(data["summary"]) < 1800
