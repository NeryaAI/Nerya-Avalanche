# AVAX 日线突破（avax_breakout_zh）

## 规则（固定，不优化参数）

- 日线收盘后评估，只用已收盘K线：
  - 入场：`close > 不含当前日的前20日最高high` 且空仓 → 下一根开盘以85%净资产开 AVAX 现货多仓（entry_days=20，breakout_buffer_pct=0.0）。
  - 退出：`close < 不含当前日的前10日最低low` 且持有多仓 → 下一根开盘全平（exit_days=10）。
  - 其余：持有或空仓。
- sizing：`{method: pct_nav, pct_nav: 0.85}`（当前净资产的85%，非0.85%）。
- 按 market/timeframe 去重，每根已收盘K线只处理一次；不读未来数据。

## 执行目标与回测口径

- 目标市场：Avalanche 主网 LFJ 的原生 USDC/WAVAX 现货。Nerya 内置的 `avalanche_lfj_market` 可用于执行前的只读报价比较。
- 回测价格代理：`BINANCE:AVAXUSDT` 日线（1d），**不代表** LFJ 历史成交或实盘收益。
- 回测引擎与链上执行成本是两层口径：Avalanche gas、LFJ 动态费用、跨 bin 价格影响和 MEV 需要在真实执行前重新报价与评估，不能从中心化交易所历史 K 线中推导出来。
- 示例本身不会打开主网签名或交易权限；实盘执行仍需走 Nerya 正常的账户、风险与审批链路。

## 风险

- 趋势突破策略可能长期空仓，也可能只产生少量完整交易，低样本下统计意义有限。
- 突破信号对噪声敏感；回撤与成本（手续费+滑点）会显著影响结果。
- 任何后续修改必须创建新候选并以同口径复测。

## 回测设置（strategy.yml.backtest）

- 示例文件保留一个可复现的固定历史区间；实际使用时应重新选择研究区间并检查数据覆盖。
- 初始资金 10000 模拟美元，warmup_bars=90，手续费 30bps/边，滑点 10bps/边。
- max_drawdown_pct=25，不做空、不加杠杆，max_open_trades=1，allow_mock=false，engine=native。

## 复盘计划（暂停状态）

独立“脚本整理证据 → 智能体提出修订”流程，`tuning.enabled=false`，见 strategy.yml 的 `tuning.review_plan`。关注：低样本数、突破噪声、回撤与成本。
