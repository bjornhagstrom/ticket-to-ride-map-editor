# What's new

What changed in each version of the [Ticket to Ride map editor](https://hagstrom.nu/ttr/), newest first. The same notes are on the What's new page under Help in the editor.

This file is written from `app/version.ts` by `npm run changelog`; edit the notes there.

## 1.4.0 · 2026-10-09

**Version 1.4: boards of any number of fold panels**

- The board can be any number of fold panels, up to 6 along each side: Settings → Custom size… asks for the panels along the long and the short side. The map moves to it, printing counts its sheets, and the file says which board it is.

## 1.3.0 · 2026-10-09

**Version 1.3: files say which version of the editor wrote them**

- A map file written by a newer version of the editor than yours still opens, and now says which version wrote it and that some of it may be missing or changed here, so you know to reload the page or update your copy.
- The spreadsheet files carry the version of the editor too, in a last column, and say the same when you import files from a newer editor.

## 1.2.0 · 2026-10-08

**Version 1.2: Map balance judges the wagons against the room on the board**

- Map balance judges the wagon count by what a full table holds against the spaces it can claim, as the official maps do (57 to 76 %), warns when the players hold more wagons than the board has room for or fewer than 40 % of it, and shows the figure beside the official range.
- The example map's rules no longer have a table of wagons for each number of players: the map holds one wagon count, and the figures use it at every table.
- The example map is made for two or three players, so its 28 wagons each fit the spaces it can claim; its rules no longer speak of four or five players. A copy of the old example saved in your browser keeps its five players, and Map balance will say that its wagons do not fit.

## 1.1.0 · 2026-10-07

**Version 1.1: importing spreadsheets with templates, Tickets only, bends in spreadsheets, and fixes**

- The example map with problems now names a third thing that follows from its crossing route: a ticket worth more than its path, with the figures, where to see them in Tickets and what to do.
- Import → Spreadsheet opens a dialog that says which files to choose, with the column guide a click away; the templates are one zip with the guide inside it, a plain download under Import → Spreadsheet and under Export.
- Import → Tickets only now takes just the decks and tickets of a file, even a whole map, and leaves your stops and routes; Map project takes the whole map as before. The spreadsheet templates say on screen that they were saved.
- The spreadsheet export carries the bends and straightening of routes, and the import reads them back, so a round trip keeps the shape of every route.
- Importing a network file that carried tickets could, when stops had changed, move another deck's tickets into the deck you were working in and lose them from their own; the tickets that come with a file now get ids of their own.
- After the question about tickets to changed stops, Undo takes the whole import back, and the Undo in a notice does what it says or tells you that the map has changed since.
- Spreadsheet routes imported without their stops leave the stops the map has as they are, with their labels, symbols, sizes and marks, and two stops that share a name stay two.
- The print dialog no longer gets stuck when the whole board on one big page is chosen and the board is then left out of the run.

## 1.0.0 · 2026-10-07

**Version 1.0: the map against the official maps, decks calm or tense, and printing for playtests**

- Map balance opens with the map against the official maps: crowded routes at a full table as a share of all routes, the ticket traffic on double routes against single ones, routes no ticket needs, the busiest stop and the average hub degree, each beside what the eight official maps measure.
- How tense a full deck of tickets is can be set on a slider, from calm through like the official maps (the default) to tense, in Build a full deck and in the map's deck rules; the choice is kept with the map, and each place says what it means beside the official decks.
- A stop can be marked a hub on purpose and a route contested on purpose, in Properties. A full deck of tickets then sends more tickets to the hub and through the route, and Map balance lists such a route as crowded on purpose.
- The welcome box has the tour of the editor in 80 seconds, which loads from YouTube only when you press play (it starts warming up when you point at it), and a link to About.
- Beside the clean example map there is an example map with problems on purpose, a route that crosses another and a dead end, so you can see how the warnings look before you draw your own.
- Export has For ttr-map-generator, a zip with the map's places, routes and tickets in the text files of that open source tool, where the places are, and a script that makes its own graph file of them.
- The example map is for the standard two to five players, its rules have a wagon table for each, and both of its ticket decks have 15 tickets, enough to deal a full table.
- Deleting a stop also deletes the routes that end at it and the tickets that name it, in every deck: the question lists each of them, and Undo brings them all back.
- Importing routes from a spreadsheet without its stop file leaves the stops the map already has where they are, instead of laying them out again.
- An import that replaces the stops asks what became of the tickets in your other decks that named a stop now gone or renamed: send each old stop to a new one, remove its tickets, or undo the import.
- Spreadsheets you export carry the stops' ids beside their names, so reading one back keeps every ticket, and two stops with the same name can be told apart.
- A full deck built without a choice of tension now crowds the busiest routes about as much as the official maps do; 0.4.1 spread the tickets out more, which is close to Calm on the slider.
- Build a full deck shows the same official figures as Map balance: the lowest and highest of the eight official maps.
- A page of the balance figures can go with a print run, or alone: the network, crossings, how it holds together, crowding and the routes by colour and length, as they stand at that version.
- The print dialog says how to save a run as a PDF, and the file is named after the map, its version, what it holds and the date.
- The print dialog chooses paper and sheets in one table, with a box of its own for the whole board on one big page, instead of a list for how it is split, a list for the paper and a box for Anniversary size, and it no longer repeats in words what the run comes to or how to set the browser's own print dialog.
- The Rules panel has Print the rules, for the rules alone on pages of their own.
- A damaged map file opens with what can be used, and says what was left out and why; a file that holds no map at all is refused with a reason, and the map you had stays as it was.
- A map kept in the browser that cannot be read is put aside untouched instead of being overwritten, and the editor starts afresh and says so.
- Start over is under Settings, on the Map page: it says what goes, offers to export the map first, asks before it does anything, and Undo brings the map back. The Clear map button at the foot of the tools is gone.
- On a computer each column scrolls on its own, so the map stays in view while you edit a stop or a route in a tall Properties panel.
- In smaller windows the map shrinks to the room there is instead of running in under the Properties column, a tablet no longer scrolls sideways, and on a phone every button in the header shows.
- Standing ticket cards have their points at the top, beside the cities, so the small map below is larger; lying cards keep the points in their corner.
- Settings show a stop type as the map draws it, beside its settings.
- In Safari, dragging a stop's name across the map no longer selects the text of the panels and hints around it.
- About tells the whole loop, from drawing to printing again with the next version number, and shows the editor, the ticket cards and Map balance as they are now.

## 0.4.1 · 2026-10-04

**Map balance you can act on, and routes drawn with less fuss**

- Map balance can be expanded like the Tickets and Rules panels, and each route's room per wagon is marked OK, Too short or Roomy in a colour of its own.
- What the network section warns of comes with something to do: a button adds a second lane to a route that cuts the map in two, and another selects a stop no route reaches.
- Drawing a route between two stops that already have one still draws it, but says so, explains how to add a parallel route, and offers to turn it into one that follows the first route's shape and length.
- A new map starts with the playtest box in its top right corner, and printing puts it there on other maps too when the corner is free.
- A full deck of tickets is built on Generic, the average of the official maps, unless the map has chosen other rules; that goes for the example map too.
- The deck rules say ticket lengths in words, as how many of the tickets reach how far across the map, and explain the extra points some rules give the longest tickets.
- Help on hover waits a moment before it opens, so moving the pointer across the tools no longer flashes one help box after another; resting on something still shows its help.
- The note that everything is stored in the exported map file now sits with the figures above the map, in the same shape as they are.
- Your map is kept in the browser under a new, neutral name. A map kept under the old name is picked up the first time you open the editor, so nothing is lost.

## 0.4.0 · 2026-10-03

**Spreadsheets, boards that stand, and tickets with a map**

- A board can stand as well as lie: choose it in Settings beside the board format, where a drawing shows the board and its ticket cards as you will get them. Everything on the map turns a quarter turn with it.
- Ticket cards lie or stand the way the board does, and every card carries a small map of the whole board with its two stops ringed and joined by a line, as on the real cards.
- Export the tickets, the routes, the stops or the distances between every two stops as a spreadsheet (CSV), from Export or from the Tickets panel.
- Import stops, routes and tickets from spreadsheets (CSV). Stops keep their positions; stops without one are laid out from the routes, ready to be dragged into place.
- Start a spreadsheet from a template: one each for stops, routes and tickets, under Import, with a guide to what every column means. Imported as they are, the three make a small map.
- Å, ä and ö come through in a spreadsheet saved however Excel saves it, and a name typed with a different kind of å still finds its stop.
- Map balance shows how the network holds together: dead ends, routes whose loss cuts the map in two, and corners reached through one or two stops, each beside what the official maps have. Edges and corners are described as character; only a route with one lane that cuts the map in two is a warning.
- Crowded routes are set against the official maps, which have 8 to 19 at a full table, instead of being called a fault. The Tickets button now just says Tickets; how many tickets the deck holds is shown with the other figures above the map.
- The example map's rules list the standard points for a claimed route by its length, 1 to 8.
- The frame round a printed map is drawn wholly inside the sheet; on some printers its left edge was cut off.
- A version number for the map: every print and export after a change gets the next one, one series for all of them. It is printed on every sheet as Version 8 with its date, on every ticket card as v8, and on the rules, and shown above the map. Exported files carry it in their names. Undo never takes it back.
- A playtest box on the map, ticked in the print dialog: a yellow box with the version, a line for the date played, and the players' names on the back of the sheet. It is placed where it covers least and moves like a note.
- Opening an older copy of the same map, with a lower version number, warns that its numbers would repeat and suggests a new name.
- The first print puts the whole board on one sheet of A4; the print dialog remembers what you choose after that.
- Drawing a route, its wagon spaces can be set at once: the Draw route tool fits them to the distance between the stops, or uses a number you choose, and right after drawing, − and + on the new route (or a digit key) change them without leaving the tool.
- A tick box among a tool's options is no longer set in capitals, and in a table that scrolls sideways the ticket names stay above the columns sliding under them.
- A reminder to export: the map lives only in this browser, so after a while of work without an export a note says so, and the header says when the map was last exported. Ask for it less often, or turn it off in Settings.
- Point at the crossings warning to see them: the routes that cross are marked on the map and every crossing is ringed. Crossings are now found on the lines as drawn, curves included.
- Two things have clearer names: Suggest a deck is now Build a full deck of tickets, under Add a deck in the Tickets panel, and the Analyze balance button is now Map balance, like the panel it opens.
- A logo of its own: two stops joined by a route of wagon spaces, in the header, on the About pages and in the browser tab. It used to be a bus.
- Print the whole board on one page as big as the board, at real size, for a large-format printer or to save as a PDF. The page is the board's own size, and the dialog says how big.
- The welcome guide is shorter, covers destination tickets, the rules and spreadsheets, and says nothing about how a print is laid out.

## 0.3.0 · 2026-10-02

**One print run for the board, the tickets and the rules**

- The print dialog has a tick box for the board, one for the tickets and one for the rules. Tick any of them and they print in one run: the board, then the tickets as cut-out cards, then the rules.
- The dialog says how many sheets the cards take on the paper you chose, and offers only what there is to print: no cards from a deck without tickets, and no rules from a map without rules.
- Suggest a deck no longer counts a junction as a stop when it works out how many tickets to propose; a map with junctions now gets a slightly smaller suggested deck.
- The source code is public, under the MIT licence, with a link to it from the About page and the Help menu.

## 0.2.0 · 2026-10-01

**Rules, comparisons and a calmer workspace**

- Write your map's rules in a new Rules panel: markdown with a toolbar, and stops and routes named by their names or picked by clicking on the map, shown the way the map shows them. The example map comes with example rules.
- Print the rules on pages of their own, after the board or on their own. The print dialog now starts by asking what to print.
- Save the board as a PNG picture from the Export menu.
- Map balance and Tickets open beside the map instead of over it. The column scrolls, can be dragged wider, and the whole map stays in view.
- Marks on the map are much clearer: a band under the route, the other routes fade, and pointing at a ticket shows its path at once. Click to keep a mark, and click again to let it go.
- Ticket lengths are set against the official decks and against your own rules, and colours and lengths against the seven classic maps, with a row of wagons for each colour.
- Compare two ticket decks side by side, figure by figure.
- Suggest a deck warns when the deck is too small to deal a full table, and no longer raises its size by itself.
- Every dialog scrolls in a small window, printing with a panel open no longer cuts the pages short, and Print deck waits for its dialog to close.
- A version number, and this page.

## 0.1.0 · 2026-09-22

**The first version**

- Draw a board with a background, stops, routes and notes, with wagons at their real size.
- Destination tickets with suggested points, coverage and balance checks, and a suggested deck for the map you have drawn.
- Print the board in pieces or at full size on A4, A3, Letter and Tabloid, and the tickets as cards.
- Everything is saved in your browser, and can be exported to a file and imported again.
