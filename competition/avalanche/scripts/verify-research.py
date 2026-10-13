"""Independent cash/quantity reconciliation of selected spot backtest evidence."""
from __future__ import annotations
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "research" / "2026-10-07"


def reconcile(source, window, multiplier=1):
    report = json.loads((ROOT / f"runs/{source}-daily_breakout-{window}-cost{multiplier}.json").read_text())
    data_path = ROOT / f"data/{source}-1d.json"
    assert hashlib.sha256(data_path.read_bytes()).hexdigest() == report["dataSha256"]
    raw = json.loads(data_path.read_text())["candles"]
    start = int(datetime.fromisoformat(report["startUtc"]).timestamp())
    end = int(datetime.fromisoformat(report["endExclusiveUtc"]).timestamp())
    rows = [r for r in raw if start-90*86400 <= r["ts"] < end]
    cash, qty, pending = 10000.0, 0.0, None
    fee, slip = .003*multiplier, .001*multiplier
    trades, equity = [], []
    for i, bar in enumerate(rows):
        if pending == "buy":
            price = bar["open"]*(1+slip)
            notional = cash*.85
            qty = notional/price
            cash -= notional*(1+fee)
            trades.append({"ts":bar["ts"],"side":"buy","qty":qty,"price":price,"fee":notional*fee})
        elif pending == "sell":
            price = bar["open"]*(1-slip)
            notional = qty*price
            cash += notional*(1-fee)
            trades.append({"ts":bar["ts"],"side":"sell","qty":qty,"price":price,"fee":notional*fee})
            qty = 0.0
        pending = None
        if i < 90:
            continue
        equity.append([bar["ts"],cash+qty*bar["close"]])
        prior_high = max(r["high"] for r in rows[i-20:i])
        prior_low = min(r["low"] for r in rows[i-10:i])
        if qty == 0 and bar["close"] > prior_high:
            pending = "buy"
        elif qty > 0 and bar["close"] < prior_low:
            pending = "sell"
    terminal_slip = 0.0
    if qty:
        price = rows[-1]["close"]
        notional = qty*price
        cash += notional*(1-fee)
        terminal_slip = notional*slip
        trades.append({"ts":rows[-1]["ts"],"side":"sell","qty":qty,"price":price,"fee":notional*fee,"engine_generated":True})
        equity[-1][1] = cash
    assert len(trades) == len(report["trades"])
    for actual, independent in zip(report["trades"],trades):
        assert actual["ts"] == independent["ts"] and actual["side"] == independent["side"]
        for key in ("qty","price","fee"):
            assert math.isclose(actual[key],independent[key],rel_tol=1e-10), (key,actual,independent)
    assert math.isclose(cash,report["engineMetrics"]["final_equity_usd"],rel_tol=1e-10)
    adjusted = cash-len(trades)*.10*multiplier-terminal_slip
    assert math.isclose(adjusted,report["net"]["finalEquityUsd"],rel_tol=1e-10)
    for native, separate in zip(report["engineEquity"],equity):
        assert native[0] == separate[0] and math.isclose(native[1],separate[1],rel_tol=1e-10)
    return {"source":source,"window":window,"costMultiplier":multiplier,
            "independentFinalNetEquity":adjusted,"netReturnPct":(adjusted/10000-1)*100,
            "fillsMatched":len(trades),"allEquityPointsMatched":len(equity),"status":"passed"}


def main():
    checks = [reconcile("binance",w) for w in ("year","half_year","last_90d","last_60d")]
    checks.append(reconcile("binance","half_year",2))
    checks += [reconcile("gmx",w) for w in ("half_year","last_90d","last_60d")]
    report = {"status":"passed","verifiedAt":datetime.now(timezone.utc).isoformat(),
              "method":"Separate cash/quantity simulator, no calls into Nerya engine or original strategy function",
              "checks":checks,"nativeReplayEngineModified":False,"strictUnseenOutOfSample":False,
              "limits":["Reconciliation and causal execution checks do not establish future profitability.",
                        "Historical LFJ liquidity and transaction execution are not simulated."]}
    (ROOT / "independent-verification.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__ == "__main__": main()
