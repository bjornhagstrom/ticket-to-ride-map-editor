# Spreadsheets: what the columns mean

The editor reads stops, routes and tickets from spreadsheets saved as CSV, and writes them back out.
This page says what goes in each column. The quickest start is a template: **Import → Spreadsheet
(CSV) → Stops template, Routes template, Tickets template**. Each one has the columns below and a few
example rows. The three together make a tiny map, so you can import them as they are, look at the
result, and then replace the rows with your own.

## The three files

You can import one file or several at once: choose them together in **Import spreadsheets…**.

- **Stops and routes replace the stops and routes on the map.** If the map already has some, the
  editor asks first. Background, notes, styles and settings are kept.
- **Tickets always arrive as new decks**, beside the decks you have. A ticket file on its own is matched
  to the stops already on the map, by name.
- **Names tie the files together.** A route from `Harbour` to `Hill Town` needs stops named exactly that,
  in any case. A stop file may also have an `id` column; routes and tickets can then use the ids.
- A route file without a stop file is fine too: the stops are made from the names in it.

Anything the editor cannot use is left out, and the message after the import says what and why.

## Stops

| Column | Needed | What it holds |
| --- | --- | --- |
| `Name` | yes | The stop's name, as it is printed on the board. |
| `Type` | no | The stop type by its name in Settings: `Regular`, `Ferry port`, `Junction`, or one of the map's own. Left empty, a stop is `Regular`. A junction joins routes; no ticket ends there and its name is not printed. |
| `X` | no | Across, in board units: 0 at the left edge. |
| `Y` | no | Down, in board units: 0 at the top edge. |

A lying 2×3 board is 1100 units across and 731 down; a standing one 731 across and 1100 down (the
extended 2×4 is 1100 by 549). Positions that all fit the board are kept as they are. Positions from
somewhere else — pixels from a scanned map, say — are scaled to fit the board, shape kept. Instead of
`X` and `Y` you can give `Lat` and `Lon` (latitude and longitude); they are drawn with north up.

A stop without a position is placed between the stops it has routes to, or, if no stop has a position,
laid out from the routes alone. That layout knows nothing of north, so expect to drag stops into place.

## Routes

| Column | Needed | What it holds |
| --- | --- | --- |
| `From` | yes | The stop at one end, by name. |
| `To` | yes | The stop at the other end. |
| `Length` | yes | Wagon spaces: a whole number from 1 up. |
| `Colour` | no | `Grey`, `Red`, `Blue`, `Green`, `Yellow`, `Black`, `White`, `Orange` or `Purple`. Left empty, or a colour the editor does not have, the route is grey. |
| `Type` | no | The route type by its name in Settings: `Railway`, `Boat`, or one of the map's own. Left empty, a route is a railway. |
| `Wagon style` | no | A wagon style by its name in Settings, such as `Tunnel`, for routes that play by a rule of their own. |
| `Locomotives` | no | How many of the route's spaces need a locomotive card, as on a ferry. |

**A double route is two rows** with the same two stops, usually in two colours.

## Tickets

| Column | Needed | What it holds |
| --- | --- | --- |
| `Deck` | no | Which deck the ticket goes in. Each name becomes a new deck; left empty, the ticket goes in one called "Imported deck". |
| `From` | yes | The stop at one end, by name. |
| `To` | yes | The stop at the other end. |
| `Points` | yes | What the ticket is worth. The official maps use the shortest path in wagon spaces. |
| `Long deck` | no | `yes` for a ticket from the separate long deck, as in Europe. |

## Saving the file

- **Separator:** comma, semicolon or tab all work. Swedish and other European versions of Excel save
  with semicolons; that is fine.
- **Letters:** å, ä and ö come through whichever way the file was saved: UTF-8 (Excel's *CSV UTF-8*,
  Numbers, Google Sheets) or Excel's plain *CSV*, which on Windows and older Macs uses an older encoding.
- **The first row is the headings.** Their order does not matter, nor does upper or lower case.
- A name with a comma in it needs quotes, which every spreadsheet adds by itself.
- **Opening an export in Excel:** the export is comma-separated. Excel with Swedish or other European
  settings expects semicolons and may put everything in one column; open it with *Data → From
  Text/CSV* instead of double-clicking. Numbers and Google Sheets open it as it is.

## What the export writes

**Export → Spreadsheet (CSV)** writes the same columns, and a few more that are worked out from the map
and only read by people: a stop's `Routes`, `Neighbours` and `Tickets`; a route's `Double route`; a
ticket's `Shortest path` and `Length` (short, medium or long). The import skips those. **Distances
between stops** is a table of the shortest path between every two stops; it cannot be imported.

## Other names the import understands

So that files from elsewhere read without editing, these headings mean the same as the ones above:
`a` and `b` for `From` and `To`; `color` for `Colour`; `long` for `Long deck`; `latitude`, `longitude`,
`lng` and `long` (in a stop file) for `Lat` and `Lon`; `ferryLocomotives` for `Locomotives`; `tunnel`
(`True` or `yes`) for a `Tunnel` wagon style; `kind` with `ship` for a boat route and `waypoint` for a
junction stop. Yes can be written `yes`, `true`, `1` or `ja`.
