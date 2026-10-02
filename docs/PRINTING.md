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

| Paper | Usable, landscape |
| --- | --- |
| A4 (297 × 210) | 277 × 182 |
| A3 (420 × 297) | 400 × 269 |
| US Letter (279.4 × 215.9) | 259.4 × 187.9 |
| Tabloid (431.8 × 279.4) | 411.8 × 251.4 |

Width is paper − 20 mm. Height is paper − 20 − 8 mm.

### Upright pages, the map turned on them

Every page is declared upright (portrait), and the map is laid out as a landscape sheet turned a
quarter turn on it. Safari ignores `@page` and prints portrait unless its own dialog says otherwise;
Chrome and Firefox follow `@page`. An upright page is the one thing all of them do alike, so nobody
has to choose an orientation, and the dialog says to leave it on Portrait.

The sheet's room is still the paper's long side across and its short side down, so every count and
scale below is the landscape one. The plan used to choose the orientation that gave the larger scale,
which made the default (per panel on A4) portrait; then it declared landscape pages, which Safari
ignored.

Laying every sheet out landscape costs a little in a few cases, against choosing per run: a panel on
A4 is 69 % instead of 72 %, on Letter 72 % instead of 74 %, and on Tabloid 96 % instead of 98.5 %;
Anniversary is 9 sheets of A3 instead of 8, 16 of Letter instead of 15, and 9 of Tabloid instead of 8.

### One sheet, and one sheet per panel: the largest scale that fits

The tile is the whole board (one sheet) or one fold panel: 263.3 × 262.5 mm on a 2×3, 263.3 × 263 mm
on a 2×4. Its scale is `min(usable width / tile width, usable height / tile height)`, and it is
**never above 100 %**.

- 2×3 on one A4: `min(277/790, 182/525)` = 34.7 %.
- A 2×3 panel on A4: `min(277/263.3, 182/262.5)` = 69.3 %. The height decides.
- A 2×3 panel on A3: it would fit at 102 %, so it is capped at 100 %.
- A panel on Tabloid: 251.4 / 262.5 = 95.8 %.

### Full size: the fewest sheets at 100 %

Columns = `ceil(board width / usable width)` and rows = `ceil(board height / usable height)`. The board
is then cut into **equal tiles**, board width / columns by board height / rows, so every sheet is
trimmed the same way.

| Board | A4 | A3 | US Letter | Tabloid |
| --- | --- | --- | --- | --- |
| 2×3 standard, 790 × 525 | 9 (3 × 3) | 4 (2 × 2) | 12 (4 × 3) | 6 (2 × 3) |
| 2×3 Anniversary, 972 × 648 | 16 (4 × 4) | 9 (3 × 3) | 16 (4 × 4) | 9 (3 × 3) |
| 2×4, 1053 × 526 | 12 (4 × 3) | 6 (3 × 2) | 15 (5 × 3) | 9 (3 × 3) |

Worked examples:

- **2×3 on A4 is 9.** 790 / 277 = 2.85 → 3 columns, 525 / 182 = 2.88 → 3 rows.
- **2×3 on Letter is 12, not 9.** Landscape Letter leaves 259.4 mm across, and three of those make
  778 mm, 12 mm short of 790. So it takes 4 columns: 790 / 259.4 = 3.05 → 4, times 525 / 187.9 = 2.79
  → 3 rows. The margin and the caption are what push it over; without them it would be 9.
- **Anniversary on A4 is 16.** 972 / 277 = 3.51 → 4 columns, 648 / 182 = 3.56 → 4 rows.
- **2×4 on A4 is 12.** 1053 / 277 = 3.80 → 4 columns, 526 / 182 = 2.89 → 3 rows.

`ceil` subtracts 1e-9 first, so floating-point dust never adds a sheet.

The dialog's table, "Sheets for every choice", is built by `printChoices` from the same `printPlan`,
so the table cannot promise a count the printer does not produce. A regression check prints several
cells and compares.

## The page box: why it is smaller than the paper

`PrintPages` declares the paper, upright, with a single global rule,
`@page { size: <w>mm <h>mm; margin: 10mm }`. Named `@page` rules were tried first, and print dialogs
do not honour them reliably. The page box itself is **the turned sheet and nothing more**: the 8 mm
caption plus the tile's height across, the tile's width down, at their exact sizes in millimetres.
That always fits inside the paper less 20 mm each way.

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

### How the sheet is turned, and what did not work

Each page is one SVG the size of the page box, in millimetres, holding the caption, the artwork and
the frame or cut marks, turned with an SVG transform, `translate(h 0) rotate(90)`. Two other ways
failed:

- **Turning only on portrait paper,** with `@media print and (orientation: portrait)`. In Safari the
  rule never applied; in Chrome it applied on landscape paper and split each sheet over two pages.
  The orientation media query cannot be trusted to describe the paper while printing.
