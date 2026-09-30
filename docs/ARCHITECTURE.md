# Architecture

## Overview

The map editor is a client-side Next.js application exported as static files. It has no application server, accounts or shared database. Websupport serves the generated files from `/ttr`.

```text
Browser
  ├─ React editor state
  ├─ SVG map renderer
  ├─ localStorage auto-save
  └─ JSON import/export

Static hosting
  └─ Next.js export from out/
```

## Application flow

1. The application initially renders `emptyMap`, a genuinely blank map.
2. After the browser is available, it checks local storage.
3. If stored data exists, `normalizeMap` loads it and supplies defaults for older files; the welcome guide is marked as seen and does not appear.
4. If no stored data exists and the guide has not been dismissed before, the welcome guide opens automatically, offering a blank map or `initialMap` (the neutral example) — the example is never loaded implicitly.
5. Every later map change is serialized to local storage.
6. JSON export downloads the complete `MapData` object (or, for the Background only / Network only options, a narrower object identified by a `kind` field).
7. JSON import inspects `kind` to decide whether to normalize and replace the whole map, or to normalize and merge just the background or network part, confirming first if that part already has content.

This ordering means a first-time visitor always makes an explicit choice before either map is loaded, and an existing locally saved map is never silently replaced.

## Module layout

The editor is split by responsibility, with dependencies pointing one way and no cycles:

| Module | Responsibility |
| --- | --- |
| `app/map-data.ts` | Types, board formats, colours, real-component sizes, the empty and example maps |
| `app/map-geometry.ts` | Route geometry: bend points, parallel offsets, curves, point-along-line, segment intersection |
| `app/map-analysis.ts` | Everything derived from the network: hub degree, shortest path, colour×length, route suggestions, room per wagon |
| `app/map-storage.ts` | Local-storage keys, file normalizers, board-format rescaling, image reading |
| `app/map-artwork.tsx` | The SVG layer stack, object renderers and editing handles |
| `app/map-properties.tsx` | The Properties panel editors, which apply styles but never define them |
| `app/map-styles.tsx` | The style library dialog, where every kind of reusable appearance is created and edited |
| `app/map-dialogs.tsx` | Welcome guide, balance report, route suggestions |
| `app/map-print.tsx` | The hidden print tree |
| `app/map-editor.tsx` | Editor state, pointer interactions and the surrounding layout |

`map-geometry` and `map-analysis` are pure: no React, no DOM, no storage. That is what makes the
balance numbers testable straight from a `MapData` object.

## State and history

`MapEditor` owns the active `MapData` plus transient interface state such as the selected tool, selected object and drag target.

Normal edits pass through `change()`. Before applying an edit it stores a deep copy in an in-memory undo history. History is limited to 200 states and is not retained after a reload. Continuous pointer dragging updates the active map directly to avoid creating one undo entry for every pointer movement; a single snapshot is taken when a drag begins and committed only if the pointer actually moved. Snapshots share the background image's base64 string rather than copying it, which is what makes a deep history affordable.

## Coordinate system

The SVG coordinate width is always 1,100 units. Each board format calculates its SVG height from its physical aspect ratio. Object coordinates are therefore editor units, not millimetres.

Changing format keeps the x-coordinate unchanged and scales every y-coordinate by the ratio between the old and new canvas heights. This keeps objects in approximately the same relative positions.

Physical finished dimensions belong to the format definition in `map-data.ts`. Do not infer physical measurements directly from SVG units.

## Render order

The SVG layers are rendered in this order:

1. Paper colour and editor grid
2. Background image (at most one, raster, optionally cropped/rotated)
3. Background areas, lines and labels
4. Draft background geometry (while drawing a new shape)
5. Routes, vehicle spaces and locomotive markers
6. Stops, stop symbols/letters and stop labels
7. Evaluation notes
8. Editing handles (bend points, bend insert handles, resize/rotate handles — hidden in print)

Selecting an object shows `MapHint`, one shared box over the canvas that says what can be done with
it directly on the map. Routes and stops supply their own title and text; the box itself owns the
placement (whichever edge of the board the object is furthest from), the collapse state and the
sideways offset, both remembered in local storage. Its sticky positioning carries a `left` offset as
well as a vertical one, because sticky pins only the axes it is given offsets for and a map wider
than the window would otherwise carry the box off the side, so the two kinds of object cannot drift apart in
behaviour. Its storage keys still say `route-hint` so existing browsers keep the setting.

Editing handles are drawn beside the line rather than on it: `+` handles on one side, bend grips on
the other, each `HANDLE_OFFSET` units out with a smaller `HANDLE_HIT` grab radius. The gap between
them has to stay wider than half a wagon space, or a handle's invisible hit area swallows the click
that toggles a locomotive on the space beneath it. The offset is measured from the line as drawn,
which for a double route is `parallelOffset` units to the side of the centre line that `Route.points`
actually stores.
9. Fold guides

Changing this order can alter pointer behaviour as well as appearance. Notes are deliberately drawn above the map content so they stay readable; they are not considered part of the map itself and are therefore excluded from Background only and Network only exports.

