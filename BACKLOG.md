# Backlog

## Destination tickets

Tickets are the part of the balancing model that the editor does not cover yet. The map already
knows its own graph — `Measure distance` runs a Dijkstra over the route network — so ticket
scoring can be derived rather than typed in by hand.

### Data model

- Add a ticket list to `MapData`: two stop IDs, a point value, and an optional flag for long
  tickets drawn from a separate deck.
- Include tickets in full-map exports and in the network-only export, since they belong to the
  route network rather than the background.
- Keep older files loading: a map without a ticket list opens with an empty one.

### Editing

- A ticket editor listing every ticket with both endpoint names, its points and its shortest-path
  length, sortable by each.
- Create a ticket by clicking two stops on the map, the same interaction the Measure tool uses.
- Show the shortest path on the map when a ticket is selected.
- Warn when a ticket's two stops are not connected at all, or when the same pair appears twice.

### Balancing

- Suggest a point value from the shortest-path length, scaled from the map's own existing tickets
  rather than from a fixed table.
- Flag tickets whose points are far from what their length suggests, in the same style as the
  route-length warning.
- Show the distribution of ticket lengths against a reference distribution, which is what the
  spreadsheet's ticket sheet does by hand.
- Report per-stop ticket coverage: how many tickets start or end at each stop, so no stop is
  either unreachable by any ticket or named by half the deck. This is the spreadsheet's
  `#Tickets` / `#Desired` / `#Remaining` idea, applied to the live map.

### Printing

- Print the ticket list as cut-out cards on a separate sheet, so a playtest set can be made with
  the same print-and-draw workflow as the board.

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
