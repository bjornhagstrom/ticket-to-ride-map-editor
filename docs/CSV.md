# Spreadsheets: what the columns mean

The editor reads stops, routes and tickets from spreadsheets saved as CSV, and writes them back out.
This page says what goes in each column. The quickest start is the templates: one zip with a file for each
of the three kinds below (`stops-template.csv`, `routes-template.csv`, `tickets-template.csv`) and this
guide (`columns.md`). Get it from **Import → Spreadsheet (CSV) → Download templates (.zip)**, or from
**Export → Spreadsheet (CSV) → Templates to fill in (.zip)**: the same file. Each template has the
main columns below and a few example rows (the bends, and the ids, are only in what the editor exports). The three together make a tiny map, so you can import them as they
are, look at the result, and then replace the rows with your own.

## The three files

You can import one file or several at once: choose them together in the **Import spreadsheets…** dialog, with **Choose files…**.

- **Stops and routes replace the stops and routes on the map.** If the map already has some, the
  editor asks first. Background, notes, styles and settings are kept.
- **Tickets always arrive as new decks**, beside the decks you have. A ticket file on its own is matched
  to the stops already on the map, by id when a row has one that the map has, otherwise by name.
- **Names tie the files together, and ids do when there are any.** A route from `Harbour` to `Hill Town`
  needs stops named exactly that, in any case. The editor's own export also writes ids (see *Ids and names*
  below), and an import that has them uses them.
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
| `Bends` | no | The route's bends, from its `From` stop to its `To` stop, as `x|y` pairs in board units separated by spaces, such as `412|306 450|330`. See *Bends and curves* below. |
| `Curved` | no | `no` for a route that is straightened, so that it runs in straight lines between its bends. Empty or anything else: the route curves through its bends, as routes do unless straightened. |

**A double route is two rows** with the same two stops, usually in two colours.

## Tickets

| Column | Needed | What it holds |
| --- | --- | --- |
| `Deck` | no | Which deck the ticket goes in. Each name becomes a new deck; left empty, the ticket goes in one called "Imported deck". |
| `From` | yes | The stop at one end, by name. |
| `To` | yes | The stop at the other end. |
| `Points` | yes | What the ticket is worth. The official maps use the shortest path in wagon spaces. |
| `Long deck` | no | `yes` for a ticket from the separate long deck, as in Europe. |

## Bends and curves

A route runs from one stop to the other through its bends, drawn as a curve unless it is straightened. The
export writes the bends in `Bends` and a straightened route as `no` in `Curved`, after the other columns (and before `Editor`),
and the import reads them back, so a round trip keeps the shape of every route, double routes included. A
bend is a place on the board in the same units as `X` and `Y`, so it is kept only when the stops stay where
the file puts them. When the stops had to be fitted to the board, or are laid out from the routes because the
file gave them no place, the bends would not fit and are left out, and the import says so. A `Bends` cell
that cannot be read (anything but `x|y` pairs, more than 100 of them, or numbers far off the board) leaves
that route without bends and is counted in the message. A file without the columns, such as an export from
0.4.1 or a list typed by hand, reads as it always did: routes without bends, drawn straight between their
stops.

## Ids and names

Every stop has an id, a short piece of text that is its own for ever, however it is renamed. The export
writes the ids beside the names, so a row still reads on its own and the machine has something firm to
hold on to:

- the stop file has an `Id` column;
- the route file has `From id` and `To id`, beside `From` and `To`;
- the ticket file has `From id` and `To id`, beside `From` and `To`.

On import, **the id decides when there is one that a stop of the files has**; the name is what is used when
there is no id (a list typed by hand, the reference data, an export from before ids). So:

- **Reading an export back keeps every id.** Tickets in the decks that stay on the map still name the right
  stops, and nothing has to be asked.
- **Two stops may have the same name** if they have different ids; routes and tickets go to the one their id
  names. Without ids the second of a name is left out, as it always was, and the import says so.
- **A row whose id and name disagree** (a stop renamed in the spreadsheet, say) goes to the stop the id
  names, and the import tells how many rows that was.
- **An id the files do not have** is ignored, and the name is used (with no stop file, routes make the stops, and an id that is new makes a new stop with that id). An id that another stop of the file already has, or that is over 100 characters long or has control characters in it, is not used for the stop; it gets an id of its own, and the import says so.
- **Routes without a stop file** read over a map that has the stops: a stop the map has (found by its id, or by its name when the row has no id) is that stop, whole, with its place, label, symbol, size, hub mark and locks. A name that two of the map's stops share, without an id, is said to be ambiguous.
- **Ids are not made up by hand.** The templates have no id columns, and a new spreadsheet needs none.

When an import replaces the stops, the tickets of the decks that stay are checked against the new stops. A
ticket whose stops are all there, with the same ids and the same names, is left alone. For the others the
editor asks: one row for each old stop that is gone, or whose id now belongs to a stop with another name,
with the stop of the same name already chosen when there is exactly one, and a choice to send its tickets
to any other stop or to let them go. The question cannot be closed by Escape or a click outside it: it
has three buttons, *Apply*, *Remove them all* and *Undo the import*.

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

**Editor version.** From 1.3.0 the stop, route and ticket files end in a column `Editor`, with the version of the editor that wrote them (for example `1.3.0`) on every row, so a row that is sorted or copied into another file still carries it. Reading a file, the import looks at the column: if any row comes from a newer version of the editor than the one open, it reads the files as usual and says so once, with the newest version it saw, since a newer editor may have columns this one does not know. Leave the column out, or empty, or write anything that is not a version, and nothing is said. The table of distances and the templates have no such column. Older builds read by heading and pass over it.

## Other names the import understands

So that files from elsewhere read without editing, these headings mean the same as the ones above:
`a` and `b` for `From` and `To`; `color` for `Colour`; `long` for `Long deck`; `latitude`, `longitude`,
`lng` and `long` (in a stop file) for `Lat` and `Lon`; `ferryLocomotives` for `Locomotives`; `tunnel`
(`True` or `yes`) for a `Tunnel` wagon style; `kind` with `ship` for a boat route and `waypoint` for a
junction stop. Yes can be written `yes`, `true`, `1` or `ja`.