- **Turning HTML with a CSS transform.** The print tree measured right, but in Chromium's PDF the SVG
  inside the turned element came out at about 0.7 of its size while the cut marks beside it did not.

The regression suite imitates Safari with Chromium's `page.pdf` and `@page` size switched off. That
imitation said the media-query version worked; Safari showed otherwise. A print change is not done
until it has been looked at in Safari and Chrome.

Full-size sheets have **cut marks** at the tile corners instead of a border: lines from 0.5 to 2.5 mm
past each corner (`CUT_MARK_GAP_MM`, `CUT_MARK_REACH_MM`), drawn outside the page box, so neither the
box nor its SVG may clip (`overflow: visible`). With it clipped, the bottom marks disappeared.

The marks count against the page. They used to reach 6 mm, and a full-size A4 sheet with its marks
came to 275 mm down the page. Safari, with its headers and footers on, fitted a 274 mm sheet but
spilled that one onto a second page. So `printPlan` takes the marks' reach off the room before it
counts sheets, and a full-size A4 sheet now reaches 268 mm. No sheet count changed; at 6 mm, A3
would have gone from 4 sheets to 6.

**print() waits for the dialog to leave.** Safari lays out its first preview the moment `print()` is
called. It used to be called two frames after the Print button, while the dialog was still animating
out and the page was still locked for scrolling (`body` overflow hidden). Safari's first preview then
spilled sheets onto a second page, and came right only when changing a setting in its dialog made it
lay the page out again. Now `print()` waits until no dialog remains and the lock is off, for at most
1.5 s. "Print deck" for the tickets goes through the same wait, with two frames at least because the
cards' styles are applied after the print tree swaps to them. The regression suite clicks Print on screen, as a person does, to catch this; switching to print
media first skipped the animation and hid the fault.

**Safari's first layout is shorter.** When its print dialog opens, Safari's first layout has about
264 mm down an upright A4 page; as soon as any setting in the dialog is changed it lays the page out
again with more room. A 274 mm sheet (one sheet of A4) spilled about 10 mm onto a second page, a
268 mm full-size sheet spilled as well (18 pages for 9), and every later layout fitted, with headers
and footers on or off. Two explanations were tested and failed: the dialog still animating out when
`print()` was called (fixed anyway, see above), and Safari applying the `@page` margin on the first
pass only (a 5 mm margin changed nothing).

So Safari gets its own print profile, `PRINT_PROFILES.safari`: 21 mm clear at each end of the long
side instead of 10, which caps a sheet on A4 at 255 mm, cut marks included. The editor finds Safari
from its user agent after mounting; the dialog's table, summary and print tree all use the profile, and
the dialog says why the counts differ. In Safari, full size is 12 sheets of A4 (9 elsewhere), 6 of A3,
12 of Letter and 9 of Tabloid; Anniversary is 16 of A4 and 20 of Letter; a 2×4 is 15 of A4; one sheet
of A4 is 32 %. Per panel is unchanged, because the panel's height decides it.

Safari's headers and footers (title, date, URL, page number) are a setting in its print dialog, which
Safari remembers; a page cannot switch them off. Chrome drops them when the margin is too small for
them. So the layout is made to fit with them on.

## The dialog

- **What to print is the first choice**: three tick boxes, the board, the tickets and the rules
  (`PrintParts` in `app/map-print.tsx`), in any combination. They print in that order in one tree: the
  board pages, then `.print-tickets` (the cards of the deck being worked on, four to a row), then
  `.print-rules`. Each part after the first starts on a page of its own. The paper chosen in the dialog
  sets the page for all of them. The choice is kept in `localStorage` as `ttr-print-parts`; the single
  word an earlier build kept in `ttr-print-rules` (`board`, `both`, `rules`, `off`, `on`) is still read.
  Without the board in the run, how it is split, Supersize and the sheet table are hidden and the paper
  stays. A deck with no tickets has no cards to tick, a map with no rules text has no rules, and with
  nothing ticked Print is off. The summary says how many sheets the cards take (`cardSheets` in
  `app/print-plan.ts`), and a test checks that it is the number of pages the browser prints. The
  "Print deck" button in the Tickets panel prints just the cards, whatever is ticked.
- **One page, real size** is a fourth way to split. The page is the board's own size (the board, the
  caption above it and the 10 mm margin all round: 810 × 553 mm for the standard board, 1073 × 554 mm
  for the extended one), upright and not turned, at 100 %. It is for a plotter or a large-format printer,
  or to save as a PDF. The paper chosen does not matter, so the paper, Supersize and the sheet table are
  hidden; nothing else fits on such a page, so the tickets and the rules print apart. Safari ignores the
  size of a page, so there the dialog says to add a custom paper size in Safari's own dialog. A test saves
  the page as a PDF and reads the size from the PDF itself.
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
