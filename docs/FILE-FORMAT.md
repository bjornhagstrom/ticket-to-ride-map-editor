# The file format

What the editor writes and reads, and what you can rely on if you share files with someone else.

The format is versioned so that it can grow. This document is the contract: what is guaranteed,
what may change, and how a reader should behave when it meets something it does not understand.

## The envelope

Every file has the same wrapper.

```json
{
  "format": "ticket-to-ride-map",
  "version": 3,
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
| `version` | The schema this file follows. Currently 3. |
| `kind` | `map`, `background`, `network` or `tickets`. |
| `written` | When it was written, ISO 8601. For your information; nothing depends on it. |
| `app` | What wrote it. For tracing a problem back to a build. |
| `board` | The frame the coordinates are in. Positions in the payload are in these units. |
| `payload` | The content. Its shape depends on `kind`. |

Which file is read as what is told by `kind`, except for **Import → Tickets only**: that reads only the decks and tickets
of whatever file it is given (a ticket file, a whole map or a network), matches each ticket to the open map's stops by id and then by
name, adds the decks as new decks, and leaves the stops, routes and everything else of the open map alone. **Import → Map project** reads
the file as its `kind` says. Nothing changes in the files themselves.

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

## Spreadsheets (CSV) are not map files

Export → Spreadsheet (CSV) writes the tickets, the routes, the stops, or the shortest distance between
every two stops, and the Tickets panel writes one deck. They are for reading a map in a spreadsheet or
in another tool. They have no envelope: one header row, then a row per thing, named by stop names and,
since 1.0, with the stops' ids beside the names (see below). RFC 4180 quoting, comma-separated, CRLF line ends, UTF-8 with a BOM so a spreadsheet
reads å, ä and ö. Text that a spreadsheet would run as a formula (starting with `=`, `+`, `-` or `@`)
gets a leading apostrophe. `tests/csv-export.cjs` holds the columns.

Import → Spreadsheet (CSV) reads stops, routes and tickets back, one file or several at once. It is
not a way to move a whole map: the background, styles and settings are only in the JSON files.

- **Which file is which** is told from the header, in any case: `from`/`a`, `to`/`b` and `points` make a
  ticket file, the same with `length` a route file, and `name` without ends a stop file. Our own
  exports and the reference data's exports both read; so does a list typed by hand. Comma, semicolon
  (as Swedish Excel saves) and tab all work. A distance table is recognised and turned away.
- **Ids and names.** Added in 1.0, an addition: the stop file has an `Id` column, and the route and ticket
  files `From id` and `To id`, after the columns that were there (which keep their places). When an import
  has an id that a stop of the files has, the id decides; otherwise the name does, as before, so a file
  from 0.4.1 or before, a list typed by hand and the reference data's exports read as they always did. An
  older build reads by header: it takes a stop file's `Id` as one more name for the stop, to tie rows
  together (so if one stop's id is another stop's name, as the reference data's exports have, an older build can
  confuse the two), passes over the other new columns, and matches by name as it always did; a file it wrote has
  none, and reads here by name. Later columns are added after these, and readers go by header. Two stops may share a name when
  their ids differ; a row whose id and name disagree goes to the stop the id names, and is said. The ids of
  a map are those of its JSON files, so reading an export back keeps every id. The meaning of each column
  is in `docs/CSV.md` (*Ids and names*); `tests/csv-ids.cjs` holds the rules, including an export from
  before ids.
- **Positions** (`x`, `y`, in board units) are kept when every one fits the board, and fitted to it,
  shape kept, when they do not. `lat` and `lon` instead are drawn north up. Stops without a position
  are worked out from the routes: between neighbours that have one, or, when none has, by a spring
  layout that knows nothing of north. The import lists them so they can be dragged into place.
- **Routes**: colour by name (an unknown one becomes grey), type by name (`kind` = `ship` becomes a
  boat), `Wagon style` by name or `tunnel` = true, `Locomotives` or `ferryLocomotives` as a count.
  A double route is two rows.
- **Stops**: type by name; `kind` = `waypoint` becomes a junction.
- Stops and routes **replace** the network, after asking when the map has one. Tickets always arrive as
  **new decks**, named after their `Deck` column. Tickets alone are matched to the open map by id when a row has one the map has, else by name.
- Anything left out — a route to a stop the stop file lacks, a length that is not a whole number, a
  stop named twice — is said in the message after the import. `tests/csv-import.cjs` holds the rules,
  and checks them on Europe, USA, Switzerland and Northern Lights when the private reference data is
  beside this repository.

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
5. **A file with nothing of a map in it is refused.** A JSON file that holds none of `stops`, `routes`,
   `tickets`, `ticketSets`, `background`, `backgroundImage`, `notes`, `rules` or the style lists (a
   `package.json`, another tool's graph) is not a map, a network, a background or a set of tickets. The reader
   says so and the map that is open stays as it was; it is never opened as an empty map. An older build (0.4.1 and before) turns away only what is not an object, so it opens such a file as an empty map, which then replaces the open one. The list of content fields is closed on purpose and grows with the format: a later build that writes a file whose only content is a field not in the list makes this build refuse it as not a map, until the list is brought up to date with it.

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
| 3 | Wagon styles and line styles folded into route types: a type describes the whole route. A version 2 map gets one route type per combination it used, so it keeps its look. |
| 4 | A board can stand: `orientation: "portrait"` in the map, and in network and background files, with the `board` frame standing (731 × 1100 for a 2×3). Only a standing map is written as version 4; a lying map is still written as version 3 and has no `orientation`, so every version 3 reader opens it unchanged, while one that cannot stand a board refuses a standing map rather than lays it down wrong. A version 3 file reads as lying. Content brought from a file on a board that lies or stands the other way is turned a quarter turn to fit (`tests/board.cjs`). |

### The map's version number

Added in 0.4.0, within versions 3 and 4: an addition, so the file version did not move. A map file may
carry `mapVersion`:

```json
"mapVersion": {
  "number": 8,
  "fingerprint": "3f9a01c2",
  "issued": [
    { "number": 1, "date": "2026-10-04T10:00:00.000Z", "by": "print" },
    { "number": 8, "date": "2026-10-12T18:30:00.000Z", "by": "export" }
  ]
}
```

- `number` is one series for every print and export (`by`: `print`, `export`, `image`). A print or export
  gets the same number while the map is unchanged and the next one after a change.
- `fingerprint` is opaque: a short hash of the map's content when the number was handed out, the
  version record left out. Do not compute or compare it outside the editor; it only tells the editor
  whether the map has changed since. A build that reads the content differently (a new default field,
  say) may see a change once and hand out one extra number; that is allowed.
- `issued` logs each number when it was handed out. Entries that make no sense are dropped on reading.
- A record without a whole `number` above 0 and a `fingerprint` is dropped, and the next print starts
  the series at 1 again. Anything a later build adds to the record or to an entry is kept.
- A file without it (every file before 0.4.0, every version 1 file) opens as before; its first print or
  export is version 1. An older build keeps the record untouched under rule 3, so a map edited there
  comes back with its old number and a fingerprint that no longer matches: its next print here is the
  next number. `tests/map-version.cjs` checks this against the build the live site runs.
- Only `map` files carry it. Background, network and ticket files and CSV carry the number in their
  file names only, and importing one never changes the map's number.

A note may have `kind: "playtest"`: the playtest box, which the editor draws itself with the version, a
line for the date played and where the players' names go. Its `text` says the same in words, so an
older build, which keeps the field, shows it as an ordinary note.

### Hubs and routes contested on purpose

Added after 0.4.1: additions. A stop may carry `hub: true`, a route `contested: true` (every lane between
the same two stops is marked together). Only `true` is kept when read. Older builds keep both untouched.

### A deck's tension

Added after 0.4.1: an addition. A map may carry `deckTension`, a whole number from 0 (calm) through 50
(like the official maps) to 100 (tense): how tickets crowd the same corridors when a full deck is built
for the map. It is written as soon as someone has chosen a place on the slider, 50 included, so that a
choice made on purpose never turns into a silent default. Without it, a map is read as 50: a file made
by 0.4.1 or before has none, and builds decks like the official maps from now on (tickets already in the
file are not touched). A number outside 0 to 100 is brought to the nearest end, a fraction is rounded.
The words `"calm"`, `"official"` and `"tense"`, which a development build wrote before 1.0, read as 0, 50
and 100; they were never in a release. Anything else is left out when read. An older build keeps the
field untouched (rule 3) and builds its own decks as it did, so a round trip through 0.4.1 keeps the
number. The field is a number so that the scale can grow: the measured places on it (and what they mean)
live in the editor, not in the file.

### Board formats that became print choices

Within version 3, `format` narrowed to the board's shape: `board-2x3` or `board-2x4`. Test sheets,
boards measured in sheets of paper and the Anniversary size are now chosen when printing and are not
stored. The version did not move, because nothing a version 3 reader writes changed shape: the two
remaining ids are the ones every version 3 reader already knows, so older builds read new files
unchanged. A file naming one of the old formats is migrated when it is read — scaled evenly, never
enlarged, and centred on the nearest board — and `docs/MAP-FORMAT.md` lists where each one lands.

When version 4 comes, a reader will migrate a version 3 file to it in one named step, with a test
that reads a real version 3 file and checks the result. `tests/file-format.cjs` is where those tests
live.

## Files for other tools

The editor writes, and does not read, a zip for ttr-map-generator (Export → For ttr-map-generator): see
`docs/TTR-MAP-GENERATOR.md`. It is an addition to what the editor writes and changes nothing in the map,
network, background or ticket files.
