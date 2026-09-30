# Printing

How a board gets from the map to paper, the arithmetic behind every sheet count, and what went wrong
along the way. Read this before changing `app/print-plan.ts`, `PrintPages`, `PrintDialog` or the print
CSS, so the reasoning does not have to be rebuilt from the code.

The decision itself — the map knows its board's shape, and printing is asked for each time — is in
`docs/DECISIONS.md`.

## What belongs to the map and what does not

The map stores only its **board shape**: `board-2x3` (790 × 525 mm, 3 × 2 fold panels) or `board-2x4`
(1053 × 526 mm, 4 × 2). The map is drawn against that board, and wagon spaces are always measured
against it: a space is 20 × 9 mm at 100 %.

Everything else is a **print choice**, made in the dialog and kept in `localStorage` under
`ttr-print-choice`. It is never written to the map, the map file or the undo history.

| Choice | Values |
| --- | --- |
| Split | One sheet · One sheet per panel of the game board · Full size |
| Paper | A4 · A3 · US Letter · Tabloid (11 × 17 in) |
| Supersize (2×3 only) | Anniversary size: the 972 × 648 mm board, full size only |

Anniversary is the same drawing printed larger, at 972 / 790 = 1.23 ×, so wagon spaces come out at
24.6 mm, the way the Anniversary edition's bigger trains need. There is no Anniversary 2×4.

`printChoiceFor` normalises a choice: an unknown paper becomes A4, an unknown split becomes per
panel, and `size` is `anniversary` only when the split is full size and the board is a 2×3.

## The arithmetic

All of it is in `printPlan` in `app/print-plan.ts`, and every figure below is pinned by
`tests/print-plan.cjs`.

### The usable area of a sheet

Every page loses a **10 mm printer margin** on every side (`PRINT_MARGIN_MM`) and an **8 mm caption
line** above the artwork (`PRINT_CAPTION_MM`). What is left for the board:

| Paper | Landscape | Portrait |
| --- | --- | --- |
| A4 (210 × 297) | 277 × 182 | 190 × 269 |
| A3 (297 × 420) | 400 × 269 | 277 × 392 |
| US Letter (215.9 × 279.4) | 259.4 × 187.9 | 195.9 × 251.4 |
| Tabloid (279.4 × 431.8) | 411.8 × 251.4 | 259.4 × 403.8 |

Width is paper − 20 mm. Height is paper − 20 − 8 mm.

### One sheet, and one sheet per panel: the largest scale that fits

The tile is the whole board (one sheet) or one fold panel: 263.3 × 262.5 mm on a 2×3, 263.3 × 263 mm
on a 2×4. Its scale is `min(usable width / tile width, usable height / tile height)` in each
orientation. The larger wins, it is **never above 100 %**, and landscape wins a tie.

- 2×3 on one A4: landscape `min(277/790, 182/525)` = 34.7 %.
- A 2×3 panel on A4: portrait `min(190/263.3, 269/262.5)` = 72.2 %.
- A 2×3 panel on A3: it would fit at 105 %, so it is capped at 100 %. Both orientations reach 100 %,
  so landscape wins the tie.
- A panel on Tabloid: 259.4 / 263.3 = 98.5 %, just short of real size.

### Full size: the fewest sheets at 100 %

Columns = `ceil(board width / usable width)` and rows = `ceil(board height / usable height)`, in each
orientation. The fewer sheets win, and landscape wins a tie. The board is then cut into **equal
tiles**, board width / columns by board height / rows, so every sheet is trimmed the same way.

| Board | A4 | A3 | US Letter | Tabloid |
| --- | --- | --- | --- | --- |
| 2×3 standard, 790 × 525 | 9 (3 × 3, L) | 4 (2 × 2, L) | 12 (4 × 3, L) | 6 (2 × 3, L) |
| 2×3 Anniversary, 972 × 648 | 16 (4 × 4, L) | 8 (4 × 2, P) | 15 (5 × 3, P) | 8 (4 × 2, P) |
| 2×4, 1053 × 526 | 12 (4 × 3, L) | 6 (3 × 2, L) | 15 (5 × 3, L) | 9 (3 × 3, L) |

Worked examples:

- **2×3 on A4 is 9.** Landscape: 790 / 277 = 2.85 → 3 columns, 525 / 182 = 2.88 → 3 rows. Portrait
  would need 5 × 2 = 10.
- **2×3 on Letter is 12, not 9.** Landscape Letter leaves 259.4 mm across, and three of those make
  778 mm, 12 mm short of 790. So it takes 4 columns: 790 / 259.4 = 3.05 → 4, times 525 / 187.9 = 2.79
  → 3 rows. Portrait would be 5 × 3 = 15. The margin and the caption are what push it over; without
  them it would be 9.
