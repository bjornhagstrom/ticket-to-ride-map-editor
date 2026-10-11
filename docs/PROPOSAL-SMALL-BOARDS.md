# Proposal: small boards (New York, Amsterdam and London)

Status: **plan**, 2026-10-11, updated the same evening with the owner's second and third sets of measurements (all three boards are 2 × 2 panels). Nothing is built. It waits for the owner's data and the answers
to the questions at the end.

## What the owner has given so far

- The small Ticket to Ride maps are **New York, Amsterdam and London**, and **all three are 2 × 2 panels** (2 rows of 2, named as the editor names boards: rows × columns).
- A panel on **New York is 14 × 21.4 cm**; on **Amsterdam and London it is 16.5 cm wide** instead of 14 (the 21.4 is the same, as I read it). The first number is the width.
- **The wagons are the same size on all three: 2.4 cm long.** Their width, the gap between two wagon spaces and the margin at the ends of a route are not given yet.
- The data of the New York map (stops, routes, tickets) is coming, and the other two after it. They are official maps, so they go into the private reference data like the
  other eight and never into the repository.
- **Decided by the owner (2026-10-11):** the wagon's gap, margin and width follow the **standard proportions** of the 20 mm wagon scaled to 24 mm (width 10.8, gap 6.6, end margin 18 mm), said in the map's notes; the **ticket cards may be smaller on small boards** (it does not matter for a prototype), so that more fit on a print.
- **New York and Amsterdam are in the private reference data** (commit `d21f3c8` in `~/Developer/ttr-reference-data`, read from the owner's photos of the boards and the cards on 2026-10-11; London has the same board as Amsterdam and is not entered).
  Aggregated figures (the maps themselves stay in that repository): New York, 15 stops, 41 lanes (11 of them double), 84 spaces of length 1–4, 15 wagons a player, 2–4 players, 18 tickets (every one worth its shortest path); Amsterdam, 17 stops, 45 lanes (13 double), 89 spaces of length 1–4,
  16 wagons a player, 2–4 players, 24 tickets (every one worth its shortest path). Route points are 1, 2, 4 and 7 for lengths 1 to 4. New York **stands** (280 × 428 mm), Amsterdam **lies** (428 × 330 mm), as measured; both kept out of the calibration for now. Two rules the editor has no field for, but that a custom
  stop type and a custom route type can mark: New York's nine tourist attractions (a stop that scores a point if on a player's network) and Amsterdam's merchandise lanes.
- San Francisco was named before; it is not among the three described, so it is left until the owner says otherwise.

What that makes (a panel upright, 14 or 16.5 cm wide and 21.4 cm tall, two panels across and two down; the board is then taller than wide, which the editor calls **standing**, and the same
board lying is 21.4 wide panels, so the numbers below hold either way up):

| Map | Panel (upright, width × height) | Board (2 × 2 panels) | Long side : short side | One map unit (1100 across the long side) |
|---|---|---|---|---|
| New York | 140 × 214 mm | **280 × 428 mm** (lying: 428 × 280) | 1.53 : 1 | 0.389 mm |
| Amsterdam, London | 165 × 214 mm | **330 × 428 mm** (lying: 428 × 330) | 1.30 : 1 | 0.389 mm |
| (standard, for comparison) | 263.3 × 262.5 mm, 2 × 3 | 790 × 525 mm | 1.50 : 1 | 0.718 mm |

So these are **small**: a long side of 428 mm against 790, and **bigger wagons** (24 mm against 20). A route of *n* spaces takes about *n* × (24 + gap) + margin mm, which with the gap and the margin in
proportion to the standard ones (5.5 and 15 mm for a 20 mm wagon, so about 6.6 and 18 mm) is 30.6 *n* + 18: the longest route that fits along the 428 mm side is about **13** spaces, along the 280 mm
side of New York about 8 and along the 330 mm side of Amsterdam and London about 10, against about 30 along the standard board. A wagon is 24 mm = 62 map units long here, against 28 on the standard board.

## What the editor assumes today

The whole editor measures against one kind of board. Where, in the code (read on 2026-10-11):

| Assumption | Where | Value |
|---|---|---|
| A panel is square-ish | `PANEL_MM` in `app/map-data.ts`; `formatOf` | 263.3 × 262.5 mm; a board is 1–6 × 2–6 panels, never one alone |
| A wagon, its gap and the margin at a route's ends | `realWagon` in `app/map-data.ts`, used by `fittingLength`, `routeSpacing` (`app/map-analysis.ts`) and the text of Map balance | 20 × 9 mm, gap 5.5, margin 15 (fitted over the 101 routes of Europe) |
| How far apart parallel lanes sit | `PARALLEL_SPACING_MM`, `PARALLEL_SPACING_STYLED_MM` (both built from `realWagon.width`) | 11.5 and 14.5 mm |
| What a map unit is | `W = 1100` units across the long side; `unitMm = board width mm / 1100` | 0.718 mm on the standard board; 0.389 on all three small boards |
| How big a stop, a name, a stroke is | `stopSizeMeta` and the font sizes and strokes in `app/map-artwork.tsx`: **in map units**, tuned so that on the 790 mm board they are 3 to 6.5 mm | does not follow the board's real size |
| A ticket card | `cardSize` in `app/print-plan.ts` | 62 × 45 mm |
| The ranges Map balance sets a map against | `BALANCE_OFFICIAL` | measured on eight big official maps |

