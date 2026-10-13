---
name: avalanche_competition
description: Use the original Nerya Agent workspace for AVAX multi-agent research, natural-language strategy authoring, real backtests, attributable review and revision. Verify historical Fuji receipts through the native tool; never use normal trading accounts or mainnet.
---

# Nerya / Avalanche competition

Use only in the isolated competition workspace with `NERYA_COMPETITION=avalanche`.
Load this skill explicitly; it is not installed into the original workspace.

## Agent-first workflow

This is the original Agent, not a dashboard checklist or a deterministic demo.
Use the native tools and original rich output: `team_run`, market/research visuals,
strategy candidate + backtest tools, independent review workflow and workspace files.
Do not call the retired `/api/competition` proof dashboard or its local scripted
research/review endpoints. Never manufacture a chat reply, child-Agent result,
strategy change, backtest metric or task-completion status.

1. For an explicit Agent Team request load `team` and immediately use `team_run`.
   Prefer three bounded independent lanes (technical, ecosystem, risk). Preserve
   sources and each member's conclusion; distinguish observations from hypotheses.
   Keep the call compact. `roles` must be an actual array and EVERY element needs
   a nonempty `name`. Put an inline `prompt` on the role object, NOT inside payload.
   Do not serialize the array into a string or start a role with only instructions.
   A correct shape is `roles: [{name: "technical", prompt: "Read AVAX candles and
   explain trend."}, {name: "ecosystem", prompt: "Verify Avalanche and LFJ official
   docs."}, {name: "risk", prompt: "Assess long/flat failure conditions."}]`.
   Keep each prompt below 250 words, ask for short findings, then the leader saves
   one integrated report. Do not ask child agents to write the same file. When the
   user requests the selected model, set each role's provider/model to the current
   explicit selection. No unknown skill/tool names belong in `allowed_skills`.
   Avalanche documentation lives at build.avax.network and LFJ developer docs at
   developers.lfj.gg. LFJ is a DEX; never invent a "Lavage Foundation" expansion.
2. For natural-language strategy authoring load `strategy_author` and `backtest`.
   Use the original strategy candidate tools, original SDK and native backtest engine.
   Let those tools publish the original strategy cards and replay result cards.
   Markets used for historical CEX price data are NOT claims of LFJ backtest fills.
3. Save a separate paused strategy-aware review plan. When the user asks to review
   and revise, actually read the original replay evidence, make ONE attributable
   candidate revision and test it on identical data/costs. Show both versions and
   update the next review focus. A revision is not an improvement until measured.
4. Do not auto-promote or enable trading/schedules. A user-approved paper promotion
   may use the original promotion tool; keep live flags and owner risk authority.
5. Save meaningful research/review markdown to the native workspace and show them
   through its Files/Results tabs. The transcript, Agents tab and strategy workflow
   are the primary product surfaces; no alternate competition dashboard is needed.
   For new reports use the CURRENT conversation's artifacts directory, e.g.
   `artifacts/conversations/<session_id>/avax-research.md`. Do not set
   `allow_outside_conversation=true` or invent a global reports directory: the
   native workspace already exposes conversation files, without expanding scope.
   If an approved operation is resumed, keep its exact path/content/scope. Approval
   of one filename is not approval to invent another file or widen permissions.

## Current AVAX strategy and LFJ research

For this competition's 2026-10-07 selection, read `avalanche_strategy_research()`
and independently critique its fixed-candidate experiments. It is explicitly
developer research, not output authored by the current Agent. Its positive
candidate is the daily 20-day breakout / 10-day exit spot strategy with 85%
entry allocation, but only two round trips occurred in the 189-day window.
Do not claim zero losing trades, strict unseen out-of-sample, steady profits,
or that its price-proxy backtest reconstructs historical LFJ pool execution.

Use `avalanche_lfj_market()` to query live Avalanche mainnet USDC/WAVAX routing,
pool availability and size-dependent fees directly inside native chat. This
tool is public-read-only: no signer, approvals or broadcast. Chain 43114 is
allowed ONLY for public market reads; signing/execution remains testnet-only.
Bin step is price-bin spacing, NOT the swap fee. Never hardcode V2.1 when a
current official V2.2 market is the actually quoted route.

The demo may feature a genuinely positive research-selected candidate, while
keeping all losing experiments and losing fills in the evidence. Do not
globally hide negative metrics or turn weak performance into a tool failure.
Any self-evolution step must read the original candidate, make an attributable
change and re-test at the same costs/data. Do not promise that a revision wins.

## Historical Fuji proof — separate provenance

`avalanche_verify_receipt()` is a native read-only tool. It queries public Fuji RPC,
checks receipt status, sender/recipient, the Executed event, the owner signature
and allowance at the execution block. Its structured result renders as an inline
native evidence card. No key is opened and no transaction is submitted.

The recorded transaction belongs to an EARLIER strategy/evidence hash. It proves
the PolicyVault/LFJ execution mechanism, NOT that a newly created strategy traded.
Keep its `referenceExecution: true`, original hash and timestamp visible. Do not
assign its fills, profit or evidence hash to the new strategy's backtest or review.

## Opt-in execution boundary

1. Fetch actual public AVAX history and an Avalanche Fuji RPC snapshot. Record
   URLs, retrieval time, closed-bar coverage and content hashes. Refuse missing
   data; do not fabricate bars, news or whale signals.
2. Create a strategy package with a strategy ID/version and an independent review
   plan. `templates/avax_trend.py` is a reference, not evidence of model authorship.
3. Replay the strategy using Nerya's existing backtest engine. Fills must follow
   the signal bar. Distinguish completed execution from weak performance.
4. Bind a specific historical BUY intent to the execution rehearsal. If the
   current live signal is HOLD, do not pretend that the rehearsal is a live BUY.
5. Show the owner the EIP-712 policy: chain, verifying contract, delegated agent,
   exact tokens, LFJ route, maximum input-token spend, price floor and expiry.
   Require a real owner authorization before testnet execution. Never reuse
   production credentials or bypass existing Nerya approval/risk gates.
6. Contract execution is a *second* enforcement layer. Only Fuji 43113 is allowed
   for public-network broadcast. Local chain 31337 is explicitly a test fixture.
7. Preserve the full evidence bundle off-chain and the digest in the execution
   event. A matching digest proves integrity, not truth of research or profit.
8. Build a separate two-node review workflow: execution metrics script -> review
   agent. Attach the strategy ID/version, policy hash, transaction and replay.
   Schedule it after confirmed execution, with a daily fallback trigger. A new
   proposal must be re-tested; widening authority requires a new owner signature.

## Local helpers

- `npm run preflight` reads Fuji chain/deployment/quote data, never broadcasts.
- `python scripts/backtest.py --input <market.json> --output <report.json>` runs
  the existing Nerya engine. Inputs and outputs belong in this worktree.
- `npm test` runs offline contract/adapter tests, not live-chain validation.
- See `README.md` and `scripts/fuji.mjs` for opt-in testnet deployment.

## Claims and safety

Never label the local router fixture as LFJ or local receipts as Fuji receipts.
Never label a deterministic review draft as an executed LLM/subagent task.
The signed minimum exchange rate is not a live oracle; no on-chain drawdown
guarantee is claimed. Contracts are a testnet prototype, not audited custody.
