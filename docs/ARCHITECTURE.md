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

Normal edits pass through `change()`. Before applying an edit it stores a deep copy in an in-memory undo history. History is limited to 40 states and is not retained after a reload. Continuous pointer dragging updates the active map directly to avoid creating one undo entry for every pointer movement.

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
8. Editing handles (waypoints, resize/rotate handles — hidden in print)
9. Fold guides

Changing this order can alter pointer behaviour as well as appearance. Notes are deliberately drawn above the map content so they stay readable; they are not considered part of the map itself and are therefore excluded from Background only and Network only exports.

## Customisable route styling

Route appearance is data, not code. `MapData.routeTypeStyles` is a user-editable array (label, line colour, thickness, dash pattern, and an `infrastructure` flag that hides the colour picker and wagon slots for pre-built types like rail/trail). `Route.type` is a plain `string` id into that array rather than a fixed TypeScript union, so a map can rename, restyle or delete the six default types and add its own. `MapData.lineStyles` is a separate, similarly user-editable array for one-off per-route overrides (thickness/dash only, no colour), letting a single route be flagged as a special case on top of its type's normal appearance. Both arrays travel with full-map and network-only exports; `defaultRouteTypeStyles` in `map-data.ts` is the fallback seed for older files and new maps.

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
