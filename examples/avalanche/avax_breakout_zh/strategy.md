# AVAX 日线突破（avax_breakout_zh）

## 规则（固定，不优化参数）

- 日线收盘后评估，只用已收盘K线：
  - 入场：`close > 不含当前日的前20日最高high` 且空仓 → 下一根开盘以85%净资产开 AVAX 现货多仓（entry_days=20，breakout_buffer_pct=0.0）。
  - 退出：`close < 不含当前日的前10日最低low` 且持有多仓 → 下一根开盘全平（exit_days=10）。
  - 其余：持有或空仓。
- sizing：`{method: pct_nav, pct_nav: 0.85}`（当前净资产的85%，非0.85%）。
- 按 market/timeframe 去重，每根已收盘K线只处理一次；不读未来数据。

## 执行目标与回测口径

- 实盘执行目标：Avalanche 主网 LFJ 的原生 USDC/WAVAX 现货。
- 回测价格代理：`BINANCE:AVAXUSDT` 日线（1d），**不代表** LFJ 历史成交或实盘收益。
- 原生引擎未计入：Avalanche 主网 gas、期末滑点等额外成本。旧研发（2026-10-07）同规则完整成本口径结果为 **+42.92%**；本次以新回测回执为准。

## 研发输入归属

本候选的规则与参数来自 2026-10-07 已完成的 avalanche_strategy_research 研发复核资料（开发阶段重放：全成本 +42.92%、收盘净值最大回撤 10.33%、189日仅2笔完整交易、GMX交叉复核 +42.68%），属于**已有研发输入**，不是本次新建的全新研究。

## 风险

- 样本极低（历史仅2笔完整交易，其中1笔亏损），统计意义有限。
- 突破信号对噪声敏感；回撤与成本（手续费+滑点）会显著影响结果。
- 任何后续修改必须创建新候选并以同口径复测。

## 回测设置（strategy.yml.backtest）

- 区间：2026-04-01（含）至 2026-10-07（不含）UTC，严格完整覆盖。
- 初始资金 10000 模拟美元，warmup_bars=90，手续费 30bps/边，滑点 10bps/边。
- max_drawdown_pct=25，不做空、不加杠杆，max_open_trades=1，allow_mock=false，engine=native。

## 复盘计划（暂停状态）

独立“脚本整理证据 → 智能体提出修订”流程，`tuning.enabled=false`，见 strategy.yml 的 `tuning.review_plan`。关注：低样本数、突破噪声、回撤与成本。
