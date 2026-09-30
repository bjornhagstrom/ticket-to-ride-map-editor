# Backlog

## Destination tickets

Editing, scoring, coverage, decks, ticket-only transfer and card printing are built. What remains:

- Show the distribution of ticket lengths against a reference distribution, rather than only the
  shortest, median and longest.
- Compare two decks against each other directly, rather than by switching between them.
- The suggester holds the deck size at what a table of five can be dealt, which on a small map is
  denser than the official 0.83–0.98 tickets per stop. The dialog says so and the count can be
  overridden, but a better rule would be to warn rather than to force.
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

Planned, not built. Two pieces that belong together:

- **The version, shown discreetly.** One place holds it — `package.json` — and everything else reads
  from there: the file envelope's `app.version`, a line in the page footer, and the About page. It
  should never be typed twice. `app/map-storage.ts` currently repeats it as `APP_VERSION`; that
  constant should come from the build instead, so a release cannot ship a file stamped with the
  wrong version.
- **A page that says what changed.** `CHANGELOG.md` as the source, written for the person using the
  editor rather than for whoever wrote the code: what is new, what changed shape, and what a file
  written by an older version will do. The page renders it and links from the version line in the
  footer, so "0.2.0" is clickable and lands on what 0.2.0 brought.

Worth deciding before building: whether a version bump is manual or comes from the release, and
whether the changelog is one entry per release or one per user-visible change. The file format has
its own version, separate from the app's, and the changelog should say when the two move together.


## Illustrations for the settings that are hard to picture

The wagon-space shape is now drawn live beside its picker, by the same functions that draw the map,
so the preview cannot drift from the print. That pattern is better than a picture wherever the thing
being described is something the editor already knows how to draw. Worth doing the same for:

- **Dash patterns and line thickness** — a short line drawn with the chosen values, beside the picker.
- **Stop types** — the circle, square and symbol as they will appear, at real size.
- **Print choices** — a small diagram of how the sheets tile the board, beside the table in the print dialog.
- **Label angles** — where a stop's name lands, which is currently eight numbers with no picture.

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

## Rules text printed with the map

Wanted, not built. A place to write the rules of the map being designed, printed with it.

Markdown in a plain text area, rather than a rich-text editor: it reads as text, survives in the map
file, and ties us to no editor's data format. Stops and routes referred to as `[[Westport]]` and
`[[Westport–Central]]`, rendered with the same colour and shape they have on the map.

Two things to decide first: whether the rules print as their own pages after the board, and whether
a reference to a stop that has since been deleted should warn or just show the name.
