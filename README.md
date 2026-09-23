# Ticket to Ride Map Editor

A browser-based editor for designing custom Ticket to Ride-style maps. The editor supports schematic backgrounds, stops, routes, foldable board formats, printing, and portable JSON project files.

Live site: <https://hagstrom.nu/ttr/>

## Current capabilities

- Draw, move and edit stops and routes, each with a hint box over the map listing what can be done with the selected object directly on the canvas.
- Shape a route freely: add as many bend points as you like anywhere along it, and optionally draw it as a smooth curve that the wagon slots follow.
- Fully customise route types: rename, restyle (thickness and dash pattern) or delete the built-in city/region/rapid transit/ferry/railway/trail types, and add your own. Types are told apart by line shape, never by colour, so every route keeps its own wagon colour whatever its type.
- Build double routes: two or more parallel lines between the same pair of stops, each in its own colour, drawn side by side automatically.
- Choose one of three stop sizes, which can carry meaning in some expansions.
- Mark a stop with a dot, dash, cross or a short letter code, independent of its type.
- Lock a stop's position so it cannot be dragged by accident, and Shift-drag to move it anyway.
- Turn a stop's name around the stop to keep it clear of the routes running past it, with a warning listing names that cover a route, a one-click move to a clear position, and a Move names clear button that turns the whole map's names at once and names the stops it could not solve.
- Mark specific wagon slots on a route as requiring a locomotive card.
- Wagon spaces, stop circles and the gap between the lines of a double route are all drawn at the size a real board uses, with an adjustable amount of room left around each stop, set for the whole map or per stop so the two ends of one line can differ.
- Wagons are always measured against the board the map is for, so you can judge how crowded the finished board will actually be. A board format printed at full size gives exactly real-size wagons; a test sheet is treated as a shrunken proof of whichever board you pick, so the layout matches the board and simply prints smaller. Routes drawn too short for their own wagon count are outlined in red.
- Define reusable custom line styles (thickness and dash pattern) to flag routes that follow a special rule, and set a default style so new routes pick it up automatically.
- Add areas, boundaries and labels behind the route network.
- Import a background image (PNG, JPEG or WebP) — from the Import menu or the Draw background tool — and move, scale, rotate, crop, fade or lock it behind the rest of the map, or centre it and fit it to the page with a print-safe margin in one click.
- Place resizable evaluation notes with explanatory text on the map, for reviewers and playtesters.
- Choose standard, large and custom foldable board formats or A4/A3/US Letter test sheets.
- Detect crossings between buildable routes.
- Check that each route is drawn about as long as its wagon count needs, and see which routes are too short or unnecessarily roomy.
- Analyse how balanced the network is: hub degree and neighbour count per stop, a colour-by-length distribution table, and a flag for under-connected stops.
- Measure the shortest travel distance between any two stops (by route length, not straight-line distance).
- Get automatic route suggestions between nearby, unconnected, poorly-connected stops, with a starting length and colour guess drawn from the balance analysis, that you can add with one click and then adjust.
- Undo and redo up to 200 changes during the current session, with Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z.
- Save automatically in the current browser.
- Import and export complete maps as JSON, or just the background or the route network on their own.
- Print full test sheets or reduced A4 proofs of individual foldable-board panels.
- Show a neutral example map to first-time visitors.

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

There is no automated test suite in the repository. Interaction testing during development has been
done with ad-hoc Playwright scripts against the dev server, covering the example map, route colours,
bend points on double routes, curves, locomotive marking, undo, true-scale wagons, the balance and
suggestion dialogs, the measure tool, format changes, print pages and reload persistence. Turning
that into a committed suite is still an open gap rather than an implied guarantee.

If a change does not take effect locally, check for an orphaned dev server before suspecting the
build. `npm run dev` falls back to port 3001 when 3000 is already taken, printing only a warning, so
a previous server left running keeps serving the old code on 3000 while the new one compiles your
edits somewhere you are not looking. `pgrep -f next-server` shows them; stop them all before
starting a new one, and do not delete `.next` while a server is running.

## Source of truth

The canonical local checkout is the copy under `Developer/ticket-to-ride-map-editor`. Generated folders such as `.next/`, `out/` and `node_modules/` must not be committed.

Git is initialized locally. No remote repository is configured yet.
