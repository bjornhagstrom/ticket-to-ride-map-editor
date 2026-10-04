# What's new

What changed in each version of the [Ticket to Ride map editor](https://hagstrom.nu/ttr/), newest first. The same notes are on the What's new page under Help in the editor.

This file is written from `app/version.ts` by `npm run changelog`; edit the notes there.

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
