import pytest


class _Bar(dict):
    pass


def _mk_bar(ts, o, h, l, c):
    # ts 为秒；close_time_ms 为该日线收盘边界（毫秒）
    return {
        "ts": ts,
        "open": o,
        "high": h,
        "low": l,
        "close": c,
        "close_time_ms": (ts + 86400) * 1000,
    }


def _mk_ctx(closed_bars, position_qty=0.0):
    """构造最小 StrategyContext 替身，验证入场/持有/退出/去重路径。"""
    calls = {"open": [], "close": [], "state": {}, "hold": 0}

    class _State:
        def get(self, k, d=None):
            return calls["state"].get(k, d)

        def set(self, k, v):
            calls["state"][k] = v

    class _Trading:
        def open_position(self, **kw):
            calls["open"].append(kw)

        def close_position(self, **kw):
            calls["close"].append(kw)

    class _Portfolio:
        def positions(self, market):
            if position_qty:
                return [{"qty": position_qty, "avg_price": 10.0}]
            return []

    class _Result:
        def hold(self):
            calls["hold"] += 1
            return object()

        def error(self, message=None, kind=None):
            raise AssertionError(message)

    class _Ctx:
        pass

    last_ts = closed_bars[-1]["ts"]
    ctx = _Ctx()
    ctx.config = type(
        "C",
        (),
        {
            "params": {
                "entry_days": 20,
                "exit_days": 10,
                "breakout_buffer_pct": 0.0,
                "sizing": {"method": "pct_nav", "pct_nav": 0.85},
            },
            "timeframe": "1d",
            "markets": ["BINANCE:AVAXUSDT"],
        },
    )()
    ctx.trigger = {"market": "BINANCE:AVAXUSDT"}
    ctx.clock = type("K", (), {"now_ms": staticmethod(lambda: (last_ts + 86400) * 1000)})()
    ctx.state = _State()
    ctx.market = type(
        "M",
        (),
        {"candles": staticmethod(lambda m, timeframe=None, limit=None: list(closed_bars))},
    )()
    ctx.portfolio = _Portfolio()
    ctx.trading = _Trading()
    ctx.result = _Result()
    return ctx, calls


def _flat_series(n, price):
    # n+1 根平稳K线：最后一根单独设置收盘价即可构造信号
    return [_mk_bar(1700000000 + i * 86400, price, price, price, price) for i in range(n + 1)]


def _import_run():
    import importlib.util
    import pathlib

    pkg = pathlib.Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location("avax_breakout_zh_main", pkg / "main.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_entry_signal_on_breakout():
    """空仓 + close 突破不含当前日的前20日最高high -> 提交开多，sizing=85%净资产。"""
    bars = _flat_series(20, 10.0)
    bars[-1]["close"] = 11.0  # 突破前20日高点10.0
    ctx, calls = _mk_ctx(bars, position_qty=0.0)
    _import_run().run(ctx)
    assert len(calls["open"]) == 1
    assert calls["open"][0]["sizing"] == {"method": "pct_nav", "pct_nav": 0.85}
    assert calls["close"] == []


def test_hold_when_flat_no_signal():
    """空仓 + 未突破 -> 不开仓（持有/空仓）。"""
    bars = _flat_series(20, 10.0)
    bars[-1]["close"] = 10.5  # 未超过前高10.0以上区间高点即为10.0，10.5>10.0会突破，改用不突破场景
    bars2 = _flat_series(20, 10.0)
    bars2[-1]["close"] = 10.0  # 等于前高，buffer=0 需严格大于 -> 不入场
    ctx, calls = _mk_ctx(bars2, position_qty=0.0)
    _import_run().run(ctx)
    assert calls["open"] == [] and calls["close"] == []


def test_exit_signal_on_breakdown():
    """持多 + close 跌破不含当前日的前10日最低low -> 提交全平。"""
    bars = _flat_series(20, 10.0)
    bars[-1]["close"] = 9.0  # 跌破前10日低点10.0
    ctx, calls = _mk_ctx(bars, position_qty=5.0)
    _import_run().run(ctx)
    assert len(calls["close"]) == 1
    assert calls["open"] == []


def test_hold_when_long_no_exit():
    """持多 + 未跌破 -> 持有，不平仓。"""
    bars = _flat_series(20, 10.0)
    bars[-1]["close"] = 10.2  # 高于前低，继续持有
    ctx, calls = _mk_ctx(bars, position_qty=5.0)
    _import_run().run(ctx)
    assert calls["close"] == [] and calls["open"] == []


def test_dedupe_same_bar_processed_once():
    """同一根已收盘K线重复触发 -> 去重，不重复下单。"""
    bars = _flat_series(20, 10.0)
    bars[-1]["close"] = 11.0
    ctx, calls = _mk_ctx(bars, position_qty=0.0)
    mod = _import_run()
    mod.run(ctx)
    mod.run(ctx)  # 第二次同K线：应被 state 去重
    assert len(calls["open"]) == 1


def test_entry_window_excludes_current_bar():
    """不含当前日：当前K线自身创新高不应单独构成突破（窗口排除最后一根）。"""
    bars = _flat_series(20, 10.0)
    # 前20根高点10.0；当前根 high=11 但 close=10.5 > 前高10.0 仍应入场（以close判断）
    bars[-1]["high"] = 11.0
    bars[-1]["close"] = 10.5
    ctx, calls = _mk_ctx(bars, position_qty=0.0)
    _import_run().run(ctx)
    assert len(calls["open"]) == 1  # close 10.5 > 前20日高10.0（窗口不含当前根的high=11）