- **Anniversary on A4 is 16.** 972 / 277 = 3.51 → 4 columns, 648 / 182 = 3.56 → 4 rows. Portrait
  would be 6 × 3 = 18.
- **2×4 on A4 is 12 either way up.** Landscape 4 × 3, portrait 6 × 2. The tie goes to landscape.

`ceil` subtracts 1e-9 first, so floating-point dust never adds a sheet.

The dialog's table, "Sheets for every choice", is built by `printChoices` from the same `printPlan`,
so the table cannot promise a count the printer does not produce. A regression check prints several
cells and compares.

## The page box: why it is smaller than the paper

`PrintPages` declares the paper with a single global rule, `@page { size: <w>mm <h>mm; margin: 10mm }`.
Named `@page` rules were tried first, and print dialogs do not honour them reliably. The page box
itself is **the paper less 20 mm wide, with no fixed height and no padding**: an 8 mm caption the
width of the tile, then the tile at its exact size in millimetres.

It used to be exactly the paper, with `margin: 0`. That printed every other page blank:

- **Safari ignores `@page` margin** and applies its own, so a page box the size of the paper overflowed
  by a few millimetres and spilled onto an empty sheet after every page. Full size on A4 came out as
  18 sheets instead of 9.
- **Chromium shrinks** an over-wide page box to fit instead. That hides the blank pages, but full size
  is then no longer 100 %.

The ticket cards had hit the same thing, in commit `a269359`. The rule for anything printed: never
size a page box to the paper. Leave the margin outside it, and nothing can spill as long as the
browser's own margin is 10 mm or less. With headers and footers switched on in the browser's print
dialog, the margin can be larger. Tell people to switch them off, and to print at 100 %, not "fit to
page".

Full-size sheets have **cut marks** at the tile corners instead of a border. They are drawn with CSS
pseudo-elements that reach 6 mm into the margin, so the page box must not clip:
`.print-map .print-page { overflow: visible }`. With it clipped, the bottom marks disappeared.

## The dialog

- **Anniversary size is one checkbox under Supersize.** There is no Standard option; an empty box is
  the standard board. Ticking it also selects full size, and choosing one sheet or per panel clears it.
  Picking a table cell sets or clears it too. It is never disabled: an earlier version greyed out the
  whole choice, which left the table as the only way to pick it.
- **Nothing may move while choices change.** The table has `table-layout: fixed` and fixed column
  widths. The picked cell is marked with a border and an inset shadow, never bold, which widened it
  and shifted the columns 3 px. Supersize is always present on a 2×3 and never comes and goes. The
  summary always has room for two lines. Before these, the table jumped 10.6 px when full size was
  chosen.
- **Contrast.** Small text is at least 7:1 against its background, and other text at least 4.5:1.
  Numbers and `%` are joined by a non-breaking space, so "100 %" never breaks across a line.
- **The percentage is explained where it is shown.** The note under "Sheets for every choice" says
  that 100 % is real size and 50 % is half as wide and half as tall.

## Old maps

Maps saved on a format that is now a print choice — test sheets, boards measured in sheets of paper,
`board-2x3-large` — open on the nearest board. They are scaled evenly, never enlarged, and centred;
see `docs/MAP-FORMAT.md` for where each one lands, and `docs/FILE-FORMAT.md` for why the file version
did not move.

## Testing it

- `tests/print-plan.cjs` pins every count, orientation and scale above. It needs no browser.
- `tests/regression.cjs` drives the dialog and replaces `window.print` with a stub that measures the
  print tree while it is mounted: page count, the `@page` rule, page width, cut marks, and a wagon
  space's printed length (20.00 mm at full size, 24.61 mm at Anniversary).
- **The stub cannot see pagination.** Only a real PDF shows blank sheets, so the suite prints one with
  `page.pdf()` after forcing the browser's own margins, `@page { margin: 8mm !important }`, the way
  Safari behaves, and checks that the sheet count still matches the table.
- Layout stability is measured: the table's position and every column's x, across a series of
  choices, must not move more than half a pixel.
- Some faults only showed when the PDF was looked at: cut marks crossing the caption, and clipped
  bottom marks. After a change to the print layout, render a page and look at it.

When checking CSS during development, remember that the dev server sends it **pretty-printed and with
properties reordered**. Search for the whole rule, not a compact one-liner.
`scripts/served-css-rule.sh '.print-table {'` prints a rule exactly as the server sends it.
