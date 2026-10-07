"""Finite, declared AVAX spot experiments using Nerya's unchanged replay engine.

This is developer research, NOT fabricated model authorship or LFJ realized P&L.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
OUT = ROOT / "research" / "2026-10-07"
sys.path.insert(0, str(REPO))
from nerya.skills.builtin.backtest.scripts.config import BacktestConfig
from nerya.skills.builtin.backtest.scripts.engine import run_backtest
from nerya.skills.builtin.backtest.scripts.metrics import assemble_metrics

CANDIDATES = [
    {"id": "ema_4h_baseline", "title": "原基线：4小时EMA20/60", "tf": "4h"},
    {"id": "daily_slow_trend", "title": "日线慢趋势与滞回过滤", "tf": "1d"},
    {"id": "daily_breakout", "title": "日线20日突破、10日退出", "tf": "1d"},
    {"id": "core_trend", "title": "40%核心仓位＋趋势卫星仓位", "tf": "1d"},
    {"id": "dip_in_uptrend", "title": "4小时顺大趋势回撤", "tf": "4h"},
]
MARKET = "BINANCE:AVAXUSDT"
END = int(datetime(2026, 10, 7, tzinfo=timezone.utc).timestamp())
WINDOWS = {
    "year": int(datetime(2025, 10, 7, tzinfo=timezone.utc).timestamp()),
    "half_year": int(datetime(2026, 4, 1, tzinfo=timezone.utc).timestamp()),
    "last_90d": END - 90 * 86400,
    "last_60d": END - 60 * 86400,
}


def clean(value):
    if isinstance(value, float) and not math.isfinite(value): return None
    if isinstance(value, dict): return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)): return [clean(v) for v in value]
    return value


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(clean(value), ensure_ascii=False, allow_nan=False, indent=2) + "\n")


def ema(closes, period):
    result = sum(closes[:period]) / period
    for value in closes[period:]: result += (value - result) * (2 / (period + 1))
    return result


def rsi(closes, period=14):
    diffs = [b-a for a, b in zip(closes[-period-1:], closes[-period:])]
    gain = sum(max(0, x) for x in diffs)
    loss = sum(max(0, -x) for x in diffs)
    return 100 - 100/(1+gain/loss) if loss else (100.0 if gain else 50.0)


def make_strategy(spec):
    family, tf = spec["id"], spec["tf"]

    def run(ctx):
        market = ctx.config.markets[0]
        bars = ctx.market.candles(market, timeframe=tf, limit=600 if family == "dip_in_uptrend" else 200)
        if len(bars) < (200 if family == "dip_in_uptrend" else 60):
            return {"status": "hold", "reason": "指标预热"}
        c = [float(x["close"]) for x in bars]
        pos = ctx.portfolio.position(market)
        held = float(pos.size) if pos else 0.0
        enter = leave = False
        target = .85
        if family == "ema_4h_baseline":
            fast, slow = ema(c, 20), ema(c, 60)
            enter = fast > slow and c[-1] > slow
            leave = not enter
        elif family in ("daily_slow_trend", "core_trend"):
            fast, slow = sum(c[-20:])/20, sum(c[-60:])/60
            regime = bool(ctx.state.get("spot_regime", False))
            if fast > slow*1.01 and c[-1] > slow*1.01: regime = True
            elif fast < slow*.99 or c[-1] < slow*.99: regime = False
            ctx.state.set("spot_regime", regime)
            enter, leave = regime, not regime
            if family == "core_trend":
                target = .85 if regime else .40
                now = ctx.clock.now_ms()
                last = int(ctx.state.get("rebalance_at", 0))
                if last and now-last < 7*86400000: return {"status": "hold", "reason": "周度再平衡间隔"}
                ctx.state.set("rebalance_at", now)
                nav = float(ctx.portfolio.equity_usd)
                weight = held*c[-1]/nav if nav > 0 else 0.0
                diff = target-weight
                if abs(diff) <= .05: return {"status": "hold", "reason": "五个百分点免交易带"}
                if diff > 0:
                    ctx.trading.open_position(market=market, side="long", sizing={"method":"pct_nav","pct_nav":diff},
                                              reasoning_ref="按净值百分比增加核心/趋势敞口")
                elif held > 0:
                    ctx.trading.reduce_position(market=market, side="long", reduce_pct=min(1, -diff/weight),
                                                reasoning_ref="周度减仓到目标敞口")
                return {"status":"ok", "reason":"核心与趋势仓位再平衡"}
        elif family == "daily_breakout":
            enter = c[-1] > max(float(x["high"]) for x in bars[-21:-1])
            leave = c[-1] < min(float(x["low"]) for x in bars[-11:-1])
        elif family == "dip_in_uptrend":
            slow, oscillator = ema(c, 200), rsi(c)
            target = .70
            enter = c[-1] > slow and oscillator < 40
            leave = oscillator > 65 or c[-1] < slow*.98 or (pos is not None and c[-1] < float(pos.avg_price)*.88)
        if enter and held <= 1e-12:
            ctx.trading.open_position(market=market, side="long", sizing={"method":"pct_nav","pct_nav":target},
                                      reasoning_ref=spec["title"]+"：已收盘信号入场")
            return {"status":"ok", "reason":"收盘确认后下一根开盘买入"}
        if leave and held > 1e-12:
            ctx.trading.close_position(market=market, side="long", reasoning_ref=spec["title"]+"：退出条件成立")
            return {"status":"ok", "reason":"收盘确认后下一根开盘退出"}
        return {"status":"hold", "reason":"保持当前仓位"}
    return run


def drawdown(series):
    peak, maximum = 10000.0, 0.0
    for _, value in series:
        peak = max(peak, value)
        maximum = max(maximum, (peak-value)/peak*100)
    return maximum


def evaluate(spec, source, window, multiplier=1):
    tf, start = spec["tf"], WINDOWS[window]
    interval = 86400 if tf == "1d" else 14400
    warm = 90 if tf == "1d" else 200
    dataset_path = OUT / "data" / f"{source}-{tf}.json"
    raw = json.loads(dataset_path.read_text())
    rows = [r for r in raw["candles"] if start-warm*interval <= r["ts"] < END]
    if rows[0]["ts"] != start-warm*interval or rows[-1]["ts"] != END-interval or len(rows) != warm+(END-start)//interval:
        raise ValueError("Missing fixed-window history")
    fee, slip, gas = 30*multiplier, 10*multiplier, .10*multiplier
    cfg = BacktestConfig(initial_capital_usd=10000, warmup_bars=warm, tf=tf, markets=[MARKET], allow_short=False,
        max_open_trades=1, max_drawdown_pct=25, fee_bps_by_venue={"BINANCE":fee}, slip_bps_by_venue={"BINANCE":slip},
        max_run_seconds=120, data_mode="local", coverage_policy="strict", start_utc=datetime.fromtimestamp(start,timezone.utc).isoformat(),
        end_utc=datetime.fromtimestamp(END,timezone.utc).isoformat())
    result = run_backtest(None, cfg, candles_by_market={MARKET: rows}, run_fn=make_strategy(spec),
                          strategy_config={"markets":[MARKET],"timeframe":tf,"policy":{"allow_short":False}})
    metrics = assemble_metrics(result)
    if metrics["replay"]["errors"]:
        raise RuntimeError("An errored strategy is not performance evidence")
    index = {r["ts"]:i for i,r in enumerate(rows)}
    terminal = [t for t in result.trades if t.get("engine_generated") and t.get("forced_close")]
    regular = [t for t in result.trades if t not in terminal]
    fills_ok = all(index[int(t["ts"])] == index[int(t["signal_ts"])-interval]+1 and
                   math.isclose(float(t["ideal_price"]), rows[index[int(t["ts"])]]['open'],rel_tol=1e-10) for t in regular)
    if regular and not fills_ok: raise RuntimeError("Non-causal execution detected")
    # Never overwrite engine metrics. Separate conservative overlays deduct gas
    # and terminal close slippage, which the engine's terminal settlement omits.
    costs = defaultdict(float)
    for trade in result.trades: costs[int(trade["ts"])] += gas
    terminal_slip = sum(abs(float(t["notional"]))*slip/10000 for t in terminal)
    if result.equity_series: costs[result.equity_series[-1][0]] += terminal_slip
    net, spent = [], 0.0
    for ts, equity in result.equity_series:
        spent += costs.get(ts,0.0)
        net.append([ts, equity-spent])
    net_return = (net[-1][1]/10000-1)*100
    # 100% buy-and-hold starts at the same first executable next-bar open,
    # includes fee+slip on both legs and two assumed gas charges.
    entry = rows[warm+1]["open"]*(1+slip/10000)
    quantity = (10000-gas)/(entry*(1+fee/10000))
    benchmark_final = quantity*rows[-1]["close"]*(1-slip/10000)*(1-fee/10000)-gas
    output = {"candidate":spec,"source":raw["source"],"sourceType":raw["sourceType"], "timeframe":tf,"window":window,
        "startUtc":datetime.fromtimestamp(start,timezone.utc).isoformat(),"endExclusiveUtc":datetime.fromtimestamp(END,timezone.utc).isoformat(),
        "dataSha256":hashlib.sha256(dataset_path.read_bytes()).hexdigest(),"costMultiplier":multiplier,
        "engineModule":"nerya.skills.builtin.backtest.scripts.engine.run_backtest", "engineMetrics":metrics,
        "costs":{"feeBpsEachLeg":fee,"slippageBpsEachLeg":slip,"gasUsdPerFillAssumption":gas,
                 "totalGasOverlayUsd":len(result.trades)*gas,"terminalSlippageOverlayUsd":terminal_slip,
                 "overlayNotReinvested":True},
        "net":{"returnPct":net_return,"maxDrawdownPct":drawdown(net),"finalEquityUsd":net[-1][1],
               "benchmarkNetPct":(benchmark_final/10000-1)*100,"fillCount":len(result.trades),
               "closedTrades":metrics["total_trades"],"feesUsd":metrics["total_fees_usd"],
               "slippageUsd":metrics["total_slippage_usd"]+terminal_slip},
        "checks":{"nextBarFillsVerified":fills_ok,"closedCandlesOnly":True,"syntheticCandles":False,
                  "warmupBars":warm,"terminalSettlementCount":len(terminal)},
        "equityAfterCostOverlay":net,"engineEquity":result.equity_series,"engineBenchmark":result.benchmark_series,
        "trades":result.trades,"warnings":result.warnings,
        "limitations":["Retrospective research selection; not strict unseen holdout and not a guarantee.",
                       "Price proxy with assumed costs; NOT reconstructed LFJ historical liquidity or mainnet realized P&L.",
                       "No LLM-generated strategy or autonomous evolution is implied by this developer research.",
                       "Close-sampled drawdown is not a worst intrabar drawdown or enforced stop-loss bound."]}
    filename = f"runs/{source}-{spec['id']}-{window}-cost{multiplier}.json"
    dump(OUT / filename, output)
    summary = {"id":spec["id"],"title":spec["title"],"source":source,"window":window,"costMultiplier":multiplier,
               **output["net"],"file":filename,"nextBarFillsVerified":fills_ok}
    print(json.dumps(summary,ensure_ascii=False),flush=True)
    return summary


def main():
    if not (OUT / "PLAN.zh-CN.md").is_file(): raise RuntimeError("Missing fixed experiment plan")
    summaries = []
    for spec in CANDIDATES:
        for window in WINDOWS:
            summaries.append(evaluate(spec,"binance",window))
        summaries.append(evaluate(spec,"binance","half_year",2))
    eligible = []
    for spec in CANDIDATES:
        rows = [r for r in summaries if r['id']==spec['id']]
        half = next(r for r in rows if r['window']=='half_year' and r['costMultiplier']==1)
        gate = all(r['returnPct']>0 and r['fillCount']>=2 and r['nextBarFillsVerified'] for r in rows if r['window']!='year')
        if gate and half['maxDrawdownPct']<=25:
            eligible.append({**spec,"score":half['returnPct']/max(1,half['maxDrawdownPct'])})
    eligible.sort(key=lambda x:x['score'],reverse=True)
    # Reproduce all eligible candidates on an independent official oracle feed.
    cross_checks = []
    for spec in eligible:
        if (OUT / f"data/gmx-{spec['tf']}.json").is_file():
            for window in ("half_year","last_90d","last_60d"):
                cross_checks.append(evaluate(spec,"gmx",window))
    selected = next((s for s in eligible if len([r for r in cross_checks if r['id']==s['id']])==3 and
                     all(r['returnPct']>0 for r in cross_checks if r['id']==s['id'])),None)
    result = {"createdAt":datetime.now(timezone.utc).isoformat(),"selection":"finite retrospective research; full losing results retained",
              "planSha256":hashlib.sha256((OUT/'PLAN.zh-CN.md').read_bytes()).hexdigest(),
              "sourceCodeSha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "candidatesTested":len(CANDIDATES),"summaries":summaries,"crossFeedChecks":cross_checks,
              "eligible":eligible,"selected":selected,"liveTrading":False,"mainnetBroadcast":False}
    dump(OUT / "comparison.json",result)
    print("SELECTED",json.dumps(selected,ensure_ascii=False),flush=True)


if __name__ == "__main__": main()
