# Ticket to Ride Map Editor

A browser-based editor for designing custom Ticket to Ride-style maps. The editor supports schematic backgrounds, stops, routes, foldable board formats, printing, and portable JSON project files.

Live site: <https://hagstrom.nu/ttr/>

## Current capabilities

- Draw, move and edit stops and routes.
- Add areas, boundaries and labels behind the route network.
- Choose standard, large and custom foldable board formats or A4/A3/US Letter test sheets.
- Detect crossings between buildable routes.
- Undo and redo up to 40 changes during the current session.
- Save automatically in the current browser.
- Import and export complete maps as JSON.
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
| `app/map-editor.tsx` | Editor state, interactions, import/export and SVG rendering |
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

There are currently no automated interaction tests for drawing, dragging, persistence or printing. This is a documented gap rather than an implied guarantee.

## Source of truth

The canonical local checkout is the copy under `Developer/ticket-to-ride-map-editor`. Generated folders such as `.next/`, `out/` and `node_modules/` must not be committed.

Git is initialized locally. No remote repository is configured yet.
