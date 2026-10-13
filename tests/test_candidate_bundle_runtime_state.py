from pathlib import Path
import sqlite3

from nerya.core.paths import WorkspacePaths
from nerya.evolution.candidate_bundle import workspace_revision
from nerya.evolution.patch_proposal import set_state
from nerya.workspace import ui


def test_revision_never_reads_runtime_database_files(tmp_path, monkeypatch):
    config = tmp_path / "nerya.yml"
    config.write_text("runtime: {live_trading_enabled: false}\n")
    names = {"nerya.db", "nerya.db-wal", "nerya.db-shm", "nerya.db-journal"}
    for name in names:
        (tmp_path / name).write_bytes(b"runtime state before review")
    read_bytes = Path.read_bytes

    def read_stable_file(path):
        if path.parent == tmp_path and path.name in names:
            raise AssertionError("workspace revision opened the live runtime database")
        return read_bytes(path)

    monkeypatch.setattr(Path, "read_bytes", read_stable_file)
    before = workspace_revision(tmp_path)
    for name in names:
        (tmp_path / name).write_bytes(b"runtime state after review")
    assert workspace_revision(tmp_path) == before
    config.write_text("runtime: {live_trading_enabled: true}\n")
    assert workspace_revision(tmp_path) != before


def test_revision_still_pins_operator_owned_database_inputs(tmp_path):
    data = tmp_path / "research.db"
    data.write_bytes(b"operator input version one")
    before = workspace_revision(tmp_path)
    data.write_bytes(b"operator input version two")
    assert workspace_revision(tmp_path) != before
    nested = tmp_path / "data" / "nerya.db"
    nested.parent.mkdir()
    nested.write_bytes(b"operator database version one")
    before = workspace_revision(tmp_path)
    nested.write_bytes(b"operator database version two")
    assert workspace_revision(tmp_path) != before


def test_ui_proposal_applies_after_runtime_receipts_change(tmp_path):
    paths = WorkspacePaths(tmp_path)
    with sqlite3.connect(tmp_path / "nerya.db") as con:
        con.execute("CREATE TABLE runtime_receipts(value TEXT)")
    proposed = ui.propose(paths, {
        "manifest": {
            "version": 1,
            "home": {"widgets": []},
            "pages": [{"id": "strategy-lab", "title": "Strategy Lab", "widgets": []}],
        },
        "summary": "Add requested strategy lab",
    })
    assert proposed["ok"] is True
    with sqlite3.connect(tmp_path / "nerya.db") as con:
        con.execute("INSERT INTO runtime_receipts VALUES ('reviewed')")
    set_state(paths, proposed["proposal_id"], "approved")
    applied = ui.apply(paths, proposed["proposal_id"])
    assert applied["ok"] is True
    assert applied["manifest"]["pages"][0]["id"] == "strategy-lab"
