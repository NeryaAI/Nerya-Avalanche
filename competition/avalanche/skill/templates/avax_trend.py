"""Competition reference strategy; deterministic and explicit, not LLM-authored.

@step observe: Read only candles closed by the current replay timestamp.
@step signal: A 10/30-day moving-average regime determines long or cash.
@step allocate: Target 85% NAV; reserve 15% for costs and operational liquidity.
@step execute: Use Nerya's trading SDK surface; the replay fills next-bar opens.
@step review: After execution, build a separate review plan; no auto-promotion.
"""

def run(ctx):
    market = ctx.market_name
    bars = ctx.market.candles(market, timeframe="1d", limit=31)
    if len(bars) < 30:
        return {"status": "hold", "reason": "indicator_warmup"}
    closes = [float(row["close"]) for row in bars]
    fast = sum(closes[-10:]) / 10
    slow = sum(closes[-30:]) / 30
    position = ctx.portfolio.position(market)
    risk_on = fast > slow and closes[-1] > slow
    if risk_on and position is None:
        ctx.trading.open_position(
            market=market, side="long", sizing={"method": "pct_nav", "pct_nav": 0.85},
            reasoning_ref="10/30-day trend regime: long with 15% reserve",
        )
        return {"status": "ok", "reason": "trend_entry"}
    if not risk_on and position is not None:
        ctx.trading.close_position(market=market, side="long", reasoning_ref="Trend regime invalidated")
        return {"status": "ok", "reason": "trend_exit"}
    return {"status": "hold", "reason": "regime_unchanged"}
