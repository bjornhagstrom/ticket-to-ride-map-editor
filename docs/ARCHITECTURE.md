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
9. Fold guides

Changing this order can alter pointer behaviour as well as appearance. Notes are deliberately drawn above the map content so they stay readable; they are not considered part of the map itself and are therefore excluded from Background only and Network only exports.

## Customisable route styling

Route appearance is data, not code. `MapData.routeTypeStyles` is a user-editable array (label, thickness, dash pattern, a fallback stroke colour, and an `infrastructure` flag that hides the colour picker and wagon slots for pre-built types like rail/trail). A type's `stroke` is only drawn for infrastructure types: everything claimed with train cards takes its colour from `Route.color`, so a type is identified by line shape alone and any two routes of one type may differ in colour. `Route.type` is a plain `string` id into that array rather than a fixed TypeScript union, so a map can rename, restyle or delete the six default types and add its own. `MapData.lineStyles` is a separate, similarly user-editable array for one-off per-route overrides (thickness/dash only, no colour), letting a single route be flagged as a special case on top of its type's normal appearance. Both arrays travel with full-map and network-only exports; `defaultRouteTypeStyles` in `map-data.ts` is the fallback seed for older files and new maps.

## Route geometry

A route's shape is `Route.points`: any number of bend points between its two stops, each draggable, insertable at any segment via the `+` handles drawn beside a selected route, and removable by double-clicking. `Route.curved` switches the drawing from straight segments (`pathFromPoints`) to a Catmull-Rom spline converted to cubic Béziers (`curveControls`/`curvedPath`). Because wagon spaces are positioned by walking the polyline, a curved route is also flattened into a denser sample list (`curvedSamples`, 12 points per segment) before slot placement, so the spaces sit on the visible curve and rotate with it rather than following the underlying control polygon.

## True-scale wagons

By default the wagon spaces are spread evenly along a route at `(index + 0.5) / length`, which is good for sketching but says nothing about whether the route is physically long enough. The optional true-scale view instead sizes each space from `realWagon` (20 × 9 mm, 2 mm gap) and lays the spaces edge to edge from the centre of the route. The conversion divides by the width of the board the map is *for*, not the paper it is printed on: a board format is measured against itself, so printing it at full size yields exactly 20 mm wagons, while a format marked `testSheet` is a shrunken proof of a target board (chosen in the Tools panel, default the standard 2×3) and therefore shows the board's own layout, printing smaller along with everything else. This matches how the sheets are used — marked up with coloured pens, not played with real components. A route whose drawn length is shorter than `length × pitch` gets a `too-tight` class and a red outline, and the count is surfaced in the Tools panel. This is a view mode only: nothing about it is stored in `MapData`.

## Balance analysis and route suggestions

`app/map-editor.tsx` includes a small graph layer computed purely from `data.stops`/`data.routes`, with no separate module and no new persisted data:

- `buildAdjacency`/`networkStats` treat stops as nodes and routes as weighted edges (weight = `route.length`) to compute, per stop, neighbour count, a weighted "links" degree (parallel `Route` records between the same pair count extra — the app's stand-in for a spreadsheet-style `Double` flag, since routes don't carry one), and a combined "hub degree". Infrastructure-type routes count as real, traversable edges here; they are only excluded from crossing detection.
- `shortestPath` is a plain O(V²) Dijkstra (no heap, no dependency — the graphs this app deals with are small) used by the Measure tool to report the shortest route-length distance between two clicked stops.
- `colourLengthTable` cross-tabulates non-infrastructure routes by colour and length, mirroring a classic hand-built balance check (are all the length-3 routes the same colour?).
- `suggestRoutes` proposes new routes: k-nearest-neighbour candidates by canvas distance, filtered to exclude already-connected pairs and any pair whose straight line would cross an existing route (reusing the same `intersects`/`orient` primitives as `crossingPairs`), then ranked by combined hub degree of the two endpoints so suggestions favour filling in under-connected stops first. A suggested length is scaled from the map's own existing distance-to-length ratio; a suggested colour is whichever colour is least represented at that length in `colourLengthTable`.

All of this is `useMemo`d off `data` exactly like `crossingPairs`, and surfaces as: an always-visible sidebar card (low-connection-stop count), an "Analyze balance" dialog (the hub-degree table and colour×length table), a "Measure distance" tool mode, and a "Suggest routes" dialog with one-click "Add" buttons that create ordinary `Route` records — suggestions are never auto-applied.

## Persistence boundary

Current persistence is deliberately device-local:

- no map data is sent to Websupport;
- different browsers do not share data;
- clearing browser storage removes the auto-saved copy;
- JSON export is the only portable backup.

Shared maps and live collaboration require a server API, central storage and an access model. That work is tracked in `BACKLOG.md`.

## Printing

A hidden print-only tree renders one page for A4/A3 formats and one reduced A4 proof per panel for foldable formats. The foldable proof is not a full-scale production file. Its caption states the approximate reduction percentage.

## Known structural debt

`app/map-editor.tsx` currently combines state management, editing interactions, forms, printing and SVG rendering, and has grown further with each added object type (background image, notes, per-type and per-route line styles). Properties panels and pickers are already split into function components within the file (`StopProperties`, `RouteProperties`, `RouteTypeEditor`, `LineStylePicker`, `NoteProperties`, `BackgroundImageProperties`, `BackgroundProperties`), but everything still lives in one module. Logical extraction candidates into separate files are:

- persistence and file import/export;
- board-format conversion;
- print-page generation;
- background and background-image renderers;
- route and route-type-style renderers;
- properties panels (already componentised, just not yet split out).

Refactoring should preserve the stored JSON shape and local-storage key unless an explicit migration is added.
