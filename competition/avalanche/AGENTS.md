# Avalanche competition boundary

This directory is a competition-only overlay. Do not merge it into main/gwdc
without an explicit later request. Do not edit or restart the original checkout.

- Run only with `NERYA_COMPETITION=avalanche`; bind loopback, never a public host.
- Keep state, dependency installs, logs and credentials in this worktree.
- The local EVM is a test fixture, NOT Fuji. Label it in every UI and recording.
- Real Fuji receipts must come from RPC with chain ID 43113 and receipt status 1.
- Mainnet transactions are not supported by this competition package.
- Never fabricate LLM runs, historical returns, transaction hashes or deployment.
- Reuse Nerya's backtest engine. Do not modify its Agent Loop for the competition.
- Keep renders outside product source, under the dedicated pitch-video directory.
