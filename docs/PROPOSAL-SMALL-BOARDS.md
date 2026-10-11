# Proposal: small boards (New York, and San Francisco and London after it)

Status: **plan**, 2026-10-11. Nothing is built. It waits for the owner's data and answers to the questions at the end.

## What the owner has given so far

- For the small Ticket to Ride maps (New York is the one measured): **a panel is 14 × 21.4 cm** (140 × 214 mm) and **a wagon (a taxi on the New York
  board) is 2.4 cm long**. Its width, the gap between two wagon spaces and the margin at the ends of a route are not given yet.
- The data of the New York map (stops, routes, tickets) is coming. It is an official map, so it goes into the private reference data like the other
  eight and never into the repository.
- San Francisco and London are the same kind of board; their measurements wait for the owner to measure a board.

## What the editor assumes today

The whole editor measures against one kind of board. Where, in the code (read on 2026-10-11):

| Assumption | Where | Value |
|---|---|---|
| A panel is square-ish | `PANEL_MM` in `app/map-data.ts`; `formatOf` | 263.3 × 262.5 mm; a board is 1–6 × 2–6 panels, never one alone |
| A wagon, its gap and the margin at a route's ends | `realWagon` in `app/map-data.ts`, used by `fittingLength`, `routeSpacing` (`app/map-analysis.ts`) and the text of Map balance | 20 × 9 mm, gap 5.5, margin 15 (fitted over the 101 routes of Europe) |
| How far apart parallel lanes sit | `PARALLEL_SPACING_MM`, `PARALLEL_SPACING_STYLED_MM` (both built from `realWagon.width`) | 11.5 and 14.5 mm |
| What a map unit is | `W = 1100` units across the long side; `unitMm = board width mm / 1100` | 0.718 mm on the standard board |
| How big a stop, a name, a stroke is | `stopSizeMeta` and the font sizes and strokes in `app/map-artwork.tsx`: **in map units**, tuned so that on the 790 mm board they are 3 to 6.5 mm | does not follow the board's real size |
| A ticket card | `cardSize` in `app/print-plan.ts` | 62 × 45 mm |
| The ranges Map balance sets a map against | `BALANCE_OFFICIAL` | measured on eight big official maps |

On a board of 214 × 140 mm with 24 mm wagons the assumptions that matter break, and in two different ways:

1. **Wagons are in millimetres, stops and names are in map units.** On the standard board they happen to agree (a medium stop is 6.3 units = 4.5 mm). On a
   214 mm board a map unit is 0.195 mm, so the same 6.3 units would be a stop 1.2 mm across, next to a 24 mm wagon. Everything that has a physical size has
   to be in millimetres and be turned into units with the board's own `unitMm`.
2. **A panel is not a scaled standard panel**: 214 × 140 against 263 × 262, and the wagon is bigger against the board. A route of *n* spaces needs
   about *n* × (24 + gap) + margin mm; with the gap and margin in proportion to the standard ones (5.5 and 15 mm for a 20 mm wagon, so about 6.6 and 18 mm)
   that is 30.6 *n* + 18, so the longest route that fits along the 214 mm side is about 6 spaces, against about 30 on the standard 790 mm board. The numbers in
   Map balance that depend on room per wagon mean something else, and the official ranges (from big maps) may not fit a small map at all.

## The solution proposed

**A board profile in the map**: two optional fields, kept with the map and in its files.

```
panelMm: { width: 214, height: 140 }          // one panel, lying (width ≥ height); absent = 263.3 × 262.5
wagonMm: { length: 24, width: ?, gap: ?, endMargin: ? }   // absent = 20 × 9, gap 5.5, margin 15
```

- The board is still named by its panels (`board-RxC`); its size in millimetres is the panels times `panelMm`. New York is one panel: `board-1x1` with
  `panelMm` 214 × 140. A board of one panel is allowed when its panel is not square (the rule that stops `board-1x1` today is that a square board cannot be told to
  lie or stand: a 214 × 140 panel can).
- A **preset** in Settings beside Standard and Extended: "Small (New York)" sets both fields; "Custom size…" gets the panel and wagon numbers as advanced fields.
  It is one choice in the board part of Settings, not a new page: small boards will be used rarely.
- **Rejected:** a new format name per kind of board (`board-ny`: a name for each, and an older build reads every unknown name as the standard board, so it
  sits on the wrong board); a single scale factor (a panel of 214 × 140 is not a standard panel made smaller).