## Applying a style versus defining one

These are deliberately separate. The Properties panel is about the object you clicked, so it only
offers a select to apply an existing style, plus an Edit button. Defining styles happens in one
place, `StyleLibraryDialog`, which holds stop types, route types, wagon styles and line styles
side by side. The Edit button opens that dialog on the right kind with the right style selected, so
you can get from an object to the definition behind it in one click without the panel having to
carry a full editor for every kind of appearance.

## Customisable route styling

Route appearance is data, not code. `MapData.routeTypeStyles` is a user-editable array (label, thickness, dash pattern, a fallback stroke colour, and an `infrastructure` flag that hides the colour picker and wagon slots for pre-built types like rail/trail). A type's `stroke` is only drawn for infrastructure types: everything claimed with train cards takes its colour from `Route.color`, so a type is identified by line shape alone and any two routes of one type may differ in colour. `Route.type` is a plain `string` id into that array rather than a fixed TypeScript union, so a map can rename, restyle or delete the six default types and add its own. `MapData.lineStyles` is a separate, similarly user-editable array for one-off per-route overrides (thickness/dash only, no colour), letting a single route be flagged as a special case on top of its type's normal appearance. Both arrays travel with full-map and network-only exports; `defaultRouteTypeStyles` in `map-data.ts` is the fallback seed for older files and new maps.

## Route geometry

A route's shape is `Route.points`: any number of bend points between its two stops, each draggable, insertable at any segment via the `+` handles drawn beside a selected route, and removable by double-clicking. `Route.curved` switches the drawing from straight segments (`pathFromPoints`) to a Catmull-Rom spline converted to cubic Béziers (`curveControls`/`curvedPath`). Because wagon spaces are positioned by walking the polyline, a curved route is also flattened into a denser sample list (`curvedSamples`, 12 points per segment) before slot placement, so the spaces sit on the visible curve and rotate with it rather than following the underlying control polygon.

## Board proportions

