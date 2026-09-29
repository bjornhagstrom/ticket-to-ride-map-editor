# Ticket to Ride Map Editor

A browser-based editor for designing custom Ticket to Ride-style maps. The editor supports schematic backgrounds, stops, routes, foldable board formats, printing, and portable JSON project files.

Live site: <https://hagstrom.nu/ttr/>

## Current capabilities

- Draw, move and edit stops and routes, each with a hint box over the map listing what can be done with the selected object directly on the canvas.
- Shape a route freely: add as many bend points as you like anywhere along it, and optionally draw it as a smooth curve that the wagon slots follow.
- Fully customise route types: rename, restyle (thickness and dash pattern) or delete the built-in city/region/rapid transit/ferry/railway/trail types, and add your own. Types are told apart by line shape, never by colour, so every route keeps its own wagon colour whatever its type.
- Build double routes: two or more parallel lines between the same pair of stops, each in its own colour, drawn side by side automatically.
- Fully customise stop types too: rename, recolour or delete the built-in six and add your own.
- Choose one of three stop sizes, which can carry meaning in some expansions.
- Mark a stop with a dot, dash, cross or a short letter code, independent of its type.
- Lock a stop's position so it cannot be dragged by accident, one stop at a time or every stop at once, and Shift-drag to move one anyway.
- Turn a stop's name around the stop to keep it clear of the routes running past it, with a warning listing names that cover a route, a one-click move to a clear position, and a Move names clear button that turns the whole map's names at once and names the stops it could not solve.
- Mark specific wagon slots on a route as requiring a locomotive card.
- Define named wagon styles to mark routes that play by their own rules: serrated tunnel edges, notched corners or a heavy outline, with an optional letter drawn in every space. A tunnel style ships with every map and can be renamed or restyled like any other.
- Wagon spaces, stop circles and the gap between the lines of a double route are all drawn at the size a real board uses, with an adjustable amount of room left around each stop, set for the whole map or per stop so the two ends of one line can differ.
- Wagons are always measured against the board the map is for, so you can judge how crowded the finished board will actually be. A board format printed at full size gives exactly real-size wagons; a test sheet is treated as a shrunken proof of whichever board you pick, so the layout matches the board and simply prints smaller. Routes drawn too short for their own wagon count are outlined in red.
- Define reusable custom line styles (thickness and dash pattern) to flag routes that follow a special rule, and set a default style so new routes pick it up automatically.
- Add areas, boundaries and labels behind the route network.
- Import a background image (PNG, JPEG or WebP) — from the Import menu or the Draw background tool — and move, scale, rotate, crop, fade or lock it behind the rest of the map, or centre it and fit it to the page with a print-safe margin in one click.
- Place resizable evaluation notes with explanatory text on the map, for reviewers and playtesters, and fold one down to a single line when it is in the way.
- Choose standard, large and custom foldable board formats or A4/A3/US Letter test sheets.
- Detect crossings between buildable routes.
- Check that each route is drawn about as long as its wagon count needs, and see which routes are too short or unnecessarily roomy.
- Analyse how balanced the network is: hub degree and neighbour count per stop, a colour-by-length distribution table, and a flag for under-connected stops.
- Measure the shortest travel distance between any two stops (by route length, not straight-line distance).
- Build a destination ticket deck by clicking two stops, with points suggested from the shortest path and from what the map's other tickets are worth. The ticket list flags unreachable pairs, duplicates and points far from what the distance implies, shows the spread of ticket lengths, and names the stops no ticket sends anyone to.
- Two-click tools say what they are waiting on: the first stop is ringed and tagged, a rubber band follows the pointer, and hovering the far end previews the ticket or the distance the second click would produce, with the path it would use lit on the map. Escape drops a half-finished pick, and clicking the current tool again lets it go.
- While the ticket tool is in use the right-hand panel lists every stop with how many short, medium and long tickets name it, sortable by name or by any of the three, with a filter that leaves only the stops no ticket has reached yet. Any count opens the tickets behind it and leads through to editing them. The length bands are a stand-in until the real definition arrives.
- Set up how a game on the map is played: how many wagons each player has, how many destination tickets are dealt at the start and how many of those a player must keep. The balance report reads all of it against the map — whether the map holds enough wagon spaces for a table to spend their supplies, and whether the deck is thick enough to deal from. They sit with the board format in Settings, which opens by itself on a new map, and travel in the map file, defaulting to the original game's 45 wagons and 3 tickets of which 2 are kept.
- Decide the map's own mix of short, medium and long tickets: where each boundary sits, as a fraction of the map's longest journey, and what share of the deck belongs in each band. The official USA and Europe mixes are one click away. The ticket panel counts by those boundaries, and the suggester aims at that mix instead of its style's own spread.
- Suggest a whole destination-ticket deck for the map that is open, in a Generic, Classic or Europe shape, and edit the result as ordinary tickets. It lands in a new deck stamped with the date and time, so nothing already there is touched. The dialog shows the current deck and the suggestion side by side with the official ranges beside each measure. Every target comes from the official decks — the Generic shape is the average of seven of them — and the whole thing is checked against all eight calibration maps in `npm run test:calibration`.
- Sort the ticket list by any of its headings — ticket, spaces, points, suggested value or the long flag — on a deck you built by hand and on one that came from a suggestion. It starts in the order the deck was built, and tickets stay editable while sorted.
- Keep several named ticket decks in one map and switch between them, so variants can be judged side by side. Decks can be duplicated, exported and imported on their own, and printed as cut-out cards, sixteen to an A4 sheet. An imported deck always arrives as a new deck and matches stops by name when the ids differ, so a deck can travel between copies of a map. Selecting a stop lists every ticket that names it, in any deck, and each one opens for editing.
- Get automatic route suggestions between nearby, unconnected, poorly-connected stops, with a starting length and colour guess drawn from the balance analysis, that you can add with one click and then adjust.
- Undo and redo up to 200 changes during the current session, with Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z.
- Save automatically in the current browser.
- Import and export complete maps as JSON, or just the background or the route network on their own.
- Print full test sheets or reduced A4 proofs of individual foldable-board panels.
- Show a neutral example map to first-time visitors.

