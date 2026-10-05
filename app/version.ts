// The version of the editor, and what changed in each. The notes are for the people who use the
// editor, so they say what a person can now do, in plain words: no file names, no commit hashes.
// The newest release comes first, and its version is the one in package.json (a test checks it).
// Where the source code lives. Linked from Help and from the About page.
export const REPO_URL = "https://github.com/bjornhagstrom/ticket-to-ride-map-editor";

export type Release = { version: string; date: string; title: string; changes: string[] };

// Changes made since the last release, written as they are made, in the same plain words. They go at
// the top of CHANGELOG.md under Unreleased, and become the notes of the next version when it is
// decided; the What's new page in the editor shows released versions only.
export const UNRELEASED: string[] = [
  "A damaged map file opens with what can be used, and says what was left out and why; a file that holds no map at all is refused with a reason, and the map you had stays as it was.",
  "On a computer each column scrolls on its own, so the map stays in view while you edit a stop or a route in a tall Properties panel.",
  "The welcome box has the tour of the editor in 80 seconds, which loads from YouTube only when you press play, and a link to About.",
  "About tells the whole loop, from drawing to printing again with the next version number, and shows the editor, the ticket cards and Map balance as they are now.",
  "Settings show a stop type as the map draws it, beside its settings, and the print dialog draws how the sheets of a run divide the board.",
  "A stop can be marked a hub on purpose and a route contested on purpose, in Properties. A full deck of tickets then sends more tickets to the hub and through the route, and Map balance lists such a route as crowded on purpose.",
  "A full deck of tickets can be calm, like the official maps, or tense: chosen when it is built, and set for the map in its deck rules. Like the official maps crowds its busiest corridor about as hard as the official decks do; tense, like the tensest of them.",
  "Map balance opens with the map against the official maps: crowded routes at a full table, the ticket traffic on double routes against single ones, routes no ticket needs, the busiest stop and the average hub degree, each beside what the eight official maps measure.",
  "The Rules panel has Print the rules, for the rules alone on pages of their own.",
  "The print dialog says how to save a run as a PDF, and the file is named after the map, its version, what it holds and the date.",
  "A page of the balance figures can go with a print run, or alone: the network, crossings, how it holds together, crowding and the routes by colour and length, as they stand at that version.",
  "Standing ticket cards have their points at the top, beside the cities, so the small map below is larger; lying cards keep the points in their corner.",
  "Start over is under Settings, on the Map page: it says what goes, offers to export the map first, asks before it does anything, and Undo brings the map back. The Clear map button at the foot of the tools is gone.",
  "In smaller windows the map shrinks to the room there is instead of running in under the Properties column, a tablet no longer scrolls sideways, and on a phone every button in the header shows.",
  "A map kept in the browser that cannot be read is put aside untouched instead of being overwritten, and the editor starts afresh and says so.",
];

