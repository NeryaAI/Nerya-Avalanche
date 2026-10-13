# Avalanche 原生智能体隔离包装

请使用仓库根目录 [中文指南](../../README.md) 安装与启动。主要入口为 `scripts/start.py`，不是旧版演示服务器 `server.mjs`。

默认仅 loopback，API 18417、UI 18480；工作区状态位于本目录 `.runtime/`，不进入 Git。需要明确选定、已配置真实模型的本地工作区，不读取或复制交易账户与钱包。

`artifacts/fuji/` 仅含公开链上历史参考回执，时间为 2026-10-06。这些不是本次新策略的成交。`scripts/verify-receipt.mjs` 是只读验证，不打开钱包或发送交易。其他 Fuji 执行脚本仅供明确授权的 testnet 实验，本次发布未运行。

LP 观察策略、纸面历史回放、local EVM 夹具、Fuji 历史参考与 mainnet 实盘必须分开表述。当前 demo 的策略调度与真实交易均未开启。
