# Testing: what runs when

Status: **plan**, agreed with the owner on 2026-10-06. Steps 1 to 5 are built (marked below); step 6
is not. The aim is that ordinary development gets an answer in about a
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
| regression, Chromium | about 7 min (418 s) | 850 checks in 58 sections, one after another; **124 s in parallel, 93 s with shorter waits** (steps 3 and 4) |
| regression, WebKit | about the same | the same sections |
| a full release check | about 25 min | `npm test`, regression on dev and on the production build, and WebKit, one after another |

Where the regression time goes:

- **Fixed sleeps are over half of it.** 516 `waitForTimeout` calls add up to 205 s of the 385 s. Section
  33 alone sleeps 54 s and takes 106 s.
- **Most sections are independent, but the long ones are in the chain.** Sections 35–56 each open a
  browser of their own and run alone (checked on 2026-10-06: each passes by itself): about 155 s. Sections
  1–34 share one page and run as a chain, each starting from what the one before left: about 230 s,
  of which section 33 (the route types in Settings) is 106 s.
- The unit suites that take long (`deck-tension`, `ticket-calibration`, `balance-official`) only matter
  when the ticket suggester or the balance figures change.

## Three tiers

| Tier | When | What runs | Target |
|---|---|---|---|
| **quick** | while working, before each commit | `typecheck`, `lint`, the fast unit suites, and the regression sections for the area touched (see the map below) in Chromium against the dev server | about 1 minute |
| **merge** | before work is merged into `main` | for more than a small change, the review in `docs/REVIEW.md`; `npm test` without the calibration suites unless the suggester or balance figures changed, and the whole regression in Chromium in parallel with `--fast` | about 2–3 minutes (the regression 93 s) |
| **release** | before every push of a release and every deploy | the code review of the release (`docs/REVIEW.md`), then everything: `npm test` with the calibration suites, the whole regression on the production build, in Chromium and in WebKit, run in parallel (`npm run test:release`; the dev server is left out, which it says), then the walk-through in `docs/DEPLOYMENT.md` | about 4 minutes, plus the walk-through |

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
| `app/map-storage.ts`, `app/map-data.ts` | `file-format`, `corrupt-files`, `map-version`, `editor-version`, `csv-*`, `board`, and the sections on persistence and import (11, 43, 49, 50) |
| `app/map-print.tsx`, `app/print-*` | `print-plan` and the printing sections (10, 12, 22, 41) |
| `app/map-dialogs.tsx`, `app/deck-rules-panel.tsx`, `app/tension-slider.tsx` | the Tickets, Map balance and Settings sections |
| `app/*.css` | the contrast and layout sections (34, 56) and one section per panel |
| `app/version.ts`, `CHANGELOG.md` | `releases`, `editor-version` |
| anything else | the sections found by `git diff --stat` against a short list, then ask |

The numbers are to be checked against the real section titles when the map is written; this table is
the idea, not the contract.

## What gets built, in this order

Each step stands on its own and can be stopped after any of them.

1. **`npm run test:quick`. Built.** Runs `typecheck`, `lint` and the fast unit suites (everything
   except `deck-tension`, `ticket-calibration` and `balance-official`), with the time of each: 19 s
   in all. `--with-calibration` adds the three slow ones; `npm test` runs everything.
2. **Pick sections. Built.** `TTR_ONLY=51,52 node tests/regression.cjs` (ranges too: `36-40`) runs
   only those sections: section 51 alone takes 8 s. Sections 35–56 run alone. Sections 1–34 are a chain
   and naming any of them runs all of them; the final line says the run was partial, so a partial run
   is never mistaken for the whole suite. All 22 independent sections were run alone, six at a time, in
   39 s.
3. **Shorter waits. Built, in a blunter form than planned.** Rewriting 516 `waitForTimeout` calls one by
   one to wait for a condition was too much and too risky for one go; instead the one place that all of
   them go through can scale them: `TTR_WAIT_SCALE=0.5 TTR_WAIT_FLOOR=250 TTR_FULL_WAITS=37,55`
   runs every fixed wait at half of what is written, never under 250 ms (a wait written shorter is left
   alone), and with the real waits in the sections named. Found by running the suite with shorter waits
   and putting every section that failed on the list, until nothing failed: at 0.4 with no floor eight
   sections failed (tooltip delays, debounced saves, a stubbed slow player), at 0.5 with a floor of 250 ms
   two did (37, 55). That is `--fast` in the runner below, and it was run five times in a row without a
   failure before being trusted. The release tier does not use it. A wait that is still worth turning
   into a wait for a condition is one in a section on the list.
4. **Parallel runner. Built.** `npm run test:regression:parallel` (add `-- --fast` for the shorter waits,
   `-- --workers N`, `-- --record` to rewrite `tests/section-times.json`). The chain (sections 1–32 and 34)
   is one job; section 33, which was in the chain and 106 s long, has a page of its own now and runs
   alone; the rest are shared out over the other workers by how long each took. All of it is plain
   `TTR_ONLY=… node tests/regression.cjs`, so any job can be run by hand. Chromium, production build,
   six workers, 850 checks: **124 s with the waits as written, 93 s with `--fast`, against 418 s one after
   another.** In WebKit the same run, 838 checks (12 are Chromium's own), takes 129 s. What is left is the chain (about 93 s, real work and page loads rather than waiting) and
   section 33 (about 82 s); splitting the chain at a point where it starts afresh would be the next gain.
5. **One command for each tier. Built (2026-10-10).** `npm run test:quick`, `npm run test:merge`, `npm run test:release`,
   each printing what it ran, what it left out and why, and how long it took (`scripts/test-tiers.cjs`, helpers in
   `scripts/tier-lib.cjs`, checked by `tests/tiers.cjs`). **`test:merge`** (128 s): the quick tier (the calibration suites
   too when the change touches the ticket suggester, the balance figures or `map-data.ts`, found with `git diff --name-only
   main`), the build, and the whole regression in Chromium on that build with `--fast`. **`test:release`** (211 s):
   `npm test` (everything, the build included), a scan of `out/` for names from the private reference data (the public
   place names the notes carry on purpose are listed, any other name fails), and the whole regression on the production
   build with the waits as written in Chromium and in WebKit at the same time. It serves `out/` itself under `/ttr` on a free
   port, so nothing else has to run. It says "green" only when everything it ran was, exits non-zero otherwise, and always
   ends with what it did not run: Chromium against the dev server (the production build is the stricter of the two for what
   ships), and the review, the walk-through and the owner's go, which are by hand.
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

## A thing the dev server hides

React's dev mode runs a state updater twice, and the editor records a history step inside one, so against the dev
server every change leaves two identical steps. A check that counts undo steps (a notice's Undo after the toolbar's
Undo, section 59) passes there whatever the code does, and fails only against the production build. Run that
section against `out/` (the release tier does) before trusting it.
