# Proposal: small boards (New York, Amsterdam and London)

Status: **plan**, 2026-10-11, updated the same evening with the owner's second set of measurements. Nothing is built. It waits for the owner's data and the answers
to the questions at the end.

## What the owner has given so far

- The small Ticket to Ride maps are **New York, Amsterdam and London**, and **all three are 2 × 4 panels** (2 rows of 4, named as the editor names boards: rows × columns).
- A panel on **New York is 14 × 21.4 cm**; on **Amsterdam and London it is 16.5 cm wide** instead of 14 (the 21.4 is the same, as I read it). The first number is the width.
- **The wagons are the same size on all three: 2.4 cm long.** Their width, the gap between two wagon spaces and the margin at the ends of a route are not given yet.
- The data of the New York map (stops, routes, tickets) is coming, and the other two after it. They are official maps, so they go into the private reference data like the
  other eight and never into the repository.
- San Francisco was named before; it is not among the three described, so it is left until the owner says otherwise.

What that makes, if a panel is 14 (or 16.5) wide and 21.4 tall and the board is 4 panels across and 2 down (to be confirmed, question 1):

| Map | Panel (width × height) | Board (4 across × 2 down) | Long side : short side |
|---|---|---|---|
| New York | 140 × 214 mm | **560 × 428 mm** | 1.31 : 1 |
| Amsterdam, London | 165 × 214 mm | **660 × 428 mm** | 1.54 : 1 |
| (standard, for comparison) | 263.3 × 262.5 mm, 2 × 3 | 790 × 525 mm | 1.50 : 1 |

So these are not tiny boards: they are about 70–85 % of the standard board's width and 80 % of its height, with **bigger wagons** (24 mm against 20).
A route of *n* spaces takes about *n* × (24 + gap) + margin mm, which with the gap and the margin in proportion to the standard ones (5.5 and 15 mm for a 20 mm wagon, so about 6.6 and 18 mm)
is 30.6 *n* + 18: the longest route that fits along the 560 mm side is about 17 spaces, along 660 mm about 21, against about 30 on the standard 790 mm board.

## What the editor assumes today

The whole editor measures against one kind of board. Where, in the code (read on 2026-10-11):

| Assumption | Where | Value |
|---|---|---|
| A panel is square-ish | `PANEL_MM` in `app/map-data.ts`; `formatOf` | 263.3 × 262.5 mm; a board is 1–6 × 2–6 panels, never one alone |
| A wagon, its gap and the margin at a route's ends | `realWagon` in `app/map-data.ts`, used by `fittingLength`, `routeSpacing` (`app/map-analysis.ts`) and the text of Map balance | 20 × 9 mm, gap 5.5, margin 15 (fitted over the 101 routes of Europe) |
| How far apart parallel lanes sit | `PARALLEL_SPACING_MM`, `PARALLEL_SPACING_STYLED_MM` (both built from `realWagon.width`) | 11.5 and 14.5 mm |
| What a map unit is | `W = 1100` units across the long side; `unitMm = board width mm / 1100` | 0.718 mm on the standard board; 0.509 on New York, 0.600 on Amsterdam and London |
| How big a stop, a name, a stroke is | `stopSizeMeta` and the font sizes and strokes in `app/map-artwork.tsx`: **in map units**, tuned so that on the 790 mm board they are 3 to 6.5 mm | does not follow the board's real size |
| A ticket card | `cardSize` in `app/print-plan.ts` | 62 × 45 mm |
| The ranges Map balance sets a map against | `BALANCE_OFFICIAL` | measured on eight big official maps |

On a 560 × 428 mm board with 24 mm wagons the assumptions that matter break, in two different ways:

1. **Wagons are in millimetres, stops and names are in map units.** On the standard board they happen to agree (a medium stop is 6.3 units = 4.5 mm). On New York a map unit is
   0.509 mm, so the same 6.3 units would be a stop with a radius of 3.2 mm instead of 4.5, a little smaller than it should be, and the wagon 24 mm = 47 units instead of 28. The mismatch is smaller than
   I first feared (the boards are not tiny), but it is there: everything that has a physical size has to be in millimetres and be turned into units with the board's own `unitMm`.
2. **A panel is not a standard panel, and the wagon is bigger against the board**, so the numbers in Map balance that depend on room per wagon mean something else, and the official ranges
   (from the big maps) may not fit a small map. Which ranges to show for the three small maps waits for their data (below).

## The solution proposed

**A board profile in the map**: two optional fields, kept with the map and in its files.

```
panelMm: { width: 140, height: 214 }          // one panel, upright as the owner gives it; absent = 263.3 × 262.5
wagonMm: { length: 24, width: ?, gap: ?, endMargin: ? }   // absent = 20 × 9, gap 5.5, margin 15
```

- The board is still named by its panels, and **all three small maps are `board-2x4`**: 2 rows of 4 panels. Its size in millimetres is the panels times `panelMm`. No change to the rule for a board's name
  is needed (the one-panel case in the first version of this plan is gone: all three are 2 × 4). A panel taller than wide is allowed: the board as a whole is wider than tall (560 × 428), and `turnBetween` still tells lying from standing.
