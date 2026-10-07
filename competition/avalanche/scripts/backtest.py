"""Run the original Nerya backtest engine, never a presentation-only calculator."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
sys.path.insert(0, str(REPO))

from nerya.skills.builtin.backtest.scripts.config import BacktestConfig
from nerya.skills.builtin.backtest.scripts.engine import run_backtest
from nerya.skills.builtin.backtest.scripts.metrics import assemble_metrics
import nerya


def clean(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    return value


def run(source: dict) -> dict:
    if not Path(nerya.__file__).resolve().is_relative_to(REPO):
        raise RuntimeError("Nerya imports escaped the competition worktree")
    candles = source["candles"]
    if len(candles) < 100 or any(b["ts"] <= a["ts"] for a, b in zip(candles, candles[1:])):
        raise ValueError("Need ordered, unique real historical candles")
    template = ROOT / "skill/templates/avax_trend.py"
    spec = importlib.util.spec_from_file_location("competition_avax_trend", template)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    config = BacktestConfig(
        initial_capital_usd=10000, warmup_bars=30, tf="1d", markets=[source["market"]],
        allow_short=False, max_open_trades=1, max_drawdown_pct=30,
        fee_bps_by_venue={"COINBASE": 30, "BINANCE": 30, "DEX": 30},
        slip_bps_by_venue={"COINBASE": 10, "BINANCE": 10, "DEX": 10},
        max_run_seconds=60, data_mode="local", coverage_policy="strict",
    )
    result = run_backtest(None, config, candles_by_market={source["market"]: candles}, run_fn=module.run)
    metrics = assemble_metrics(result)
    if not result.trades:
        raise RuntimeError("No fills in this historical window; do not invent an execution demo")
    # The existing engine separately liquidates remaining inventory at the end
    # of the sample. That accounting fill is not a strategy signal; retain and
    # disclose it instead of misclassifying it as a lookahead trade.
    terminal_fills = [t for t in result.trades if t.get("engine_generated") and t.get("forced_close")]
    signal_fills = [t for t in result.trades if t not in terminal_fills]
    # MockCtx.clock is the candle CLOSE, while OHLCV/fill timestamps identify
    # candle OPEN. Adjacent daily close/open times are equal. Verify actual
    # candle indices and the fill's source open, not a false strict inequality
    # between those two different timestamp conventions.
    bar_index = {int(row["ts"]): i for i, row in enumerate(candles)}
    def later_bar_fill(trade):
        if trade.get("signal_ts") is None:
            return False
        signal_open = int(trade["signal_ts"]) - 86400
        before, after = bar_index.get(signal_open), bar_index.get(int(trade["ts"]))
        return (before is not None and after == before + 1 and
                math.isclose(float(trade["ideal_price"]), float(candles[after]["open"]), rel_tol=1e-10))
    timing_ok = bool(signal_fills) and all(later_bar_fill(t) for t in signal_fills)
    if not timing_ok:
        raise RuntimeError("Replay fill did not match the next candle's opening price")
    return clean({
        "lifecycle": "completed", "engine": metrics["engine_version"],
        "engineModule": "nerya.skills.builtin.backtest.scripts.engine.run_backtest",
        "strategy": {"id": "avax-trend-v1", "name": "AVAX Trend / Risk Budget", "version": 1,
                     "source": "reviewable reference script", "llmGenerated": False,
                     "scriptSha256": hashlib.sha256(template.read_bytes()).hexdigest(),
                     "allocationPct": 85, "fastDays": 10, "slowDays": 30},
        "metrics": metrics, "equity": result.equity_series, "benchmark": result.benchmark_series,
        "trades": result.trades, "decisions": result.decisions, "warnings": result.warnings,
        "checks": {"strictlyLaterFills": timing_ok, "noSyntheticData": True, "futureBarsVisible": False,
                   "timestampConvention": "signals: candle close; fills: next candle open; boundary timestamps may be equal",
                   "feeBpsEachLeg": 30, "slippageBpsEachLeg": 10, "warmupBars": 30,
                   "signalFills": len(signal_fills), "terminalLiquidations": len(terminal_fills),
                   "terminalLiquidationMethod": "final close, 30 bps fee, no additional modeled slippage"},
        "coverage": {"source": source["source"], "sourceUrl": source["sourceUrl"],
                     "start": source["start"], "end": source["end"], "closedBars": len(candles)},
        "limitations": ["Historical replay, not live profit or a forecast.",
                        "CEX AVAX price proxy; not a historical simulation of LFJ bins, gas or pool liquidity.",
                        "Script strategy; no model or multi-agent execution is fabricated.",
                        "Any engine-generated terminal liquidation is retained at the final close with a fee; it is not a next-bar strategy fill.",
                        "Benchmark underperformance is a performance result, not an execution failure."],
    })


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = run(json.loads(args.input.read_text()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, allow_nan=False, indent=2) + "\n")
    print(json.dumps({"status": "completed", "trades": len(report["trades"]), "engine": report["engine"]}))
