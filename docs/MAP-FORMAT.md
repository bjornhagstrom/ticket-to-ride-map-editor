# Map project format

Map projects are UTF-8 JSON files. A full export contains the map name, selected board format, background objects, stops and routes.

There is currently no explicit `schemaVersion` field. Compatibility is handled by `normalizeMap` when a file or browser state is loaded. Adding versioned migrations is recommended before the format grows substantially.

## Top-level shape

```json
{
  "name": "Example map",
  "format": "board-2x3",
  "background": [],
  "stops": [],
  "routes": []
}
```

## Board formats

| ID | Finished size | Layout |
| --- | --- | --- |
| `board-2x3` | 790 × 525 mm | Standard 3 columns × 2 rows |
| `board-2x3-large` | 972 × 648 mm | Large 3 columns × 2 rows |
| `board-2x4` | 1,053 × 526 mm | Custom 4 columns × 2 rows |
| `a4` | 297 × 210 mm | One landscape sheet |
| `a3` | 420 × 297 mm | One landscape sheet |
| `us-letter` | 279.4 × 215.9 mm (11 × 8.5 in) | One landscape sheet |

Files without a recognized format open as `board-2x3`.

## Coordinates

All geometry uses SVG editor coordinates, for example `{ "x": 420, "y": 345 }`. The logical canvas is 1,100 units wide. Height depends on the selected format. Coordinates are rescaled vertically when the format changes.

## Stops

```json
{
  "id": "stop-central",
  "name": "Central",
  "type": "rail",
  "x": 420,
  "y": 345
}
```

Supported stop types are `city`, `region`, `brt`, `rail`, `ferry` and `outing`.

## Routes

```json
{
  "id": "route-1",
  "a": "stop-west",
  "b": "stop-central",
  "length": 4,
  "type": "city",
  "color": "red",
  "points": [{ "x": 265, "y": 235 }]
}
```

`a` and `b` reference stop IDs. `points` is optional and contains movable intermediate waypoints. Supported route types are `city`, `region`, `brt`, `ferry`, `rail` and `trail`.

## Background objects

Background objects have type `area`, `line` or `label`:

```json
{
  "id": "background-lake",
  "type": "area",
  "label": "Lake",
  "labelPoint": { "x": 575, "y": 320 },
  "points": [{ "x": 455, "y": 205 }],
  "fill": "#b8ddea",
  "stroke": "#4f8394",
  "opacity": 0.65,
  "strokeWidth": 3,
  "locked": true
}
```

For an area, `points` defines a polygon. For a line it defines a polyline. A label uses its first point as its position. `labelPoint` is optional and overrides the automatically calculated label position for areas and lines.

## Compatibility rules

- Missing `background` becomes an empty array, supporting older map files.
- Missing or unknown `format` becomes `board-2x3`.
- Unknown object types are not currently validated at runtime.
- IDs must be unique within their object category.
- Routes should reference existing stops.

Do not rename format IDs, object types or the local-storage key without providing a migration path.