On a 428 × 280 mm board (or 428 × 330) with 24 mm wagons the assumptions that matter break, in two different ways:

1. **Wagons are in millimetres, stops and names are in map units.** On the standard board they happen to agree (a medium stop has a radius of 6.3 units = 4.5 mm). Here a map unit is 0.389 mm, so the same
   6.3 units would be a stop with a radius of 2.5 mm instead of 4.5, next to a wagon 24 mm long (62 units instead of 28). Names and strokes shrink the same way. Everything that has a physical size has to be in
   millimetres and be turned into units with the board's own `unitMm`: this is the largest step of the work and the one that must not change how the standard boards look.
2. **A panel is not a standard panel, and the wagon is bigger against the board**, so the numbers in Map balance that depend on room per wagon mean something else, and the official ranges (from the big maps) may not fit a small
   map. Which ranges to show for the three small maps waits for their data (below).

## The solution proposed

**A board profile in the map**: two optional fields, kept with the map and in its files.

```
panelMm: { width: 214, height: 140 }          // one panel as the board LIES (long side first; a standing board is the lying one turned); absent = 263.3 × 262.5
wagonMm: { length: 24, width: 10.8, gap: 6.6, endMargin: 18 }   // the standard proportions of 20 × 9, gap 5.5, margin 15; absent = 20 × 9, 5.5, 15
```

- The board is still named by its panels, and **all three small maps are `board-2x2`**: 2 rows of 2 panels. Its size in millimetres is the panels times `panelMm`: for New York 2 × 214 = 428 across and 2 × 140 = 280 down.
  No change to the rule for a board's name is needed (`board-2x2` is already a board; with the standard panel it is 527 × 525 mm, and with the profile 428 × 280). **The profile is kept as the board lies**, because the editor keeps a board lying and
  turns it to stand (the owner's upright 14 × 21.4 cm panel is `panelMm` 214 × 140 with the map's orientation set to standing). Which way each board stands when played is for the owner to say (question 1); it is the map's orientation, not a new field.
- **Presets** in Settings beside Standard and Extended: "Small, New York" (panel 214 × 140 lying), "Small, Amsterdam and London" (panel 214 × 165 lying); both set the same wagon (24 mm). "Custom size…" gets the panel and wagon
  numbers as advanced fields. It is one choice in the board part of Settings, not a new page: small boards will be used rarely.
- **Rejected:** a new format name per kind of board (`board-ny`: a name for each map, and an older build reads every unknown name as the standard board); a single scale factor (these panels are not standard panels made smaller or larger).

**Files.** Both fields are additions within versions 3 and 4, so the file version does not move. A build before the change keeps unknown fields (rule 3), but it reads `board-2x2` as the board of two standard panels (527 × 525 mm) and draws the map on that:
the positions as they were, on a board of another shape; from 1.3.0 it says that the file is from a newer editor (rule 7). `docs/FILE-FORMAT.md` gets the fields and what an older build does, as for the boards in 1.4.0 and the lane rule in 1.5.0.
Values read from a file are held to rule 8: numbers that are not numbers, or outside 40–1500 mm, are mended; the hostile-maps test covers them. **This needs the owner's OK before it is built** (AGENTS.md: a change to what files carry).

## The work, in the order it is done (each step's tests are written first)

1. **The profile in the model and the file.** `boardDefinition(data)` replaces `formatOrStandard(data.format)` in its 25 places (`app/board.ts`, `map-storage.ts`, `print-plan.ts`, `map-image.tsx`, `map-print.tsx`, `map-editor.tsx`, `map-styles.tsx`);
   `wagonOf(data)` replaces `realWagon`. Round-trip, hostile, and older-build tests (as in `tests/lane-rule.cjs`).
2. **Everything physical in millimetres** (the largest step, and the risky one). Stop radii, names, strokes, the lane spacing and the end gaps become millimetres converted with the board's `unitMm`, so that on the standard boards the drawing is
   **exactly what it is today**: a golden test first (the example map and the map with problems, on 2×3, 2×4 and 3×4, lying and standing, compared as drawn before and after), then the change. Only then does a small board draw to scale.
