"""Render Chinese research findings from the actual persisted experiment records."""
from __future__ import annotations
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "research" / "2026-10-07"


def main():
    comparison = json.loads((OUT / "comparison.json").read_text())
    chain = json.loads((OUT / "lfj-mainnet.json").read_text())
    check = json.loads((OUT / "independent-verification.json").read_text())
    if check["status"] != "passed" or comparison["selected"]["id"] != "daily_breakout":
        raise RuntimeError("Do not publish a prewritten winning claim without matching verified evidence")
    rows = comparison["summaries"]
    def metric(candidate, window="half_year", multiplier=1):
        return next(r for r in rows if r["id"] == candidate and r["window"] == window and r["costMultiplier"] == multiplier)
    selected = metric("daily_breakout")
    half = json.loads((OUT / selected["file"]).read_text())
    year = metric("daily_breakout", "year")
    last90 = metric("daily_breakout", "last_90d")
    last60 = metric("daily_breakout", "last_60d")
    stress = metric("daily_breakout", multiplier=2)
    cross = next(r for r in comparison["crossFeedChecks"] if r["id"] == "daily_breakout" and r["window"] == "half_year")
    bars = json.loads((OUT / "data/binance-1d.json").read_text())["candles"]
    latest = bars[-1]
    movement = {str(d): (latest["close"] / bars[-d-1]["close"] - 1)*100 for d in (7,14,30,60,90,365)}
    main_rows = []
    for candidate in ("daily_breakout","daily_slow_trend","core_trend","dip_in_uptrend"):
        row, stressed = metric(candidate), metric(candidate,multiplier=2)
        main_rows.append(f"|{row['title']}|+{row['returnPct']:.2f}%|{row['maxDrawdownPct']:.2f}%|{row['fillCount']}|+{stressed['returnPct']:.2f}%|")
    main = f"""# AVAX 原生 Agent Demo：真实盈利候选与链上交易研究

研究日期：2026-10-07。历史数据截止 2026-10-07 00:00 UTC（不含当日未收盘数据）。
这是一轮开发阶段的真实策略筛选，不是主网实盘收益、投资收益承诺，亦不是伪造的 Agent 自主研究。

## 结论

主演示采用 **AVAX 日线20日突破、10日退出** 作为待由原生智能体创建和复核的策略候选；执行场所优先 LFJ 的 Avalanche 现货 USDC/WAVAX 市场。
不继续以旧的4小时均线频繁切换策略作为主展示，也不通过截去亏损区间、降低费用或加杠杆修饰收益。

固定区间 **2026-04-01 至 2026-10-07，189日**：扣除既定手续费、滑点和额外gas假设后，净收益 **+{selected['returnPct']:.2f}%**；收盘净值最大回撤 **{selected['maxDrawdownPct']:.2f}%**；模拟净值 **10,000 → {selected['finalEquityUsd']:,.2f}**。同口径首次可执行开盘买入、持有至期末并扣双边成本的基准为 **+{selected['benchmarkNetPct']:.2f}%**。

## 近期市场背景

最后一个完整日线为2026-10-06，收盘 **{latest['close']:.3f} USDT**。这不是当前盘中价格。
同源收盘到收盘变化：近7日 **{movement['7']:+.2f}%**、近30日 **{movement['30']:+.2f}%**、近60日 **{movement['60']:+.2f}%**、近90日 **{movement['90']:+.2f}%**、近365日 **{movement['365']:+.2f}%**。
近期显著反弹与更长时期回撤并存；本轮较好的结果来自减少无效换手并捕捉趋势，不是“任何时候买入都赚钱”。

## 固定五类候选中的正收益方案

全部候选在收益比较前写入 PLAN.zh-CN.md；本轮执行25个成本/区间组合及9个GMX日线交叉重放，完整落选记录留在附录。

|候选|189日净收益|收盘净值最大回撤|成交次数（含期末结算）|成本翻倍后净收益|
|---|---:|---:|---:|---:|
{chr(10).join(main_rows)}

## 主候选规则

每日日线收盘后，仅使用此前已知数据。如果收盘价突破**不含当前日的前20日最高价**，下一根K线开盘以85%净资产做多AVAX；如果收盘价跌破**不含当前日的前10日最低价**，下一根开盘退出。其余时间持有或空仓；不加杠杆、不做空、不用马丁加仓。85%是入场配置，不是持续自动再平衡后的恒定敞口。

截至最后完整日线，前20日高点 **{max(r['high'] for r in bars[-21:-1]):.3f}**，前10日低点 **{min(r['low'] for r in bars[-11:-1]):.3f}**。新建空仓账户尚无新突破入场信号；已有历史多仓按规则继续检查退出条件。不能为了录制而把HOLD伪装成BUY。

## 稳健性复核

|检验|净收益|收盘净值最大回撤|说明|
|---|---:|---:|---|
|189日主区间|+{selected['returnPct']:.2f}%|{selected['maxDrawdownPct']:.2f}%|真实价格代理＋成本假设|
|189日成本翻倍|+{stress['returnPct']:.2f}%|{stress['maxDrawdownPct']:.2f}%|费用60bps、滑点20bps每边|
|GMX Avalanche日线复核|+{cross['returnPct']:.2f}%|{cross['maxDrawdownPct']:.2f}%|另一官方价格源，不是GMX成交收益|
|过去365日|+{year['returnPct']:.2f}%|{year['maxDrawdownPct']:.2f}%|全年回撤超过25%，须完整披露|
|过去90日|+{last90['returnPct']:.2f}%|{last90['maxDrawdownPct']:.2f}%|同期买入持有净收益+{last90['benchmarkNetPct']:.2f}%|
|过去60日|+{last60['returnPct']:.2f}%|{last60['maxDrawdownPct']:.2f}%|与90日捕捉的是同一笔趋势，不是独立样本|

没有将最后60日称为严格未见样本：此前已经观察过此时期部分数据与旧策略表现，本次也根据已知收益选择了候选。换数据源能发现数据/实现差异，不能消除策略选择偏差。
189日只有2笔完整交易，其中一笔亏损、另一笔在期末持仓结算后贡献主要收益。交易样本很少，不能推断稳定胜率或稳定盈利。365日收盘最大回撤为{year['maxDrawdownPct']:.2f}%，而非“全年回撤不超过25%”。

## 成本、因果顺序与独立核算

主结果使用每边30bps手续费、10bps滑点，另假设每次成交0.10美元gas。189日手续费为{selected['feesUsd']:.2f}、滑点成本为{selected['slippageUsd']:.2f}、gas合计0.40，均为模拟美元。
原生引擎回测净收益为{half['engineMetrics']['total_return_pct']:.5f}%；另扣gas及期末强制结算原本未计的滑点后，报告使用更保守的{selected['returnPct']:.5f}%。不修改原生引擎的原始指标。
gas和期末额外滑点通过单独成本层从净值中扣除，没有参与后续仓位复投；这是已披露的近似，而不是历史gas逐笔重建。美元本位模型亦未单独重建USDC/USDT汇率偏离。

已经验证所有普通成交在信号的下一根开盘，预热不计收益、不读取未来K线。期末强制结算明确标记为引擎记账，不伪装成策略退出信号。独立现金/数量模拟器对8组主候选结果逐笔成交和全部净值点核对，全部一致；这不是合约审计或未来收益证明。

## LFJ 主网只读市场证据

本轮实际查询 Avalanche 主网 **chainId={chain['chainId']}**，区块 **{chain['blockNumber']}**，区块时间 **{chain['blockTimestamp']}**。查询中没有加载签名者、私钥，没有approve，也没有广播主网交易。
检查了{len(chain['pools'])}个LFJ V2.1/V2.2 USDC/WAVAX池；在查询区块三个规模的最佳报价均来自 **LFJ V2.2**。

|输入USDC|报价输出WAVAX|报价中的手续费USDC|相对活动bin价格的总报价损耗|
|---:|---:|---:|---:|
"""
    for q in chain["bestBySize"]:
        main += f"|{q['inputUsdc']:,}|{q['outputWavax']:.6f}|{q['feeInputUsdc']:.6f}|{q['priceLossVsActiveBinBps']:.2f}bps|\n"
    main += f"""
报价池：`{chain['bestBySize'][0]['pair']}`。按活动bin价格估算的池内资产总值约 **{chain['bestBySize'][0]['estimatedPoolValueUsdc']:,.0f} USDC**；它不是保证可立即成交的深度。
原生USDC：`{chain['nativeUsdc']}`；WAVAX：`{chain['wrappedAvax']}`；Router：`{chain['router']}`。

**Bin step是价格档位间距，不是手续费率。** LFJ有基础费与可变费，跨bin也可能改变平均成交价；这里8500 USDC报价的总损耗约25bps，不能据此假设全年一直如此。
当前报价只验证指定区块的流动性和费用，不能证明历史策略在LFJ每一笔都能按回测价成交。历史净收益仍是价格代理重放；真钱交易前需要逐单刷新报价、模拟、限价与授权校验。

## 为什么本次不靠GMX杠杆或LP年化包装利润

GMX已经作为Avalanche官方价格源参与交叉核算，主市场快照亦已保存。GMX头寸要计开平仓费、资金费、借款费、价格影响及执行成本；一个当前funding快照不足以证明“现货＋空永续”历史净收益为正。4小时Oracle历史存在缺口，本轮拒绝补造。
LP手续费收入与LP净收益不是一回事；必须包括持币价格变化、无常损失、区间外闲置和重新配置成本。未取得这些历史证据前，不用LP APY当作策略收益。

## 原生中文 Agent 的演示方向

用一句自然语言提出AVAX现货目标→原生多Agent分别研究趋势、DEX执行与风险→生成可检查的策略候选→原生回测卡和工作区展示真实净值/交易→独立复盘Agent提出一项有理由的修订→同数据同费用重测→仅在确有改善时采用，变差则保留原版本。
本研究提供的是开发阶段筛选证据；仍需真正由原生Agent创建/复核候选，不能把这里的Python研究脚本说成已完成的Agent自进化。旧亏损候选保存在研发附录，不作为主演示策略；不隐藏入选策略内部的亏损交易。
Fuji历史回执始终是独立执行机制证明，不能挪用为新策略的订单或盈利。展示页、旁白、字幕、PPT继续中文，原生工作区不改成另一个Dashboard；PPT制作仍使用PPT Master。

## 复现与来源

在比赛worktree中运行：
```bash
.venv-competition/bin/python competition/avalanche/scripts/research-market.py
.venv-competition/bin/python competition/avalanche/scripts/research-backtests.py
.venv-competition/bin/python competition/avalanche/scripts/verify-research.py
node competition/avalanche/scripts/research-lfj-mainnet.mjs
```
数据清单、各次实验、校验文件保留请求URL、时间及SHA-256。可变在线数据不保证未来重下的字节完全一致；精确复现应使用本轮封存文件。

1. Binance K线官方接口：https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints
2. GMX Oracle OHLC格式：https://docs.gmx.io/docs/api/rest-api/oracle-prices/
3. GMX官方备用入口：https://docs.gmx.io/docs/api/rest-api/fallback-urls/
4. LFJ Avalanche官方部署：https://developers.lfj.gg/deployment-addresses/avalanche
5. LFJ动态费用：https://developers.lfj.gg/concepts/fees
6. Circle原生USDC地址：https://developers.circle.com/stablecoins/usdc-contract-addresses
7. GMX费用：https://docs.gmx.io/docs/trading/fees/
8. LFJ流动性管理：https://docs.lfj.gg/liquidity-book-resources/liquidity-book-guides/deploying-_managing_and_rebalancing_liquidity_6792387

附录 `comparison.json` 保留全部5类候选和34次实验，没有删除落选负收益结果。仓库原有代码、账户、主网资金及正常服务不在本轮研究写入范围内。
"""
    (OUT / "研究报告.zh-CN.md").write_text(main)
    summary = {"kind":"avalanche_strategy_research","status":"verified_research","researchDate":"2026-10-07",
               "developerResearchNotModelAuthored":True,"liveProfitClaim":False,"selected":comparison["selected"],
               "mainResult":selected,"crossSourceResult":cross,"annualResult":year,
               "last90Result":last90,"doubleCostResult":stress,"independentChecks":len(check["checks"]),
               "dailyMarketMovesPct":movement,"reportSha256":hashlib.sha256(main.encode()).hexdigest(),
               "report":"研究报告.zh-CN.md","sourceManifest":"data-manifest.json",
               "limitations":["Retrospective selection, not strict unseen out-of-sample.","Only two completed trades in the 189-day window.",
                 "Daily close drawdown, not worst intrabar loss.","CEX/Oracle price replay, not LFJ realized profit.",
                 "Newly flat strategy has no latest closed-candle breakout signal."]}
    (OUT / "summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"report":"研究报告.zh-CN.md","bytes":len(main.encode()),"summary":summary},ensure_ascii=False))


if __name__ == "__main__": main()
