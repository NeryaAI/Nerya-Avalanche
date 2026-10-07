"""Run the unmodified Nerya Agent against a dedicated competition workspace.

Only model profiles are reused from the explicitly selected local configuration.
Model credentials are resolved locally, held in this process's environment, and
never serialized to the competition configuration or sent to the browser.
Accounts, conversations, schedules, wallet keys and plugins are NOT copied.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import stat

from nerya.core import yaml_io
from nerya.core.config import load_config
from nerya.security.secrets import SecretVault
from nerya.workspace.manager import WorkspaceManager

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT / ".runtime" / "native-workspace"


def model_profiles(source: Path) -> dict:
    """Read only the selected model profiles; do not mutate the source vault."""
    raw = yaml_io.load(source / "nerya.yml", default={}) or {}
    llm = deepcopy(raw.get("llm") or {})
    if not llm.get("tiers"):
        raise RuntimeError("The selected local workspace has no model profiles")
    # No legacy HTTP proxy profiles or unrelated providers in this demo.
    selected = {"bricksum", "agnes-ai", "step-plan", "zhipu", "sensenova", "mimo-iqach"}
    llm["providers"] = {k: v for k, v in llm.get("providers", {}).items() if k in selected}
    for tier in llm["tiers"].values():
        if isinstance(tier.get("routes"), list):
            tier["routes"] = [r for r in tier["routes"] if r.get("provider") in selected]
        if tier.get("provider") not in selected:
            raise RuntimeError("Select a configured HTTPS model tier before starting the native demo")

    key_path = source / "vault" / "keyring.ref"
    if not key_path.is_file() or key_path.is_symlink():
        raise RuntimeError("Selected model vault has no readable local key; configure models locally first")
    info = key_path.stat()
    if info.st_mode & 0o077 or info.st_uid != os.getuid():
        raise RuntimeError("Model-vault key must have owner-only permissions")
    # Constructor + read-only _load intentionally avoids open()'s legacy migration.
    vault = SecretVault(path=source / "vault" / "secrets.enc", passphrase=key_path.read_text().strip())
    vault._load()
    if vault.load_error:
        raise RuntimeError("The selected model vault cannot be opened; no source files changed")

    def rewrite(value):
        if isinstance(value, list):
            return [rewrite(v) for v in value]
        if not isinstance(value, dict):
            return value
        out = {k: rewrite(v) for k, v in value.items() if k != "provider_key_ref"}
        refs = value.get("provider_key_ref")
        if refs:
            if not isinstance(refs, str):
                raise RuntimeError("Unsupported model credential reference shape")
            names = []
            for ref in refs.split(","):
                ref = ref.strip()
                if not ref.startswith("vault://"):
                    raise RuntimeError("Model credentials must be local vault references")
                env_name = "NERYA_COMPETITION_MODEL_" + hashlib.sha256(ref.encode()).hexdigest()[:16].upper()
                os.environ[env_name] = vault.resolve(ref.removeprefix("vault://"))
                names.append(env_name)
            out["provider_key_env"] = ",".join(names)
        return out

    return rewrite(llm)


def prepare(model_source: Path | None):
    if os.environ.get("NERYA_COMPETITION") != "avalanche":
        raise RuntimeError("This launcher is competition-only")
    WORKSPACE.mkdir(parents=True, exist_ok=True, mode=0o700)
    if WORKSPACE.resolve() != WORKSPACE.absolute():
        raise RuntimeError("Native competition workspace cannot be a symlink")
    manager = WorkspaceManager.init(WORKSPACE)
    config = manager.config
    if model_source is not None:
        if model_source.resolve() == WORKSPACE.resolve():
            raise RuntimeError("Model source and isolated workspace must differ")
        config.data["llm"] = model_profiles(model_source.resolve())
    tiers = config.data.get("llm", {}).get("tiers", {})
    if any(tiers.get(t, {}).get("provider", "mock") == "mock" for t in ("light", "medium", "high")):
        raise RuntimeError("A real model is required for every native competition Agent tier")
    config.data["runtime"].update({"live_trading_enabled": False, "mock_mode": False,
                                  "paper_trading_enabled": True, "permission_mode": "auto"})
    config.data["runtime"]["auth"] = {"mode": "local"}
    config.data["dashboard"] = {"host": "127.0.0.1", "port": 18480}
    config.data["workspace_preferences"]["market_defaults"].update({"symbol": "AVAXUSDT", "venue": "binance"})
    config.data["agent"]["operator"]["preset"] = "dev"
    yaml_io.dump(config.paths.config, config.data)
    config.paths.config.chmod(0o600)
    for relative, source in (("skills/avalanche_competition", ROOT / "skill"),
                             ("plugins/avalanche_receipts", ROOT / "native-plugin")):
        shutil.copytree(source, WORKSPACE / relative, dirs_exist_ok=True)
    enabled = yaml_io.load(config.paths.skills_enabled, default={}) or {}
    enabled["enabled"] = list(dict.fromkeys([*enabled.get("enabled", []), "avalanche_competition"]))
    yaml_io.dump(config.paths.skills_enabled, enabled)
    # A clearly attributed, read-only historical proof, not the new strategy's execution.
    proof_dir = WORKSPACE / "artifacts" / "avalanche-reference"
    proof_dir.mkdir(parents=True, exist_ok=True)
    for name in ("bootstrap.json", "0x1fdb183Fa955efdc38aEdccfAB9387D281c8c7D9.json"):
        source = ROOT / "artifacts" / "fuji" / name
        if source.is_file():
            shutil.copy2(source, proof_dir / name)
    return load_config(WORKSPACE)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-source", type=Path)
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    config = prepare(args.model_source)
    print(json.dumps({"service": "nerya-native-agent-competition", "workspace": str(WORKSPACE),
                      "ui": "http://127.0.0.1:18480/chat", "live_trading": False,
                      "mock_mode": False, "model_secrets": "in-memory only"}), flush=True)
    if args.prepare_only:
        return 0
    from nerya.api.local_server import build_server
    server = build_server(config, host="127.0.0.1", port=18417, start_cron=False, start_continuous=False)
    def stop(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
