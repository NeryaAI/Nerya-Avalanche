"""Offline checks for the native competition launcher and proof-tool boundary."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path

import pytest
from nerya.core import yaml_io
from nerya.security.secrets import SecretVault


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("native_competition_runtime", ROOT / "scripts/native_runtime.py")
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


def source_workspace(tmp_path):
    source = tmp_path / "original"
    (source / "vault").mkdir(parents=True)
    key = source / "vault/keyring.ref"
    key.write_text("offline-test-passphrase-only-not-a-real-credential")
    key.chmod(0o600)
    vault = SecretVault(path=source / "vault/secrets.enc", passphrase=key.read_text())
    vault.put(name="demo_model", value="offline-test-api-key-not-a-real-credential", kind="api_key", scope=["llm"])
    profile = {"base_url": "https://example.test/v1", "kind": "chat_completions", "provider_key_ref": "vault://demo_model"}
    model = {"provider": "zhipu", "model": "offline-model-fixture", "provider_key_ref": "vault://demo_model"}
    yaml_io.dump(source / "nerya.yml", {"llm": {"providers": {"zhipu": profile, "unrelated": {"provider_key_ref": "vault://must-not-read"}},
        "tiers": {name: dict(model) for name in ("light", "medium", "high")}},
        "accounts": {"do_not_copy": "normal account setting"}, "runtime": {"live_trading_enabled": True}})
    return source


def test_only_model_configuration_is_selected(tmp_path, monkeypatch):
    source = source_workspace(tmp_path)
    key_name = "NERYA_COMPETITION_MODEL_" + hashlib.sha256(b"vault://demo_model").hexdigest()[:16].upper()
    monkeypatch.delenv(key_name, raising=False)
    result = native.model_profiles(source)
    assert set(result["providers"]) == {"zhipu"}
    assert "accounts" not in result and "runtime" not in result
    encoded = json.dumps(result)
    assert "offline-test-api-key" not in encoded
    assert "provider_key_ref" not in encoded
    assert result["tiers"]["medium"]["provider_key_env"] == key_name
    assert os.environ[key_name] == "offline-test-api-key-not-a-real-credential"


def test_source_vault_and_configuration_are_never_mutated(tmp_path, monkeypatch):
    source = source_workspace(tmp_path)
    before = {str(p.relative_to(source)): p.read_bytes() for p in source.rglob("*") if p.is_file()}
    native.model_profiles(source)
    after = {str(p.relative_to(source)): p.read_bytes() for p in source.rglob("*") if p.is_file()}
    assert before == after


def test_missing_existing_key_is_not_created(tmp_path):
    source = source_workspace(tmp_path)
    (source / "vault/keyring.ref").unlink()
    with pytest.raises(RuntimeError, match="no readable local key"):
        native.model_profiles(source)
    assert not (source / "vault/keyring.ref").exists()


def test_shared_key_permissions_are_rejected(tmp_path):
    source = source_workspace(tmp_path)
    (source / "vault/keyring.ref").chmod(0o644)
    with pytest.raises(RuntimeError, match="owner-only"):
        native.model_profiles(source)


def test_keystore_symlinks_are_rejected(tmp_path):
    source = source_workspace(tmp_path)
    key = source / "vault/keyring.ref"
    other = tmp_path / "key"
    key.rename(other)
    key.symlink_to(other)
    with pytest.raises(RuntimeError, match="no readable local key"):
        native.model_profiles(source)


def test_launcher_refuses_normal_mode(monkeypatch):
    monkeypatch.delenv("NERYA_COMPETITION", raising=False)
    with pytest.raises(RuntimeError, match="competition-only"):
        native.prepare(None)


def test_native_entry_redirects_and_disables_old_panel_api():
    repo = ROOT.parents[1]
    entry = (repo / "dashboard/app/competition/avalanche/page.tsx").read_text()
    assert "redirect('/chat')" in entry
    assert "CompetitionWorkbench" not in entry
    proxy = (repo / "dashboard/app/api/competition/[...path]/route.ts").read_text()
    assert "NERYA_COMPETITION_NATIVE==='1'" in proxy


def test_proof_tool_is_read_only_and_never_opens_wallets():
    script = (ROOT / "scripts/verify-receipt.mjs").read_text()
    assert "referenceExecution:true" in script
    assert "newTransactionSubmitted:false" in script
    assert "blockTag:receipt.blockNumber" in script
    assert "verifyTypedData" in script
    for forbidden in ("fromEncryptedJson", "privateKey", "sendTransaction", "signTypedData", "getSigner"):
        assert forbidden not in script