3. **Analysis.** `fittingLength`, `routeSpacing`, "Room per wagon" and the text of Map balance use `wagonOf(data)` and say the real millimetres. **Map balance for small maps** (the owner's question, answered yes): the figures it works out are mostly ratios and
   need no page of their own, but the *ranges they are set against* (`BALANCE_OFFICIAL`, measured on eight big maps) should not be the ones for a board of 428 mm. A second set, "Against the small official maps", is measured on New York, Amsterdam and London (three maps: thin evidence,
   said on the page), and a map is set against it when its board is small (its long side under 500 mm, which all three are). The wagon-fill measure (what a full table holds against the spaces it can claim) is a ratio too, and gets its own range there. Built after the data of all three is in.

   **What the two maps in the reference data already show** (the editor's own figures, at a table of four, against the ranges of the eight big maps; aggregated):

   | Figure | The eight official maps | New York | Amsterdam |
   |---|---|---|---|
   | Wagons a full table holds, of the spaces it can claim | 57–76 % | 71 % | 72 % |
   | Tickets that no other ticket needs the route of (unused routes' share of tickets) | 7–21 % | 33 % | 19 % |
   | Ticket traffic on double routes against single ones | 1.3–3.1 × | 2.8 × | 5.4 × |
   | Average number of routes at a stop | 7.6–10.8 | 9.5 | 9.1 |
   | Most tickets on one stop | 4–9 | 3 | 5 |
   | Routes more tickets want than they can carry, at a full table | 8–19 | 6 | 3 |

   So **the ratios that do not depend on the size of the map (the wagon fill, the routes at a stop) already fit the official ranges**, and the numbers that count things on a map of 15–17 stops and 18–24 tickets (the most tickets on one stop, the crowded routes) fall below ranges
   measured on maps with 30–40 stops, as they must. The two small maps also differ from each other (a third of New York's tickets are unneeded, Amsterdam's traffic on doubles is nearly twice the upper range). That is the argument for **a second set kept as shares, not counts, with the
   thin evidence said on the page**, and for waiting for London before the ranges are written down.
4. **Printing.** Board sizes from the profile (428 × 280 mm and 428 × 330 mm). A panel is 214 × 140 (or 214 × 165) mm, so **a sheet per panel at full size is one A4 sheet each**, four in all, on the paper the real panels are; the whole board at full size is four A4 sheets, or two A3. The ticket cards get a second size, **small (50 × 36 mm, four-fifths of 62 × 45)**, as a choice in the print dialog that the browser remembers (not stored in the map, so no file change): standard 62 × 45 for the standard boards and small for the small ones to begin with, so that more cards fit on a sheet.
5. **Settings.** The presets and the advanced fields, and the welcome guide's mention of the choices.
6. **The three maps as reference data.** Converted as the other eight were (private, never committed), run through the calibration, their figures set beside the official ones; whether they become official maps in `BALANCE_OFFICIAL` (and how the ranges are kept for big and small maps) is decided with the figures in front of us.
7. **Release.** A minor release (1.8.0), with the review, `npm run test:release -- --dev` (the work touches components) and the owner's go.

## What a test of it must show

- The standard boards draw as before (the golden test in step 2).
- On a 428 × 280 board with 24 mm wagons: a route of 3 spaces is drawn long enough for three wagons and its margin, and `fittingLength` and `routeSpacing` agree with the drawing; a stop is about 4.5 mm across and a name about 2.5 mm high **in millimetres**,
  whatever the zoom, on New York and on Amsterdam alike.
- The printed board is 428 × 280 mm (or 428 × 330) at full size (measured in the print plan), and a stop is the same size on paper as on the board.
- An older build (1.7.0 and before) opens the file, keeps the profile through a round trip, and says that the file is from a newer editor (compiled from the commits, as in `tests/lane-rule.cjs`).
- The hostile-maps test sets every odd value in `panelMm` and `wagonMm` without a throw.

## Questions for the owner (the open ones; the answered are in the first part)

1. **Confirm the board**: a panel is 14 (or 16.5) cm wide and 21.4 cm tall, and the board is 2 panels across and 2 down, so **28 × 42.8 cm** for New York and **33 × 42.8 cm** for Amsterdam and London. *(Answered by the reference data: New York stands, 280 × 428 mm; Amsterdam lies, 428 × 330 mm; London is the same as Amsterdam. The presets set the map to standing for New York and lying for the other two. Still to confirm by the owner: that the lying panel of Amsterdam and London is 214 wide and 165 tall, as the board's 428 × 330 mm says.)*
2. **Stops and names**: how big is a **stop circle** (its diameter, in mm), and how tall are the **capital letters of a city's name** as printed on the board (in mm)? One measurement of each is enough; the three boards are probably alike. (By "name lettering" I mean the printed city names, not the letter you can put on a stop in the editor.)
3. **The data** *(New York and Amsterdam are in; London is not entered because its board is the same as Amsterdam's: does it come, or does Amsterdam stand for both?)*: wagons per player, number of players, the numbers of tickets (short and long), the points per route length if they differ from the standard, the rule for double routes by player count, and the board and the cards as photographs or lists (formats in the conversation of 2026-10-11).
4. **San Francisco**: is it the same kind of board (and does it get a preset), or something else?
