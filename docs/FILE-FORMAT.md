# The file format

What the editor writes and reads, and what you can rely on if you share files with someone else.

The format is versioned so that it can grow. This document is the contract: what is guaranteed,
what may change, and how a reader should behave when it meets something it does not understand.

## The envelope

Every file has the same wrapper.

```json
{
  "format": "ticket-to-ride-map",
  "version": 2,
  "kind": "map",
  "written": "2026-09-29T15:12:00.000Z",
  "app": { "name": "Map prototypes", "version": "0.1.0" },
  "board": { "width": 1100, "height": 731 },
  "payload": { }
}
```

| Field | What it is |
| --- | --- |
| `format` | Always `ticket-to-ride-map`. A file without it is a version 1 file (see below). |
| `version` | The schema this file follows. Currently 2. |
| `kind` | `map`, `background`, `network` or `tickets`. |
| `written` | When it was written, ISO 8601. For your information; nothing depends on it. |
| `app` | What wrote it. For tracing a problem back to a build. |
| `board` | The frame the coordinates are in. Positions in the payload are in these units. |
| `payload` | The content. Its shape depends on `kind`. |

The payload has its own key on purpose. In version 1 the map's fields sat directly on the top
level, which meant a new file-level field could collide with a map field of the same name.

## The four kinds

**`map`** — a whole project: the board format, the background, stops, routes, notes, every style,
every ticket deck, and the game setup. This is the one to send if you want someone to have your map
as you see it.

**`network`** — stops and routes only, with the styles those objects refer to and any tickets that
belong to them. For lifting a network onto another background, or for sharing a transcribed board.
It carries `stopTypeStyles`, `routeTypeStyles`, `wagonStyles` and `lineStyles` filtered down to the
ones actually used, so nothing it refers to is missing.

**`background`** — background shapes and the background image. For sharing artwork without giving
away the network.

**`tickets`** — one or more decks. Each ticket carries `aName` and `bName` beside its stop ids, so a
deck can be moved to another copy of a map where the ids differ but the cities are the same.

## Rules a reader follows

1. **No envelope means version 1.** Every file the editor wrote before the envelope existed still
   opens. `kind` sat beside the data; if it is missing the file is taken as a map.
2. **A newer version is refused, not guessed at.** If `version` is higher than the reader
   understands, it says so and names both versions. It never opens the file part way and drops the
   rest.
3. **Unknown fields survive.** Anything the reader does not recognise is carried along and written
   back out unchanged. Two people on different versions can pass a file back and forth without
   either of them destroying what the other added. This is the property that makes the format safe
   to share before it has settled.
4. **A file carries what it refers to.** No file points at a style it does not include.

## What you can rely on

- The envelope fields above, and their meaning.
- The four kinds, and that a file of a given kind keeps its shape within a major version.
- Ids are opaque strings, unique within a file. Do not read anything into their form.
- Coordinates are numbers in the `board` frame. A map opened at a different board size is rescaled
  by the reader.
- Unknown fields are preserved.

## What may change

- New fields may appear in any payload at any time. A reader that does not know them keeps them.
- Default values may change. A field that is absent takes the reader's current default, which is why
  writing a field explicitly is safer than relying on the default staying put.
- The style lists are the map's own vocabulary, not a fixed set. Do not assume any particular style
  id exists, apart from those a new map starts with.

## Versions

| Version | What changed |
| --- | --- |
| 1 | The original files: `kind` beside the data, no version, no envelope. Still readable. |
| 2 | The envelope. Payload under its own key, schema version, written-at, app, board frame. Network files carry the styles they refer to. Unknown fields are preserved. |

When version 3 comes, a reader will migrate a version 2 file to it in one named step, with a test
that reads a real version 2 file and checks the result. `tests/file-format.cjs` is where those tests
live.
