# Testing: what runs when

Status: **plan**, agreed in outline with the owner on 2026-10-06. Nothing below is built yet except
what the measurements describe. The aim is that ordinary development gets an answer in about a
minute, a merge into `main` in two to three minutes, and the full set only where it matters:
before a release.

## What it costs today

Measured on 2026-10-06 on the owner's laptop, against the production build (`out/`), one
browser at a time, one test after another.

| Part | Time | What it is |
|---|---|---|
| `typecheck`, `lint`, `build` | 2 s, 4 s, 7 s | |
| unit suites, all but two | about 15 s | each 0–4 s |
| `deck-tension` | 47 s | calibrates the deck tension on the eight official maps |
| `ticket-calibration` | 17 s | the ticket suggester against the same maps |
| regression, Chromium | about 6½ min (385 s) | 836 checks in 56 sections |
| regression, WebKit | about the same | the same sections |
| a full release check | about 25 min | `npm test`, regression on dev and on the production build, and WebKit, one after another |

Where the regression time goes:

- **Fixed sleeps are over half of it.** 516 `waitForTimeout` calls add up to 205 s of the 385 s. Section
  33 alone sleeps 54 s and takes 106 s.
- **Most sections are independent.** 23 of the 56 sections (1, 33, 35–56) open a browser context of
  their own and need nothing from the others: 260 s. The other 33 (2–32 and 34) share one page and
  run as a chain, each starting from what the one before left: 125 s.
- The unit suites that take long (`deck-tension`, `ticket-calibration`, `balance-official`) only matter
  when the ticket suggester or the balance figures change.

## Three tiers

| Tier | When | What runs | Target |
|---|---|---|---|
| **quick** | while working, before each commit | `typecheck`, `lint`, the fast unit suites, and the regression sections for the area touched (see the map below) in Chromium against the dev server | about 1 minute |
| **merge** | before work is merged into `main` | `npm test` without the calibration suites unless the suggester or balance figures changed, and the whole regression in Chromium, sharded in parallel | 2–3 minutes |
| **release** | before every push of a release and every deploy | everything: `npm test` with the calibration suites, the whole regression in Chromium on the dev server and on the production build, and in WebKit, run in parallel, then the walk-through in `docs/DEPLOYMENT.md` | about 5 minutes, plus the walk-through |

What does not change: **tests are designed before the feature**, the checks that are worth keeping are
folded into `tests/regression.cjs` (or a unit suite), and a failing check is first judged for which
side is wrong. Only *how much runs when* changes. The release tier is the safety net for what the
lighter tiers skip, so it may not be skipped, and the owner's go for a push or deploy is given after it.

### Which sections an area touches

A first map, to be kept in `tests/impact.json` once it exists. A change to a file in the left column
runs the sections on the right, on top of the section for the feature itself.

| Changed | Run |
|---|---|
| `app/ticket-suggester.ts`, `app/map-analysis.ts` | the calibration suites, `intended`, and the sections on Tickets, Map balance and tension (12, 45, 51, 52, 54, 55) |
| `app/map-storage.ts`, `app/map-data.ts` | `file-format`, `corrupt-files`, `map-version`, `csv-*`, `board`, and the sections on persistence and import (11, 43, 49, 50) |
| `app/map-print.tsx`, `app/print-*` | `print-plan` and the printing sections (10, 12, 22, 41) |
| `app/map-dialogs.tsx`, `app/deck-rules-panel.tsx`, `app/tension-slider.tsx` | the Tickets, Map balance and Settings sections |
| `app/*.css` | the contrast and layout sections (34, 56) and one section per panel |
| `app/version.ts`, `CHANGELOG.md` | `releases` |
| anything else | the sections found by `git diff --stat` against a short list, then ask |

The numbers are to be checked against the real section titles when the map is written; this table is
the idea, not the contract.

## What gets built, in this order

Each step stands on its own and can be stopped after any of them.

1. **`npm run test:quick`.** A script that runs `typecheck`, `lint` and the fast unit suites (everything
   except `deck-tension`, `ticket-calibration` and `balance-official`), and prints its own time.
   `npm test` keeps running everything. About 30 minutes of work; saves about a minute per run.
2. **Pick sections.** `TTR_ONLY=51,52 node tests/regression.cjs` runs only those sections (plus 1, the
   welcome box, which the chain needs). Sections 35–56 and 33 can run alone today; the chain
   (2–32, 34) runs as one unit or not at all, since each part starts from what the last left. A
   section named but unable to run alone says so instead of failing in a confusing way.
3. **Waits instead of sleeps.** Replace each `waitForTimeout(n)` by waiting for what the next line
   needs (`expect`-style waits on a selector, a stored value or a network idle), section by section,
   starting with 33 (54 s of sleeping), 12, 37, 10 and 45. Where nothing can be waited for, the time
   stays but is named. A section is converted only if it still passes ten runs in a row, so that
   speed does not buy flakiness. Likely saving: 205 s of sleeping down to about 60 s.
4. **Shard the regression.** `TTR_SHARD=1/4` runs a quarter of the independent sections; the chain is
   one shard of its own. A small runner (`npm run test:regression:parallel`) starts the shards at once
   against one server and sums the result. Four workers bring the Chromium run to about two minutes;
   with step 3, about one.
5. **One command for each tier.** `npm run test:quick`, `npm run test:merge`, `npm run test:release`,
   each printing what it ran, what it left out and why, and how long it took. `test:release` runs
   Chromium (dev), Chromium (production build) and WebKit side by side and refuses to say "green"
   unless all three are.
6. **The impact map** (`tests/impact.json` and `npm run test:changed`): chooses the quick tier's sections
   from `git diff --name-only main`. Last, because it is only as good as the table and needs the
   earlier steps to be worth anything.

## Rules this changes in AGENTS.md

Proposed wording, to be put into AGENTS.md when the owner has said yes (it is kept out of the
repository, so it is not part of this commit):

- *Work test first* stays as it is, except its last line: **run the quick tier while working, the merge
  tier before merging into `main`, and the whole release tier before any push or deploy.** Say in the
  hand-over which tier ran.
- *The public site is released: test more before it is updated* is the release tier, unchanged in what
  it asks for.
- *Merge when green* means the merge tier is green.

## Risks, and what is done about them

- **A regression slips through the lighter tiers.** The merge tier runs every section in Chromium, so
  what slips through is only what differs in WebKit or in the production build. Both are in the
  release tier, which runs before anything leaves the machine.
- **Faster waits make tests flaky.** Each converted section runs ten times in a row before it is
  trusted; a section that flakes goes back to its sleeps, with the reason in a comment.
- **Sharding hides order dependence.** The independent sections are checked once by running each one
  alone; the chain is never split.
- **The impact map goes stale.** `test:merge` ignores it and runs every section, so a wrong map only
  makes the quick tier less useful, not the merge tier less safe.
