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

1. The application initially renders `initialMap`, the neutral example map.
2. After the browser is available, it checks local storage.
3. If stored data exists, `normalizeMap` loads it and supplies defaults for older files.
4. Every later map change is serialized to local storage.
5. JSON export downloads the complete `MapData` object.
6. JSON import normalizes the file before replacing the active map.

This ordering ensures that existing locally saved maps take precedence over the example.

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
2. Background areas, lines and labels
3. Draft background geometry
4. Routes and vehicle spaces
5. Stops and stop labels
6. Editing handles
7. Fold guides

Changing this order can alter pointer behaviour as well as appearance.

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

`app/map-editor.tsx` currently combines state management, editing interactions, forms, printing and SVG rendering. Logical extraction candidates are:

- persistence and file import/export;
- board-format conversion;
- print-page generation;
- background renderer;
- route renderer;
- properties panels.

Refactoring should preserve the stored JSON shape and local-storage key unless an explicit migration is added.
