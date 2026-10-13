# Skill-shipped background music

These are the **default BGM tracks** for any project built through the `hackathonhunter` skill. They are AI-generated and rights-cleared. Projects should reference these tracks rather than generating their own — see `references/07-shipping.md`.

| Track | Mood | Role in a demo cut |
| ----- | ---- | ------------------ |
| `01_future_forward.mp3` | warm, soft synth pads, breathing tempo | Intro + outro bed |
| `02_innovation_drive.mp3` | rising arp, mid-tempo, momentum | Mid-demo (hand-off → PR reveal) |

## How to consume

Projects pick these up by setting `BGM_DIR` to this directory or by symlinking / copying into the project tree:

```bash
# Option A — env var (recommended for monorepo + worktree setups)
export BGM_DIR="$(pwd)/../hackathonhunter/assets/music"
node scripts/mix-final.mjs

# Option B — symlink into the project (clean, single source of truth)
ln -s ../../hackathonhunter/assets/music project/assets/music

# Option C — copy at clone time (safest for shipping the project repo to GitHub)
cp -r hackathonhunter/assets/music project/assets/music
```

`scripts/mix-final.mjs` already sorts the directory alphabetically and crossfades the first two tracks across the timeline. Drop in a third track if you need a calmer bed for the burnout-night moment.

## Default mix targets (matches `references/07-shipping.md`)

- BGM bus: −18 dB average, −12 dB peak
- Narration bus: −6 dB average
- Sidechain compress BGM by 4 dB whenever narration fires
- Tail fade-out: 1.5 s
- Final mean loudness: −15..−13 dB; peak: −2..0 dB

## Replacing the defaults

If a project wants project-specific music (e.g. a Web3 game vs a productivity tool), drop your own tracks into the same path and they automatically take precedence. **Do not generate synthesised white-noise beds.** That fallback exists in `scripts/mix-final.mjs` only for emergencies and must require explicit user OK (see pitfall P-34).
