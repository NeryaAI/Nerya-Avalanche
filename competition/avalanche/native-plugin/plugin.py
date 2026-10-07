"""Native read-only Avalanche research, DEX quotes and separately attributed Fuji proof."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

from nerya.harness import Plugin
from nerya.tools.types import PermissionScope, RiskLevel, ToolDescriptor, ToolResult, ToolError, ToolErrorKind


class AvalancheReceipts(Plugin):
    name = "avalanche_receipts"
    requires = ("paths",)

    def setup(self, ctx):
        paths = ctx.get_service("paths")
        root = Path(os.environ.get("NERYA_COMPETITION_ROOT", "")).resolve()
        expected = root / ".runtime" / "native-workspace"
        if os.environ.get("NERYA_COMPETITION") != "avalanche" or paths.root.resolve() != expected:
            raise RuntimeError("Fuji proof tool is restricted to the isolated native competition workspace")

        def verify(call):
            try:
                result = subprocess.run(["node", str(root / "scripts" / "verify-receipt.mjs")],
                                        cwd=root, capture_output=True, text=True, timeout=55,
                                        env={k: os.environ[k] for k in ("PATH", "HOME", "TMPDIR") if k in os.environ})
                if result.returncode:
                    raise RuntimeError("Public Fuji proof could not be verified; no transaction submitted")
                data = json.loads(result.stdout)
                return ToolResult.from_json(tool_use_id=call.id, name="avalanche_verify_receipt", data=data,
                                            semantic_success=data.get("status") == "verified")
            except Exception:
                return ToolResult.from_error(tool_use_id=call.id, name="avalanche_verify_receipt",
                    error=ToolError(kind=ToolErrorKind.EXECUTION_ERROR,
                                   message="Fuji verification unavailable. No new transaction or signing was attempted.", retryable=True))

        ctx.register_tool(ToolDescriptor(name="avalanche_verify_receipt",
            description="Verify the recorded Avalanche Fuji PolicyVault/LFJ testnet receipt using public RPC. Read-only; returns a native evidence card. This is an earlier reference execution, NOT an order from the current strategy. No signing or new trades.",
            input_schema={"type": "object", "properties": {}, "additionalProperties": False},
            handler=verify, risk=RiskLevel.READ, permission_scope=PermissionScope.NETWORK,
            read_only=True, is_concurrency_safe=True, tags=("avalanche", "evidence", "competition")))

        def research_report(call):
            name = "avalanche_strategy_research"
            try:
                folder = root / "research" / "2026-10-07"
                report = (folder / "研究报告.zh-CN.md").read_text()
                summary = json.loads((folder / "summary.json").read_text())
                if hashlib.sha256(report.encode()).hexdigest() != summary["reportSha256"]:
                    raise RuntimeError("Research content changed; regenerate evidence manifest before reading")
                # Keep decision-critical facts structured and short. A long text
                # report may be compacted to its head/tail before the next model
                # step, losing the actual breakout threshold and stress result.
                main, stress = summary["mainResult"], summary["doubleCostResult"]
                cross, annual = summary["crossSourceResult"], summary["annualResult"]
                data_file = folder / "data/binance-1d.json"
                selected_run = json.loads((folder / main["file"]).read_text())
                if hashlib.sha256(data_file.read_bytes()).hexdigest() != selected_run["dataSha256"]:
                    raise RuntimeError("Research candle digest changed")
                candles = json.loads(data_file.read_text())["candles"]
                close = candles[-1]["close"]
                high20 = max(row["high"] for row in candles[-21:-1])
                low10 = min(row["low"] for row in candles[-11:-1])
                markdown = ("## AVAX开发研究：日线20日突破、10日退出\n"
                    "研究截止2026-10-07 00:00 UTC；开发阶段重放，不是本次Agent新跑回测或LFJ实盘收益。\n\n"
                    f"固定189日净收益 **+{main['returnPct']:.2f}%**，收盘净值最大回撤 **{main['maxDrawdownPct']:.2f}%**；"
                    f"同口径买入持有 **+{main['benchmarkNetPct']:.2f}%**。\n"
                    f"成本翻倍 **+{stress['returnPct']:.2f}%**；GMX日线交叉复核 **+{cross['returnPct']:.2f}%**。\n"
                    f"全年 **+{annual['returnPct']:.2f}%**，全年回撤 **{annual['maxDrawdownPct']:.2f}%**。\n\n"
                    f"**最后完整日线收盘{close:.3f}，低于此前20日高点{high20:.3f}：新空仓没有突破买入信号。**"
                    f"此前10日低点{low10:.3f}。这是日线研究时点的判断，不是当前盘中预测。\n\n"
                    "189日仅2笔完整交易，其中1笔亏损；90日和60日是同一笔趋势，不是独立验证。"
                    "近90日策略+49.40%，买入持有+72.41%；近60日买入持有+77.68%。"
                    "原始引擎43.05%未计全部额外成本，不能当作最终42.92%的口径。"
                    "样本来自研究后选样，非严格未见样本；不保证未来收益。")
                return ToolResult.from_json(tool_use_id=call.id, name=name, data={
                    "kind":"avalanche_strategy_research", "summary":markdown,
                    "researchDate":"2026-10-07", "endExclusiveUtc":"2026-10-07T00:00:00Z",
                    "developerResearchNotModelAuthored":True, "liveProfitClaim":False,
                    "costAdjustedReturnPct":main["returnPct"], "maxCloseDrawdownPct":main["maxDrawdownPct"],
                    "doubleCostReturnPct":stress["returnPct"],"gmxCrossSourceReturnPct":cross["returnPct"],
                    "closedSignal":{"close":close,"prior20High":high20,"prior10Low":low10,
                                    "flatAccountNewBuySignal":close>high20,"existingLongExitSignal":close<low10},
                    "completedTrades":main["closedTrades"], "strictUnseenOutOfSample":False,
                    "fullReportPath":str(folder / "研究报告.zh-CN.md"), "fullReportSha256":summary["reportSha256"]
                }, semantic_success=True)
            except Exception:
                return ToolResult.from_error(tool_use_id=call.id, name=name,
                    error=ToolError(kind=ToolErrorKind.EXECUTION_ERROR,
                        message="本轮策略研究证据不可用或摘要不匹配；没有生成或改写收益。", retryable=False))

        def market_read(call):
            name = "avalanche_lfj_market"
            try:
                result = subprocess.run(["node", str(root / "scripts" / "research-lfj-mainnet.mjs"), "--no-save"],
                    cwd=root, capture_output=True, text=True, timeout=100,
                    env={k: os.environ[k] for k in ("PATH", "HOME", "TMPDIR") if k in os.environ})
                if result.returncode:
                    raise RuntimeError("LFJ mainnet public reads unavailable")
                data = json.loads(result.stdout)
                if (data.get("chainId") != 43114 or data.get("readOnly") is not True or
                    data.get("newTransactionSubmitted") is not False or data.get("signerLoaded") is not False):
                    raise RuntimeError("Invalid read-only market evidence boundary")
                lines = ["## Avalanche / LFJ 主网市场核验（只读）",
                    f"区块：{data['blockNumber']} · 区块时间：{data['blockTimestamp']}",
                    "只读取公共合约；没有打开钱包、授权代币或提交订单。这不是成交回执或盈利证明。",
                    "|输入 USDC|报价 WAVAX|手续费 USDC|报价路径|",
                    "|---:|---:|---:|---|"]
                for row in data["bestBySize"]:
                    if row.get("completelyFillable"):
                        lines.append(f"|{row['inputUsdc']:,.0f}|{row['outputWavax']:.6f}|{row['feeInputUsdc']:.6f}|{row['version']}|")
                    else:
                        lines.append(f"|{row['inputUsdc']}|流动性不足|—|不生成订单|")
                lines += [f"Router：`{data['router']}`", f"原生 USDC：`{data['nativeUsdc']}`",
                    f"WAVAX：`{data['wrappedAvax']}`", f"区块哈希：`{data['blockHash']}`",
                    "Bin step是价格档位间距，不是手续费；LFJ动态费与跨bin影响必须按每次报价检查。",
                    "当前报价不能替代历史池子成交模型；主网广播仍关闭。",
                    "来源：https://developers.lfj.gg/deployment-addresses/avalanche · https://developers.lfj.gg/concepts/fees"]
                return ToolResult.from_json(tool_use_id=call.id, name=name, data={
                    "kind":"avalanche_lfj_market_research", "summary":"\n".join(lines),
                    "chainId":43114,"readOnly":True,"newTransactionSubmitted":False,
                    "blockNumber":data["blockNumber"],"blockHash":data["blockHash"],
                    "observedAt":data["observedAt"],"quotes":data["bestBySize"]}, semantic_success=True)
            except Exception:
                return ToolResult.from_error(tool_use_id=call.id, name=name,
                    error=ToolError(kind=ToolErrorKind.EXECUTION_ERROR,
                        message="LFJ主网市场核验暂不可用；没有使用缓存冒充当前报价，也没有发送交易。", retryable=True))

        ctx.register_tool(ToolDescriptor(name="avalanche_strategy_research",
            description="读取2026-10-07开发阶段完成的真实AVAX策略筛选、成本压力测试和独立核算。只读，中文。它不是当前Agent自行生成或未见样本验证，不得改写为实盘利润；原生Agent可据此独立审查、创建策略与复盘。",
            input_schema={"type":"object","properties":{},"additionalProperties":False}, handler=research_report,
            risk=RiskLevel.READ, permission_scope=PermissionScope.WORKSPACE, read_only=True,
            is_concurrency_safe=True, tags=("avalanche","research","competition")))
        ctx.register_tool(ToolDescriptor(name="avalanche_lfj_market",
            description="从Avalanche主网公共RPC实时读取LFJ USDC/WAVAX池和100、1000、8500 USDC报价，校验chainId=43114与官方Token/Router。只读中文结果，不加载钱包、不签名、不approve、不下单；报价不等于成交或策略收益。",
            input_schema={"type":"object","properties":{},"additionalProperties":False}, handler=market_read,
            risk=RiskLevel.READ, permission_scope=PermissionScope.NETWORK, read_only=True,
            is_concurrency_safe=False, tags=("avalanche","dex","research","competition")))
        # All registrations are tracked and disposed by the native extension host.
        return None


PLUGIN = AvalancheReceipts()