Styles are applied from the Properties panel and defined in one shared Styles dialog, reachable in
one click from wherever a style is applied.

## Important storage behaviour

The application has no server-side database. A map is automatically stored in the current browser under the key `orebro-map-editor-public-v2`. This preserves existing users' data despite the historical key name.

Browser storage is specific to one browser and device. Export the map regularly to create a portable backup.

The example map is used only when no stored map exists. **Clear map** creates a genuinely empty map and never reloads the example.

## Local development

Requirements:

- Node.js 22.13 or newer
- npm

Install and start the development server:

```bash
npm install
npm run dev
```

Open <http://localhost:3000/ttr/>.

Create the static production build:

```bash
npm run build
```

The deployable website is generated in `out/`. Its contents are intended to be served from the `/ttr` path on a normal static web host.

## Project structure

| Path | Purpose |
| --- | --- |
| `app/map-data.ts` | Map types, board formats, empty map and first-visit example map |
| `app/map-editor.tsx` | Editor state, pointer interactions and layout |
| `app/map-geometry.ts` | Route geometry, curves and intersection primitives |
| `app/map-analysis.ts` | Balance metrics, shortest path and route suggestions |
| `app/map-storage.ts` | Local storage, file normalizers and format rescaling |
| `app/map-artwork.tsx` | SVG rendering of the map |
| `app/map-properties.tsx` | Properties panel editors |
| `app/map-dialogs.tsx` | Welcome guide, balance report and suggestions |
| `app/map-print.tsx` | Print pages |
| `app/globals.css` | Main editor layout and visual styling |
| `app/editor-additions.css` | Route handles, mobile behaviour and print layouts |
| `app/layout.tsx` | Page metadata and global layout |
| `next.config.ts` | Static export and `/ttr` hosting configuration |
| `BACKLOG.md` | Planned product work |
| `docs/ARCHITECTURE.md` | Application structure and state flow |
| `docs/MAP-FORMAT.md` | JSON project format and compatibility rules |
| `docs/DEPLOYMENT.md` | Build, Websupport deployment and rollback |

## Verification

```bash
npm run typecheck
npm run build
```

Plus a browser regression suite, which needs the dev server running in another terminal:

```bash
npm run dev
npm run test:regression
```

It drives the editor with Playwright and checks 25 things: the welcome guide, the example map,
per-route colours, the tool row and its tooltips, bend points on double routes, curves, locomotive
marking, undo, real-size wagons and stop circles, the room-per-wagon table, the balance and
suggestion dialogs, the hint boxes, the measure tool, placing a stop, changing board format, print
pages and reload persistence.

It is a single script rather than a Playwright test project, and it expects the editor at
`http://localhost:3000/ttr/`. It has caught real bugs — a handle's hit area swallowing the click
that marks a locomotive, editing handles measured from the wrong line on double routes — so it
earns its place, but it is not wired into CI and there are no unit tests.

If a change does not take effect locally, check for an orphaned dev server before suspecting the
build. `npm run dev` falls back to port 3001 when 3000 is already taken, printing only a warning, so
a previous server left running keeps serving the old code on 3000 while the new one compiles your
edits somewhere you are not looking. `pgrep -f next-server` shows them; stop them all before
starting a new one, and do not delete `.next` while a server is running.

## Source of truth

The canonical local checkout is the copy under `Developer/ticket-to-ride-map-editor`. Generated folders such as `.next/`, `out/` and `node_modules/` must not be committed.

Git is initialized locally. No remote repository is configured yet.
