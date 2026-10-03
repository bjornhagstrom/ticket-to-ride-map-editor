// The version of the editor, and what changed in each. The notes are for the people who use the
// editor, so they say what a person can now do, in plain words: no file names, no commit hashes.
// The newest release comes first, and its version is the one in package.json (a test checks it).
// Where the source code lives. Linked from Help and from the About page.
export const REPO_URL = "https://github.com/bjornhagstrom/ticket-to-ride-map-editor";

export type Release = { version: string; date: string; title: string; changes: string[] };

export const RELEASES: Release[] = [
  {
    version: "0.4.0",
    date: "2026-10-02",
    title: "The whole board on one page",
    changes: [
      "Print the whole board on one page as big as the board, at real size, for a large-format printer or to save as a PDF. The page is the board's own size, and the dialog says how big.",
      "The welcome guide is shorter and now covers destination tickets and the rules, and says nothing about how a print is laid out.",
      "Export the tickets, the routes, the stops or the distances between every two stops as a spreadsheet (CSV), from Export or from the Tickets panel.",
      "A board can stand as well as lie: choose it in Settings beside the board format, where a drawing shows the board and its ticket cards as you will get them. Everything on the map turns a quarter turn with it.",
      "Ticket cards lie the way the board lies, and carry a small map of the whole board with their two stops ringed and joined by a line, as on the real cards.",
      "Import stops, routes and tickets from spreadsheets (CSV). Stops keep their positions; stops without one are laid out from the routes, ready to be dragged into place.",
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
