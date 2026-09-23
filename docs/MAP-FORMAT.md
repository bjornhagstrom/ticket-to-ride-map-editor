# Map project format

Map projects are UTF-8 JSON files. A full export contains the map name, selected board format, background objects, stops and routes. Background-only and network-only exports carry just their own part of the map, plus the board format needed to interpret their coordinates.

There is currently no explicit `schemaVersion` field. Compatibility is handled by `normalizeMap`, `normalizeBackgroundFile` and `normalizeNetworkFile` when a file or browser state is loaded. Adding versioned migrations is recommended before the format grows substantially.

Every exported filename ends with the local date and time it was saved, as `-YYYYMMDD-HHmmss` (for example `example-map-20260922-211854.json`), so repeated exports of the same map sort chronologically and never silently overwrite one another.

## Top-level shape

```json
{
  "kind": "map",
  "name": "Example map",
  "format": "board-2x3",
  "background": [],
  "stops": [],
  "routes": []
}
```

The `kind` field identifies what a file contains. `"map"` (or a missing `kind`, for compatibility with files exported before this field existed) is a full map and replaces everything on import. The Import action reads this field to decide what to do with a file — there is no separate control for choosing the import type.

## Background-only and network-only files

The Export menu can also produce two narrower files:

```json
{ "kind": "background", "format": "board-2x3", "background": [] }
```

```json
{ "kind": "network", "format": "board-2x3", "stops": [], "routes": [] }
```

Importing one of these only replaces its own part of the current map (background objects, or stops and routes) and leaves the rest untouched. If that part already has content, the editor asks for confirmation before replacing it. Coordinates are rescaled from the file's `format` to the current map's format on import, the same way a full map is rescaled when you change board format.

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

Supported stop types are `city`, `region`, `brt`, `rail`, `ferry` and `outing`. `size` is optional (`small`, `medium` or `large`; missing means `medium`) and only affects how large the stop is drawn — some expansions give meaning to stop size, such as marking major cities.

`symbol` is optional (`none`, `dot`, `dash`, `cross` or `letter`; missing means `none`) and draws a small marker centred on the stop, independent of its type, for rules of your own. When `symbol` is `letter`, `letter` holds the one- or two-character text to draw (falls back to `"A"` if empty).

## Routes

```json
{
  "id": "route-1",
  "a": "stop-west",
  "b": "stop-central",
  "length": 4,
  "type": "city",
  "color": "red",
  "points": [{ "x": 265, "y": 235 }, { "x": 320, "y": 300 }],
  "curved": true,
  "locomotiveSlots": [1],
  "lineStyle": "style-tunnel"
}
```

`a` and `b` reference stop IDs. `points` is optional and contains any number of movable bend points between the two stops. `type` references the `id` of an entry in the map's `routeTypeStyles` list (see below) — `city`, `region`, `brt`, `ferry`, `rail` and `trail` by default, but any map can rename, restyle, delete or add to that list.

Two or more routes between the same pair of stops form a double route: they are automatically drawn side by side, each keeping its own `color`, `length` and type. Nothing in the file marks them as a pair — being between the same two stops is enough. The sideways offset is applied to every point of the line, bend points included, so siblings sharing the same `points` run exactly parallel and bend together; they converge only over a short run-in at each stop, which both lines have to reach. Bend points, the smooth-curve setting and Straighten route are applied to every line of a double route at once, so shaping one shapes them all and they stay parallel. Untick **Shape the parallel lines together with this one** in the Properties panel to edit just the selected line, which is how you make them separate.

`curved` is optional. When `true` the route is drawn as a smooth Catmull-Rom curve through its bend points instead of straight segments; the wagon slots are placed along the curve and rotate with it. A route needs at least one bend point for the setting to have a visible effect. Select a route and use the `+` handles beside it to add a bend anywhere along the line, drag a bend to move it, and double-click one to remove it.

`locomotiveSlots` is optional and lists the zero-based wagon-slot indices (out of `length`) that must be covered with a locomotive card, drawn with a small engine icon. Toggle it by clicking a wagon slot on a selected route.

`lineStyle` is optional and references the `id` of an entry in the map's `lineStyles` list (see below). It overrides one specific route's line thickness and dash pattern on top of its type's own appearance, to flag that this particular route follows some special rule.