export const RELEASES: Release[] = [
  {
    version: "0.4.1",
    date: "2026-10-04",
    title: "Map balance you can act on, and routes drawn with less fuss",
    changes: [
      "Map balance can be expanded like the Tickets and Rules panels, and each route's room per wagon is marked OK, Too short or Roomy in a colour of its own.",
      "What the network section warns of comes with something to do: a button adds a second lane to a route that cuts the map in two, and another selects a stop no route reaches.",
      "Drawing a route between two stops that already have one still draws it, but says so, explains how to add a parallel route, and offers to turn it into one that follows the first route's shape and length.",
      "A new map starts with the playtest box in its top right corner, and printing puts it there on other maps too when the corner is free.",
      "A full deck of tickets is built on Generic, the average of the official maps, unless the map has chosen other rules; that goes for the example map too.",
      "The deck rules say ticket lengths in words, as how many of the tickets reach how far across the map, and explain the extra points some rules give the longest tickets.",
      "Help on hover waits a moment before it opens, so moving the pointer across the tools no longer flashes one help box after another; resting on something still shows its help.",
      "The note that everything is stored in the exported map file now sits with the figures above the map, in the same shape as they are.",
      "Your map is kept in the browser under a new, neutral name. A map kept under the old name is picked up the first time you open the editor, so nothing is lost.",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-10-03",
    title: "Spreadsheets, boards that stand, and tickets with a map",
    changes: [
      "A board can stand as well as lie: choose it in Settings beside the board format, where a drawing shows the board and its ticket cards as you will get them. Everything on the map turns a quarter turn with it.",
      "Ticket cards lie or stand the way the board does, and every card carries a small map of the whole board with its two stops ringed and joined by a line, as on the real cards.",
      "Export the tickets, the routes, the stops or the distances between every two stops as a spreadsheet (CSV), from Export or from the Tickets panel.",
      "Import stops, routes and tickets from spreadsheets (CSV). Stops keep their positions; stops without one are laid out from the routes, ready to be dragged into place.",
      "Start a spreadsheet from a template: one each for stops, routes and tickets, under Import, with a guide to what every column means. Imported as they are, the three make a small map.",
      "Å, ä and ö come through in a spreadsheet saved however Excel saves it, and a name typed with a different kind of å still finds its stop.",
      "Map balance shows how the network holds together: dead ends, routes whose loss cuts the map in two, and corners reached through one or two stops, each beside what the official maps have. Edges and corners are described as character; only a route with one lane that cuts the map in two is a warning.",
      "Crowded routes are set against the official maps, which have 8 to 19 at a full table, instead of being called a fault. The Tickets button now just says Tickets; how many tickets the deck holds is shown with the other figures above the map.",
      "The example map's rules list the standard points for a claimed route by its length, 1 to 8.",
      "The frame round a printed map is drawn wholly inside the sheet; on some printers its left edge was cut off.",
      "A version number for the map: every print and export after a change gets the next one, one series for all of them. It is printed on every sheet as Version 8 with its date, on every ticket card as v8, and on the rules, and shown above the map. Exported files carry it in their names. Undo never takes it back.",
      "A playtest box on the map, ticked in the print dialog: a yellow box with the version, a line for the date played, and the players' names on the back of the sheet. It is placed where it covers least and moves like a note.",
      "Opening an older copy of the same map, with a lower version number, warns that its numbers would repeat and suggests a new name.",
      "The first print puts the whole board on one sheet of A4; the print dialog remembers what you choose after that.",
      "Drawing a route, its wagon spaces can be set at once: the Draw route tool fits them to the distance between the stops, or uses a number you choose, and right after drawing, − and + on the new route (or a digit key) change them without leaving the tool.",
      "A tick box among a tool's options is no longer set in capitals, and in a table that scrolls sideways the ticket names stay above the columns sliding under them.",
      "A reminder to export: the map lives only in this browser, so after a while of work without an export a note says so, and the header says when the map was last exported. Ask for it less often, or turn it off in Settings.",
      "Point at the crossings warning to see them: the routes that cross are marked on the map and every crossing is ringed. Crossings are now found on the lines as drawn, curves included.",
      "Two things have clearer names: Suggest a deck is now Build a full deck of tickets, under Add a deck in the Tickets panel, and the Analyze balance button is now Map balance, like the panel it opens.",
      "A logo of its own: two stops joined by a route of wagon spaces, in the header, on the About pages and in the browser tab. It used to be a bus.",
      "Print the whole board on one page as big as the board, at real size, for a large-format printer or to save as a PDF. The page is the board's own size, and the dialog says how big.",
      "The welcome guide is shorter, covers destination tickets, the rules and spreadsheets, and says nothing about how a print is laid out.",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-10-02",
    title: "One print run for the board, the tickets and the rules",
    changes: [
      "The print dialog has a tick box for the board, one for the tickets and one for the rules. Tick any of them and they print in one run: the board, then the tickets as cut-out cards, then the rules.",
      "The dialog says how many sheets the cards take on the paper you chose, and offers only what there is to print: no cards from a deck without tickets, and no rules from a map without rules.",
      "Suggest a deck no longer counts a junction as a stop when it works out how many tickets to propose; a map with junctions now gets a slightly smaller suggested deck.",
      "The source code is public, under the MIT licence, with a link to it from the About page and the Help menu.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-10-01",
    title: "Rules, comparisons and a calmer workspace",
    changes: [
      "Write your map's rules in a new Rules panel: markdown with a toolbar, and stops and routes named by their names or picked by clicking on the map, shown the way the map shows them. The example map comes with example rules.",
      "Print the rules on pages of their own, after the board or on their own. The print dialog now starts by asking what to print.",
      "Save the board as a PNG picture from the Export menu.",
      "Map balance and Tickets open beside the map instead of over it. The column scrolls, can be dragged wider, and the whole map stays in view.",
      "Marks on the map are much clearer: a band under the route, the other routes fade, and pointing at a ticket shows its path at once. Click to keep a mark, and click again to let it go.",
      "Ticket lengths are set against the official decks and against your own rules, and colours and lengths against the seven classic maps, with a row of wagons for each colour.",
      "Compare two ticket decks side by side, figure by figure.",
      "Suggest a deck warns when the deck is too small to deal a full table, and no longer raises its size by itself.",
      "Every dialog scrolls in a small window, printing with a panel open no longer cuts the pages short, and Print deck waits for its dialog to close.",
      "A version number, and this page.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-09-22",
    title: "The first version",
    changes: [
      "Draw a board with a background, stops, routes and notes, with wagons at their real size.",
      "Destination tickets with suggested points, coverage and balance checks, and a suggested deck for the map you have drawn.",
      "Print the board in pieces or at full size on A4, A3, Letter and Tabloid, and the tickets as cards.",
      "Everything is saved in your browser, and can be exported to a file and imported again.",
    ],
  },
];

export const APP_VERSION = RELEASES[0].version;