Several sizes are set to print at roughly what a real board uses, all measured against
`REFERENCE_BOARD_MM`: a wagon space is `realWagon`'s 20 × 9 mm, the lines of a double route sit
`PARALLEL_SPACING_MM` apart (a wagon's width plus 2.5 mm), and a stop circle is about 9 mm across at
the medium size. Stop circles used to be half again that, which pushed the first wagon of every
route away from its stop and made double routes look detached. Because the circles are now small,
each stop carries an invisible `stop-hit` circle so it stays comfortable to click.

## Wagon spacing

Wagon spaces are laid out in millimetres, not in canvas units. Sizes convert through the board the map is
for, the 2×3 or 2×4 board it is drawn for, whatever it is printed on. A space is drawn at
`realWagon`'s real size and the spaces are placed at the real board's pitch, centred on the route,
so a route always looks the way it will play. There was briefly a True-scale toggle for this; once
the default view was calibrated the toggle did nothing on a standard board, so it was removed. Only when the wagons will not fit does the route fall back to
spreading them evenly over whatever room it has.

Before the wagons are placed, room is reserved at each end: that stop's own radius plus its gap
setting, capped at 30% of the route. The gap is `Stop.endGapMm` if the stop sets one, otherwise
`MapData.endGapMm`, otherwise `DEFAULT_END_GAP_MM`. Because it is resolved per stop, the two ends of
one route can differ — useful where a line runs from a crowded hub into open space. Two millimetres is
the measured sweet spot on the imported Europe map — it holds the median spacing at the real board's
25.5 mm while leaving about 3 mm of clear paper around every stop, and past about four the wagons
start being squeezed out of real spacing. The Tools panel exposes it as a slider, and it is stored
in the map so print and export agree with the screen.

`realWagon`'s spacing figures are calibrated rather than guessed. Fitting `distance = pitch × wagons + margin`
by least squares over all 101 routes of the published Ticket to Ride Europe map gives 25.6 mm per wagon
space and 14.8 mm of end margin, and scored against that model the real board lands between 97% and 106%
at every route length. `routeSpacing` uses that formula for its verdicts, so "100%" means "drawn about as
long as a real board would draw it". Re-running that fit is the way to revise the constants, not adjusting
them by eye. Note that the renderer's end reservation is a separate, simpler rule (stop radius plus the
map's gap) — the fitted `endMargin` is what the analysis judges against, not what the renderer draws.

## Balance analysis and route suggestions

`app/map-editor.tsx` includes a small graph layer computed purely from `data.stops`/`data.routes`, with no separate module and no new persisted data:

- `buildAdjacency`/`networkStats` treat stops as nodes and routes as weighted edges (weight = `route.length`) to compute, per stop, neighbour count, a weighted "links" degree (parallel `Route` records between the same pair count extra — the app's stand-in for a spreadsheet-style `Double` flag, since routes don't carry one), and a combined "hub degree". Infrastructure-type routes count as real, traversable edges here; they are only excluded from crossing detection.
- `shortestPath` is a plain O(V²) Dijkstra (no heap, no dependency — the graphs this app deals with are small) used by the Measure tool to report the shortest route-length distance between two clicked stops.
- `routeSamplePoints`/`labelCovers`/`labelAngleOptions` test a stop's name box against the drawn route lines, to flag names printed over a route and to offer a clear bearing. `autoPlaceLabels` turns the whole map's names at once: it works through the stops with the fewest clear bearings first so the hemmed-in ones get the good spots, keeps a name that is already fine where it is, avoids the names it has already placed, and reports the stops it could not solve instead of shuffling them. Text width is estimated from the character count rather than measured in the DOM, which keeps the analysis layer pure at the cost of erring slightly wide.
- `colourLengthTable` cross-tabulates non-infrastructure routes by colour and length, mirroring a classic hand-built balance check (are all the length-3 routes the same colour?).
- `suggestRoutes` proposes new routes: k-nearest-neighbour candidates by canvas distance, filtered to exclude already-connected pairs and any pair whose straight line would cross an existing route (reusing the same `intersects`/`orient` primitives as `crossingPairs`), then ranked by combined hub degree of the two endpoints so suggestions favour filling in under-connected stops first. A suggested length is scaled from the map's own existing distance-to-length ratio; a suggested colour is whichever colour is least represented at that length in `colourLengthTable`.

All of this is `useMemo`d off `data` exactly like `crossingPairs`, and surfaces as: an always-visible sidebar card (low-connection-stop count), a "Map balance" panel in the right column (bottlenecks, game setup, the hub-degree table and colour×length table; pointing at a row marks its stop or routes on the map), a "Measure distance" tool mode, and a "Suggest routes" panel in the same column with one-click "Add" buttons that create ordinary `Route` records — suggestions are never auto-applied.

## Persistence boundary

Current persistence is deliberately device-local:

- no map data is sent to Websupport;
- different browsers do not share data;
- clearing browser storage removes the auto-saved copy;
- JSON export is the only portable backup.

Shared maps and live collaboration require a server API, central storage and an access model. That work is tracked in `BACKLOG.md`.

## Printing

The board's shape lives in the map; how it is printed does not. `app/print-plan.ts` turns a board and a print choice — split (one sheet, per panel, full size), paper (A4, A3, US Letter, Tabloid) and, for a 2×3, an Anniversary size tick that implies full size — into a plan: the page in millimetres with its orientation, the scale, and one tile per page as a share of the board. It allows a 10 mm printer margin and an 8 mm caption on every page, lays every sheet out landscape and turns it on an upright page, and never enlarges a panel beyond full size. `tests/print-plan.cjs` pins its figures.

`PrintDialog` in `app/map-print.tsx` offers the choices and a table of every combination, all computed by the same `printPlan`, so the table cannot disagree with what is printed. The choice is kept in `localStorage` under `ttr-print-choice`, never in the map or the undo history.

`PrintPages` renders the plan into a hidden print-only tree. A single global `@page` rule declares the paper and a 10 mm margin, because only one plan is live at a time; the page box is the paper less that margin with no fixed height, so a browser that ignores `@page` margin (Safari) cannot spill onto blank sheets. Captions and tiles get their size inline in millimetres from the plan. Named `@page` rules were tried first; print dialogs do not honour them reliably, and a global rule with explicit dimensions does. Everything outside the print tree is hidden so no blank trailing sheet is produced. Full-size sheets carry cut marks at the tile corners instead of a border, to be trimmed and butted.

The arithmetic behind every sheet count, why the page box is smaller than the paper, the rules that keep the dialog still, and how printing is tested are in `docs/PRINTING.md`.

## Testing

`tests/regression.cjs` is the only automated test: a Playwright script that drives the running
editor and asserts on what it finds in the DOM and in local storage. It covers the interactions
that have broken before rather than aiming for coverage, and it needs `npm run dev` in another
terminal. There are no unit tests, and nothing runs in CI.

Because it asserts against rendered geometry — wagon spacing in millimetres, stop circle diameter,
parallel line separation — it is also where the calibrated constants in `map-data.ts` are pinned.
Changing `realWagon` or `stopSizeMeta` without updating the suite will fail it, which is intended.

## Known structural debt

`app/map-editor.tsx` still owns all editor state and every pointer interaction in one component, which is the largest remaining lump. The pointer logic in particular (`onCanvasDown`, `onCanvasMove`, `stopDragging` and the seven drag refs they share) is the part most likely to be worth extracting next, probably into a hook.

Lint is clean as of the ticket work. Three things had been failing since before the module split:
apostrophes inside JSX text, the undo/redo refs being assigned during render rather than in an
effect, and the hint preference being read from local storage through a `setState` in an effect. The
last one is now read straight into the initial state instead, which is safe here because the hint
only renders once something is selected — it cannot appear during prerender, so there is nothing for
it to mismatch against.

Any refactoring must preserve the stored JSON shape and the local-storage key unless an explicit migration is added.