**Files.** Both fields are additions within versions 3 and 4, so the file version does not move. A build before the change keeps unknown fields (rule 3), but it reads
`board-1x1` as the standard board and draws the map on it with the positions as they were; from 1.3.0 it says that the file is from a newer editor (rule 7). `docs/FILE-FORMAT.md`
gets the fields and what an older build does, as for the boards in 1.4.0 and the lane rule in 1.5.0. Values read from a file are held to the rules of rule 8: numbers that are not
numbers, or outside 40–1500 mm, are mended; the hostile-maps test covers them. **This needs the owner's OK before it is built** (AGENTS.md: a change to what files carry).

## The work, in the order it is done (each step's tests are written first)

1. **The profile in the model and the file.** `boardDefinition(data)` replaces `formatOrStandard(data.format)` in its 25 places (`app/board.ts`, `map-storage.ts`, `print-plan.ts`,
   `map-image.tsx`, `map-print.tsx`, `map-editor.tsx`, `map-styles.tsx`); `wagonOf(data)` replaces `realWagon`. Round-trip, hostile, and older-build tests (as in `tests/lane-rule.cjs`).
2. **Everything physical in millimetres** (the largest step, and the risky one). Stop radii, names, strokes, the lane spacing and the end gaps become millimetres converted with the
   board's `unitMm`, so that on the standard boards the drawing is **exactly what it is today**: a golden test first (the example map and the map with problems, on 2×3, 2×4 and 3×4,
   lying and standing, compared as drawn before and after), then the change. Only then does a small board draw to scale.
3. **Analysis.** `fittingLength`, `routeSpacing`, "Room per wagon" and the text of Map balance use `wagonOf(data)` and say the real millimetres. Whether the official ranges are
   shown beside a small map, or a separate set once New York's own figures are measured, waits for the New York data (below).
4. **Printing.** Board sizes from the profile (New York at 214 × 140 mm is one A4 sheet at full size; "One sheet", "Per panel" and "Full size" then coincide, and the dialog should say so rather
   than offer three of the same); the ticket cards stay 62 × 45 mm unless the owner says the small boards have smaller ones.
5. **Settings.** The preset and the advanced fields, and the welcome guide's mention of the choices.
6. **The New York map as reference data.** Converted as the other eight were (private, never committed), run through the calibration, its figures set beside the official ones; whether it
   becomes the ninth official map in `BALANCE_OFFICIAL` (and how the ranges are kept for big and small maps) is decided with the figures in front of us.
7. **Release.** A minor release (1.8.0), with the review, `npm run test:release -- --dev` (the work touches components) and the owner's go.

## What a test of it must show

- The standard boards draw as before (the golden test in step 2).
- On a 214 × 140 board with 24 mm wagons: a route of 3 spaces is drawn long enough for three wagons and its margin, and `fittingLength` and `routeSpacing` agree with the drawing; a stop is
  about 4 mm across and a name about 2.5 mm high **in millimetres**, whatever the zoom.
- The printed board is 214 × 140 mm at full size (measured in the print plan), and a stop is the same size on paper as on the board.
- An older build (1.7.0 and before) opens the file, keeps the profile through a round trip, and says that the file is from a newer editor (compiled from the commits, as in `tests/lane-rule.cjs`).
- The hostile-maps test sets every odd value in `panelMm` and `wagonMm` without a throw.

## Questions for the owner

1. Is the New York board **one panel** (214 × 140 mm in all) or more than one? And is the panel 214 wide and 140 high lying, as I assume, or the other way round?
2. The wagon: **how wide** is it (the 2.4 cm is its length), and what is the **gap** between two wagon spaces and the **margin** at the ends of a route? A measured distance between two
   stops on a route of known length gives all three. If they are not at hand I use the standard proportions (6.6 and 18 mm) and say so in the map.
3. **Ticket cards**: 62 × 45 mm on the small boards too?
4. **Stops and names**: how big is a stop circle on the New York board, and how big is a name's lettering? (A measurement of one of each is enough.)
5. The data: in what form (a spreadsheet, the JSON of the reference data, photographs of the board)? I convert it into the private reference data as for the other eight.
6. Should New York be an **official map in Map balance's comparison** (a ninth, with separate ranges for small boards), or only the example for the small boards?
7. Is San Francisco or London to be measured next, or does New York alone do for now?
