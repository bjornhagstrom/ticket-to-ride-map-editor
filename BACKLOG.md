# Backlog

## Destination tickets

Editing, scoring, coverage, decks, ticket-only transfer and card printing are built. What remains:

- Tickets to countries or groups of stops, as Switzerland has, are not modelled.

## Map collaboration

Allow several people to work on the same map without passing project files manually.

### First useful version: shared maps

- Add accounts or secure invitation links.
- Store maps centrally instead of only in each browser.
- Let an owner invite collaborators as viewers or editors.
- Auto-save changes and show who made the latest change.
- Keep named versions and allow restoring an earlier version.
- Prevent accidental overwrites when two people save changes based on different versions.
- Allow the owner to revoke access and create a new invitation link.

### Later version: live co-editing

- Show who is currently viewing or editing the map.
- Synchronise edits without reloading the page.
- Show selections or cursors belonging to other editors when useful.
- Merge changes to different objects automatically.
- Warn and resolve conflicts when two people change the same object simultaneously.

### Data and safety

- Keep maps private by default.
- Separate map ownership from edit and view permissions.
- Record version history and important actions.
- Include background images and all map objects in shared storage.
- Retain full and selective import/export as offline backup and transfer options.

## Version number and a "what's new" page

Built: the version lives in `package.json`, is shown under Help, and `app/version.ts` holds the notes
the What's new page renders (`npm run test:releases` checks them).

## Illustrations for the settings that are hard to picture

The wagon-space shape is now drawn live beside its picker, by the same functions that draw the map,
so the preview cannot drift from the print. That pattern is better than a picture wherever the thing
being described is something the editor already knows how to draw. Worth doing the same for:

- **Dash patterns and line thickness** — a short line drawn with the chosen values, beside the picker.
- **Stop types** — the circle, square and symbol as they will appear, at real size.
- **Print choices** — a small diagram of how the sheets tile the board, beside the table in the print dialog.
- **Label angles** — where a stop's name lands, which is currently eight numbers with no picture.
- ~~**The board**~~ — done: a line drawing of the board, its fold panels, its size and a ticket card
  sits beside the format and orientation choices in Settings (`app/board-preview.tsx`).

For anything the editor cannot draw from its own data — the print-and-cut workflow, what a finished
marked-up board looks like after a game — a photograph would do more than a diagram, and those have
to come from a real playtest.

## Save a map or a deck as PDF

Printing to PDF already works through the browser's own print dialog — choose "Save as PDF" as the
destination and the sheets come out as a file, at the size the editor asked for. That is enough to
keep a milestone version, and it needs no code.

What would be worth building on top:

- **Say so where it matters.** The print buttons could mention that the same dialog saves a PDF, so
  nobody has to know the trick.
- **A name worth keeping.** The browser names the file after the page title. Setting a title like
  `Örebro map · board · 2026-09-29` before printing would give files that sort and read well in a
  folder of milestones.
- **Map and deck in one file.** Today they are two print runs, because they use different paper.
  One run that prints the board sheets and then the ticket cards would make a single milestone file.
- **What a milestone should hold.** Probably the board, the deck, and a page of the balance numbers
  as they stood — so that a year later the file says not just what the map looked like but what the
  editor thought of it.

## Rules text: what is left

The rules box is built: markdown in the right column, `[[Stop]]` and
`[[Stop–Stop]]` drawn as the map draws them, printed on pages of their own after the board when the
print dialog says so. Not done: the rules are not in the PNG; a print run of the rules alone; a link
to another part of the rules; images in the text; and a way to see in the preview where a page
would break.

## Uneven maps on purpose

The case and the measurements are in `docs/PROPOSAL-UNEVEN-MAPS.md`. The owner approved the first two
steps and they are built in 0.4.0: the crowding text is set against the official range, and Map balance
has a section on how the network holds together, with only a single-lane route that cuts the map in two
as a warning. Still open from step one: the official range beside the other balance figures.
The official maps build contention in on purpose (8–19 crowded routes at a full table, mostly on double
routes) while avoiding routes or stops that cut the board in two, and our deck score rates every
official deck worse than our own suggestions. The steps, in the order the proposal recommends:

- **Describe, don't judge** (small, partly built): every balance figure with the official range beside it, worded as a
  fact; warnings kept only for what is rarely intended; the crowding advice rewritten as options.
- **Fragility apart from contention** (small, built): dead ends, routes that cut the map in two and
  corners reached through one or two stops, with the official counts.
- **Deck tension as a choice** (medium): calm, official-like or tense, in Build a full deck of tickets and in the deck
  rules, its range taken from the official decks.
- **Intended chokepoints and hubs** (medium): a route or stop marked as contested on purpose, listed as
  intended by the analysis and respected by the suggester; stored in the map.
- **Two-sided score targets** (medium): too even counts against a deck too, so suggestions take on the
  official character by default. Needs the calibration redone.
- **Playtest results** (large, not now): which routes were claimed on the marked-up sheet, against the
  predicted crowding.

## Follow-ups from the CSV, ticket map and standing board work

- **Standing ticket cards** carry a narrow small map, because the points column takes a share of an
  already narrow card. Putting the points under the map, or over its corner, would give the map the
  card's whole width.
- **Mirror or turn a map's content on its own board** — upside down or left to right — for a network
  that arrives the wrong way round, such as a CSV of routes laid out from the routes alone (the spring
  layout knows nothing of north).
- **Names after a turn.** A name left to place itself is placed again after the board turns, and some
  then sit on a route; Move names clear fixes it in one click. Doing that as part of the turn would
  save the click, at the cost of moving names the person may have liked.
- **Read an adjacency matrix** (a stop × stop table of route lengths, as fan generators use) as a
  route list. Today a distance table is recognised and turned away.
- **Safari** has not been tried for the small ticket map, the standing board or its print.
