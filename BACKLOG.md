# Backlog

## Welcome guide and example controls

- Show a short welcome dialog the first time the editor is opened.
- Explain the basic flow: choose a board format, draw a background, add stops, connect routes, save locally and export a backup.
- Keep the instructions concise and visual, with clear actions to start a blank map or open the example.
- Remember when the guide has been dismissed so it does not appear on every visit.
- Add a clearly visible Help action that opens the guide again.
- Add an action for loading the neutral example map again after the first visit.
- Load the example only after the user chooses it; never replace an existing map without confirmation.
- Make it clear that the example is separate from the user's own work and can be reset or discarded.
- Keep the example generic and suitable for any city or region.

## US Letter test format

- Add US Letter landscape as a board-format choice: 11 × 8.5 inches (279.4 × 215.9 mm).
- Show both imperial and metric dimensions in the format details.
- Treat it like the A4 and A3 test formats, with the complete map on one landscape sheet.
- Include the selected format in local storage, full-map exports and print output.

## Selective import and export

Allow users to import or export either part of a map independently:

- Background only: areas, boundary lines, labels, colours and geometry.
- Network only: train and bus stops, routes, route types, colours and geometry.
- Keep the existing full-map import and export option.
- A partial import must preserve the part of the current map that is not being imported.
- Clearly confirm before replacing an existing background or network.
- Use files that identify their content type and remain compatible with full map projects.

## Background image import

Allow users to import an image as a map background:

- Support common image formats such as PNG, JPEG and WebP.
- Place the image behind schematic background objects, routes and stops.
- Allow moving, scaling, cropping, rotating, changing opacity and locking the image.
- Provide a clear remove or replace action.
- Include the image in full-map exports so the project remains portable between browsers and devices.
- Include the image when exporting the background only.
- Keep imported images in print output.
- Warn when an image makes the project file unusually large.

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