## Route type styles

`routeTypeStyles` is a map-level array defining every route type's default appearance — this is what makes, for example, a railway look different from a ferry:

```json
{ "id": "rail", "label": "Railway", "stroke": "#292b2f", "dash": "4 4", "strokeWidth": 4, "infrastructure": true }
```

A type is told apart by **thickness and dash pattern, never by colour**. Every route a player claims with train cards is drawn in its own `color` (from the standard nine-colour deck, with `neutral` drawn grey), so two routes of the same type can and normally do have different colours. `stroke` is therefore only drawn for types with `infrastructure: true`, which have no train cards and so no colour of their own; on any other type it is stored but unused. `dash` is an SVG `stroke-dasharray` (`""` for solid) and `strokeWidth` the line thickness in canvas units. `infrastructure: true` marks a pre-built type with no train cards and no wagon slots (drawn as a continuous line, like the default `rail` and `trail`); `false` marks a type that shows wagon slots, a colour choice and can take locomotive requirements (like `city`, `region`, `brt` and `ferry`).

Create, rename, restyle and delete types from the Route type control in the Draw route tool (sets the default for new routes) or in a selected route's Properties panel (changes that route's type and, through it, every other route sharing it). A type cannot be deleted while any route still uses it, or if it is the map's only remaining type. `routeTypeStyles` travels with full-map and network-only exports.

## Line styles

`lineStyles` is a map-level array of reusable, user-defined line appearances:

```json
{ "id": "style-tunnel", "label": "Tunnel", "strokeWidth": 7, "dash": "2 5" }
```

`dash` is an SVG `stroke-dasharray` value (`""` for a solid line). Create, edit and delete styles from a route's Properties panel, or set a default style in the Draw route tool so every route you draw next picks it up automatically. Deleting a style clears `lineStyle` on any route that used it, falling back to that route's default appearance. `lineStyles` travels with full-map and network-only exports (it is route-related, not background-related).

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

## Background image

`backgroundImage` is optional and holds at most one raster image, placed behind background objects, routes and stops:

```json
{
  "dataUrl": "data:image/png;base64,...",
  "naturalWidth": 1800,
  "naturalHeight": 1200,
  "x": 100,
  "y": 80,
  "width": 900,
  "height": 600,
  "rotation": 0,
  "opacity": 1,
  "crop": { "top": 0, "right": 0, "bottom": 0, "left": 0 },
  "locked": false
}
```

The image is embedded directly as a base64 `dataUrl`, so the project file stays a single portable JSON document — this can make it large, and the editor warns when an imported image is over about 2 MB. `x`/`y`/`width`/`height` place the image on the canvas in the same coordinate space as everything else, independent of `naturalWidth`/`naturalHeight` (the source image's real pixel size). `rotation` is in degrees around the image's own centre. `crop` insets are fractions (0–0.45) of the natural size cropped from each edge before the remaining area is stretched to fill the placement rectangle. `backgroundImage` is part of both full-map exports and background-only exports, and is replaced as a whole (not merged) whenever a background-only file is imported.

## Notes

`notes` is a map-level array of free-form evaluation annotations, shown on screen and in print but not part of the map itself:

```json
{
  "id": "note-1",
  "x": 760,
  "y": 60,
  "width": 250,
  "height": 110,
  "text": "Evaluation note: playtesters found this junction confusing.",
  "locked": false
}
```

Notes are only part of full-map exports, not background-only or network-only exports, since they are neither background art nor game network.

## Compatibility rules

- Missing `background` becomes an empty array, supporting older map files.
- Missing `notes` or `lineStyles` becomes an empty array.
- Missing or empty `routeTypeStyles` falls back to the six default types (`city`, `region`, `brt`, `ferry`, `rail`, `trail`).
- Missing or unknown `format` becomes `board-2x3`.
- Missing or unrecognized `kind` is treated as a full map (`"map"`).
- Missing or invalid `backgroundImage` is dropped; a map with no image simply omits the field.
- Missing `size` on a stop is treated as `medium`.
- Unknown object types are not currently validated at runtime.
- IDs must be unique within their object category.
- Routes should reference existing stops, and `lineStyle` should reference an existing entry in `lineStyles`.

Do not rename format IDs, object types or the local-storage key without providing a migration path.