- **Presets** in Settings beside Standard and Extended: "Small, New York" (panel 140 × 214), "Small, Amsterdam and London" (panel 165 × 214); both set the same wagon (24 mm). "Custom size…" gets the panel and wagon
  numbers as advanced fields. It is one choice in the board part of Settings, not a new page: small boards will be used rarely.
- **Rejected:** a new format name per kind of board (`board-ny`: a name for each map, and an older build reads every unknown name as the standard board); a single scale factor (these panels are not standard panels made smaller or larger).

**Files.** Both fields are additions within versions 3 and 4, so the file version does not move. A build before the change keeps unknown fields (rule 3), but it reads `board-2x4` as the extended board (1053 × 526 mm) and draws the map on that:
the positions as they were, on a board of another shape; from 1.3.0 it says that the file is from a newer editor (rule 7). `docs/FILE-FORMAT.md` gets the fields and what an older build does, as for the boards in 1.4.0 and the lane rule in 1.5.0.
Values read from a file are held to rule 8: numbers that are not numbers, or outside 40–1500 mm, are mended; the hostile-maps test covers them. **This needs the owner's OK before it is built** (AGENTS.md: a change to what files carry).

## The work, in the order it is done (each step's tests are written first)

1. **The profile in the model and the file.** `boardDefinition(data)` replaces `formatOrStandard(data.format)` in its 25 places (`app/board.ts`, `map-storage.ts`, `print-plan.ts`, `map-image.tsx`, `map-print.tsx`, `map-editor.tsx`, `map-styles.tsx`);
   `wagonOf(data)` replaces `realWagon`. Round-trip, hostile, and older-build tests (as in `tests/lane-rule.cjs`).
2. **Everything physical in millimetres** (the largest step, and the risky one). Stop radii, names, strokes, the lane spacing and the end gaps become millimetres converted with the board's `unitMm`, so that on the standard boards the drawing is
   **exactly what it is today**: a golden test first (the example map and the map with problems, on 2×3, 2×4 and 3×4, lying and standing, compared as drawn before and after), then the change. Only then does a small board draw to scale.
3. **Analysis.** `fittingLength`, `routeSpacing`, "Room per wagon" and the text of Map balance use `wagonOf(data)` and say the real millimetres. Whether the official ranges are shown beside a small map, or a separate set once the small maps' own figures
   are measured, waits for their data.
4. **Printing.** Board sizes from the profile (560 × 428 mm and 660 × 428 mm: several A4 or A3 sheets at full size, one sheet scaled, a sheet per panel of 140 or 165 × 214 mm, which is an upright sheet); the ticket cards stay 62 × 45 mm unless the owner says the small boards have smaller ones.
5. **Settings.** The presets and the advanced fields, and the welcome guide's mention of the choices.
6. **The three maps as reference data.** Converted as the other eight were (private, never committed), run through the calibration, their figures set beside the official ones; whether they become official maps in `BALANCE_OFFICIAL` (and how the ranges are kept for big and small maps) is decided with the figures in front of us.
7. **Release.** A minor release (1.8.0), with the review, `npm run test:release -- --dev` (the work touches components) and the owner's go.

## What a test of it must show

- The standard boards draw as before (the golden test in step 2).
- On a 560 × 428 board with 24 mm wagons: a route of 3 spaces is drawn long enough for three wagons and its margin, and `fittingLength` and `routeSpacing` agree with the drawing; a stop is about 4.5 mm across and a name about 2.5 mm high **in millimetres**,
  whatever the zoom, on New York and on Amsterdam alike.
- The printed board is 560 × 428 mm (or 660 × 428) at full size (measured in the print plan), and a stop is the same size on paper as on the board.
- An older build (1.7.0 and before) opens the file, keeps the profile through a round trip, and says that the file is from a newer editor (compiled from the commits, as in `tests/lane-rule.cjs`).
- The hostile-maps test sets every odd value in `panelMm` and `wagonMm` without a throw.

## Questions for the owner

1. **Confirm the board**: a panel is 14 (or 16.5) cm *wide* and 21.4 cm *tall*, and the board is 4 panels across and 2 down, so 56 × 42.8 cm for New York and 66 × 42.8 cm for Amsterdam and London? If instead the panels lie (21.4 wide, 14 or 16.5 tall) the board is 85.6 × 28 cm (or 85.6 × 33 cm): please say which.
2. The wagon: **how wide** is it (the 2.4 cm is its length), and what is the **gap** between two wagon spaces and the **margin** at the ends of a route? A measured distance between two stops on a route of known length gives all three. If they are not at hand I use the standard proportions (6.6 and 18 mm) and say so in the map.
3. **Ticket cards**: 62 × 45 mm on the small boards too?
4. **Stops and names**: how big is a stop circle on these boards, and how big is a name's lettering? (A measurement of one of each is enough; the three boards are probably alike.)
5. The data: in what form (a spreadsheet, the JSON of the reference data, photographs of the boards)? I convert it into the private reference data as for the other eight.
6. Should the three be **official maps in Map balance's comparison** (with separate ranges for small boards), or only example maps for the small boards?
7. **San Francisco**: is it the same kind of board (and does it get a preset), or something else?
