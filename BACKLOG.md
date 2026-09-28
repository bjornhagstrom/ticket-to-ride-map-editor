# Backlog

## Destination tickets

Editing, scoring, coverage, decks, ticket-only transfer and card printing are built. What remains:

- Show the distribution of ticket lengths against a reference distribution, rather than only the
  shortest, median and longest.
- Compare two decks against each other directly, rather than by switching between them.
- Replace the stand-in ticket length bands (short up to 7 wagon spaces, medium up to 13) with the
  real definition once it is settled. They live in `TICKET_LENGTH_BANDS` in `app/map-analysis.ts`.

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
