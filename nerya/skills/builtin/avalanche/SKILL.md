---
name: avalanche
description: "Avalanche C-Chain and LFJ market workflows: AVAX research, live USDC/WAVAX quote comparison, strategy context, and safe handoff to Nerya's normal financial gates."
version: 0.1.0
license: MIT
author: Nerya
---

# Avalanche

Use Avalanche as part of the normal Nerya research, strategy and trading
workflow. Do not create a separate workspace or alternate execution path.

## Market research and quotes

For current LFJ USDC/WAVAX liquidity or order-size questions, call
`avalanche_lfj_market`. Pass the requested USDC sizes when the user supplied
them; otherwise compare a small, medium and larger size. The result is a
read-only snapshot at one Avalanche C-Chain block.

Treat an LFJ quote as a quote, not a fill. Report the observed block and make
clear that dynamic fees, bin traversal and available liquidity can change
before execution. `binStep` describes price spacing; it is not the fee rate.
Never infer historical LFJ execution costs from a current quote.

## Strategies and backtests

Use the normal `strategy_author`, `backtest`, `research` and review/tuning
skills for AVAX strategies. A centralized-exchange AVAX candle series can be
used as an explicit price proxy for research, but it is not a reconstruction
of historical LFJ fills. Keep data source, fee/slippage assumptions and chain
execution costs separate in the result.

`examples/avalanche/avax_breakout_zh/` is one inspectable example of this
separation: signal/backtest logic stays in the standard strategy package while
LFJ market depth is queried independently before any execution decision.

## Execution

Do not treat this skill or `avalanche_lfj_market` as trading authorization.
Any action that can move funds must enter Nerya's existing `financial_ops`
workflow and its account, risk, approval and reconciliation rules. Refresh the
LFJ quote before preparing an action. Never load or request a private key in a
research turn, and never silently upgrade a read-only request into a swap.

