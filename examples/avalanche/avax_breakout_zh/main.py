# @nerya.version 1
# @nerya.title AVAX 日线突破
# @nerya.description 日线收盘后判断突破/跌破信号，下一根开盘按85%净资产开多或全平（由原生回测引擎按下一开盘成交假设执行）。
# @nerya.logic 只使用已收盘日线K线：close > 不含当前日的前20日最高high 且空仓 -> 开多；close < 不含当前日的前10日最低low 且持有多仓 -> 全平；其余持有或空仓。
# @nerya.rationale 复用既有2026-10-07研发复核输入的固定规则（20日突破/10日退出），本候选不优化任何参数。
# @nerya.scope 仅配置市场 BINANCE:AVAXUSDT 与1d周期；不修改任何账户或全局配置。
# @nerya.input 已收盘历史或实时K线（ctx.market.candles）、strategy.yml 声明参数（ctx.config.params）、已结算持仓（ctx.portfolio）。
# @nerya.output 入场/平仓订单提交回执，或显式 hold/错误结果。
# @nerya.risk 历史OHLC与下一开盘成交假设不保证实盘可执行或盈利；回测价格代理（币安）不代表 Avalanche 主网 LFJ 历史成交或实盘收益；LFJ 执行的 gas 与额外滑点未计入原生引擎结果。
# @nerya.validation 保存本源码并按 strategy.yml.backtest 固定区间（2026-04-01含 至 2026-10-07不含 UTC）执行一次原生历史回测。
# @nerya.step execute | Execute strategy | 逐市场处理已收盘日线，按突破/跌破信号提交入场或平仓。

from nerya.strategies import StrategyContext, StrategyResult


def run(ctx: StrategyContext) -> StrategyResult:
    """AVAX 日线突破：规则固定，不做参数优化。

    - entry_days=20：close > 不含当前日的前20日最高high -> 空仓时开多
    - exit_days=10：close < 不含当前日的前10日最低low -> 持多时全平
    - breakout_buffer_pct=0.0：突破缓冲为零，严格大于前高
    - sizing={method: pct_nav, pct_nav: 0.85}：按当前净资产85%开仓
    """
    params = ctx.config.params  # 实际读取 strategy.yml 参数
    timeframe = ctx.config.timeframe
    entry_days = int(params["entry_days"])
    exit_days = int(params["exit_days"])
    buffer_pct = float(params.get("breakout_buffer_pct", 0.0))
    sizing = params["sizing"]

    # 按 market/timeframe 去重，只处理每根已收盘K线一次
    trigger_market = ctx.trigger.get("market")
    markets = (trigger_market,) if trigger_market else tuple(ctx.config.markets)

    now_ms = ctx.clock.now_ms()
    state = ctx.state

    for market in markets:
        bars = ctx.market.candles(market, timeframe=timeframe, limit=max(entry_days, exit_days) + 5)
        if not bars:
            return ctx.result.error(message=f"{market}: 无法读取已收盘K线", kind="data_error")

        # 只保留已收盘K线（close_time_ms 为收盘边界），绝不使用未来数据
        closed = [b for b in bars if int(b.get("close_time_ms", 0)) <= now_ms]
        if len(closed) < max(entry_days, exit_days) + 1:
            state.set(f"last_bar:{market}:{timeframe}", int(closed[-1]["ts"]) if closed else 0)
            continue  # 预热期数据不足：持有或空仓，不出信号

        last = closed[-1]
        last_ts = int(last["ts"])
        dedupe_key = f"last_bar:{market}:{timeframe}"
        if int(state.get(dedupe_key, 0)) == last_ts:
            continue  # 同一根K线已处理，去重

        close = float(last["close"])
        # 不含当前日：窗口排除最后一根（当前）K线
        prior = closed[:-1]
        prior_entry_high = max(float(b["high"]) for b in prior[-entry_days:])
        prior_exit_low = min(float(b["low"]) for b in prior[-exit_days:])

        position = None
        positions = ctx.portfolio.positions(market)
        for row in positions:
            if float(row.get("qty", row.get("size", 0.0) or 0.0)) != 0.0:
                position = row
                break

        if position is None and close > prior_entry_high * (1.0 + buffer_pct):
            # 空仓且突破前20日高点（不含当前日）：下一根开盘按85%净资产开多
            ctx.trading.open_position(
                market=market,
                side="long",
                sizing=sizing,
                confidence=0.8,
                reasoning_ref=(
                    f"close {close} > 前{entry_days}日最高high {prior_entry_high}"
                    f"（不含当前日，buffer={buffer_pct}）"
                ),
            )
        elif position is not None and close < prior_exit_low:
            # 持多且跌破前10日最低low（不含当前日）：下一根开盘全平
            ctx.trading.close_position(
                market=market,
                side="long",
                confidence=0.8,
                reasoning_ref=(
                    f"close {close} < 前{exit_days}日最低low {prior_exit_low}（不含当前日）"
                ),
            )
        # 其余情况：持有或空仓，不动作

        state.set(dedupe_key, last_ts)

    return ctx.result.hold()
