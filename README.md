# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/josecasasgomez7-dot/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/josecasasgomez7-dot/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar ranks 198 pre-token protocols by implied value — TVL, seven-day growth and age with no token — and gives each one an eight-step farm plan with costs and times. The board covers all 40 watchlist protocols and adds every other pre-token protocol the watchlist rule would keep; the 24 largest live-token protocols are set aside with their market caps.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

`snapshot.json` is the sealed snapshot from the competition kit (`input/snapshot.json`). The program writes `board.json`, `data.js`, `dashboard/` and `screenshots/` into `out/`, plus `out/dossier.json`. Run it twice: both runs write the same bytes.

## Model (radar-2)

```
implied = round( tvl_usd x 0.30 x (1 + clamp(change_7d, -50, +60) / 100) ^ 3
                 x (0.45 + 0.55 x age_days / (age_days + 365)) )
```

- **TVL** sets the size: thirty cents of implied token value per dollar locked.
- **Seven-day growth** is compounded for three weeks at the observed weekly rate, so a protocol growing 10% a week is worth far more than one shrinking 10% a week.
- **Age** is the time since first listing, the best record of how long a protocol has run with no token; the curve saturates, so age alone can never outrank size.
- No protocol name is special-cased. Wrapped, staked and bridged products of tokens that already trade are excluded from the early radar, exactly as the watchlist rule excludes them.

The dashboard re-implements the same formula and farm plans in the page, so any row can be recomputed in front of the reader, and a model sandbox lets the reader move the three constants and watch the board re-rank live.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
