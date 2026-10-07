# Nerya · Avalanche 原生智能体比赛版

这是 `NeryaAI/Nerya` 的独立比赛代码快照，默认分支 `competition/avalanche-2026`。
保留原来的中文 Agent 对话、协作成员、策略与回测卡片、行情成交和独立复盘工作区；不以第二套比赛 Dashboard 代替产品。

## 仓库范围

仅包含应用代码、测试、必要的构建配置、原生 UI 资源、文档和策略示例。
不包含录屏、PPT、旁白、研究数据、回测结果、对话、模型密钥、钱包、控制 token 或运行目录。
这不是旧分支的 Git 历史镜像；创建新历史，避免把历史媒体或本机状态带入仓库。

## 本地安装与隔离启动

使用 Node 22–26、Python 3.12 和 uv，从本仓库根目录执行：

```bash
npm ci
npm --prefix competition/avalanche ci
uv venv --python 3.12 .venv-competition
uv pip install --python .venv-competition/bin/python -e '.[dev,trading]'
npx playwright install chromium
.venv-competition/bin/python competition/avalanche/scripts/start.py --model-source /absolute/path/to/your/configured/nerya-workspace
```

模型来源工作区需要已有可用的模型配置。启动器仅选择模型资料，凭证在内存中解析；不复制原工作区的账户、聊天、定时任务或交易钱包。
不要将模型来源路径写成其他人的本机目录，也不要将密钥提交到 Git。
原生入口 `http://127.0.0.1:18480/chat`，API `18417`。正常产品的 `18317/18380` 不被该启动器停止。
首次运行是空的隔离工作区，不会预填演示里的聊天或收益结果。

## 策略与验证

`examples/avalanche/avax_breakout_zh/` 是原生智能体实际创建的日线突破候选源码：前20日高点突破入场、前10日低点跌破退出、85%净值入场，不做空、不加杠杆。
示例是未发布的模拟策略，不保证收益。交易信号只读取当时已收盘的历史前缀，回测使用下一开盘成交。
回测需要本地重新取得数据并执行，不能把历史研究值当成新运行结果；CEX价格代理也不是LFJ池子的历史成交模型。

```bash
.venv-competition/bin/python -m pytest -m '' -q competition/avalanche/tests_native
.venv-competition/bin/python -m pytest -m '' -q examples/avalanche/avax_breakout_zh/tests
npm --prefix competition/avalanche test
(cd dashboard && ./node_modules/.bin/tsc --noEmit --incremental false)
```

`research-market.py`、`research-backtests.py`、`research-lfj-mainnet.mjs`、`verify-research.py` 和 `build-research-report.py` 保留复现实验代码；运行生成的数据位于已忽略的 research 目录，不随本仓库发布。
`avalanche_strategy_research` 在缺少本地已核对研究文件时明确返回不可用，不虚构结果。
`avalanche_verify_receipt` 同样需要本地提供独立生成的真实历史证明文件；本仓库不预装任何用户的历史交易档案。

## 执行边界

默认仅模拟交易，主网广播关闭；LFJ主网研究工具只读。Fuji是测试网，不是主网利润证明。
策略候选保存不等于发布，复盘计划不等于复盘已执行，生成修订不等于已采用。
在本轮录制时，第二版修订仍待安全复核，不能据此宣称已完成自进化闭环。
合约原型未经安全审计，不用于真实资金托管。

## 来源与许可

保留上游 LICENSE。上游项目：NeryaAI/Nerya；本代码取自比赛分支的工作树快照。
视频、MiMo旁白、中文PPT和验证材料单独交付，不放入代码仓库。
