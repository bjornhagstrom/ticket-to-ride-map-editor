# Terminology

The words the editor uses, what they mean, and the ones we do not use. Check new text against it —
in the editor, the README, the help pages, the video and posts — and add to it when a new word settles.
`tests/terminology.cjs` checks the list under *Not in the editor* against the editor's own text, the
README and the spreadsheet guide; release notes keep the words they were written with.

The editor speaks English. Swedish equivalents are given where the work is discussed in Swedish.

## The map

| Term | Meaning | Swedish |
| --- | --- | --- |
| **map** | Everything one file holds: board, stops, routes, tickets, rules, settings. | karta |
| **board** | The game board the map is drawn for: its **format** (standard 2×3, extended 2×4 or a size of your own from 2 to 6 panels along the long side, in fold **panels**) and whether it lies (**landscape**) or stands (**portrait**). | bräde |
| **stop** | A place on the map that routes join. In the editor always *stop*; in a video or a post, *city* reads more like the game and is fine. | hållplats, station |
| **junction** | A stop no ticket ends at and whose name is not printed: it only joins routes. | knutpunkt |
| **route** | A connection between two stops, a number of wagon spaces long, in a colour. | rutt, sträcka |
| **wagon space** | One space on a route, the size of one plastic train. | vagnsplats |
| **double route** | Two routes between the same two stops; each is a **lane**. The second lane opens only at bigger tables. | dubbelrutt |
| **locomotive** | A wagon space that needs a locomotive card, as on a ferry. | lok |
| **tunnel**, **boat** | A wagon style and a route type for routes with rules of their own. | tunnel, båt |
| **background** | Areas, lines and labels behind the network, and a background image. | bakgrund |
| **note** | A box of text on the map, for the designer and playtesters. | anteckning |
| **rules** | The map's own rules, written in the Rules panel. | regler |

## Tickets

| Term | Meaning | Swedish |
| --- | --- | --- |
| **ticket** (destination ticket) | Two stops to join; worth its **points**. | biljett |
| **points** | What a ticket is worth: the length of the **shortest path** between its stops, in wagon spaces, as on the official maps. Only tickets have points. | poäng |
| **shortest path** | The fewest wagon spaces from one stop to the other. | kortaste vägen |
| **deck** | A set of tickets. A map can hold several decks side by side. | lek, biljettlek |
| **long deck** | The separate deck of long tickets some maps have, as Europe does. | lång lek |
| **Build a full deck of tickets** | The editor building a whole deck for the map, under rules taken from the official decks. Inside the code and the technical docs it is the *suggester*. | bygg en hel lek |
| **score** | How a deck measures up against the official decks: lower is better. Only decks have a score; a ticket has points. | poängtal (för en lek) |
| **ticket card** | A ticket as printed, to cut out, with a **small map** of the board on it. | biljettkort |

## Balance

| Term | Meaning | Swedish |
| --- | --- | --- |
| **Map balance** | The panel that reads the network and the deck: colours, lengths, crowding. | kartbalans |
| **crossing** | Two routes passing over each other without meeting at a stop. | korsning |
| **crowded route** | A route more tickets want than it can carry at a given table. | trång rutt |
| **dead end** | A stop on one route only: one way in. Character, as Edinburgh is on Europe. | återvändsgränd |
| **route that cuts the map in two** | A route whose loss splits the network. With one lane it is warned about (a single claim shuts part of the map off; no official map has one); as a double route it is described. | rutt som delar kartan |
| **corner** | Two or more stops reached only through one or two **gates**, as Iberia is through Pamplona and Marseille. Character, not a fault. | hörn |
| **gate** | A stop through which a corner is reached. | port |
| **tension** (of a deck) | How much a full deck of tickets sends players through the same corridors: a scale from 0 to 100 with three named places: **calm** (0, a little calmer than the calmest official map), **like the official maps** (50, the default) and **tense** (100, a little tenser than the tensest). | spänning |
| **hub on purpose**, **contested on purpose** | A stop many tickets may name, and a route tickets may crowd, as the designer marks them; a full deck is built to keep them so. | avsiktlig knutpunkt, avsiktligt omstridd |

## Printing and files

| Term | Meaning | Swedish |
| --- | --- | --- |
| **print run** | One print from the print dialog: the board, the ticket cards and the rules, in any combination. | utskrift |
| **sheet** | One sheet of paper in a print run. | ark |
| **version** (of a map) | The map's running number, one series for every print and export: the same while the map is unchanged, the next after a change. Printed as *Version 8 · 4 Oct 2026* on every sheet, *v8* on every card. Not the editor's own version. | version |
| **playtest box** | The yellow box on the board with the version, a line for the date played and the players' names on the back. | speltestruta |
| **full size** | The board at real size, spread over as many sheets as it takes. | full storlek |
| **export**, **import** | Saving the map to a file and opening one. The map is otherwise **saved in this browser** only. | exportera, importera |
| **map file** | The JSON file a map is exported to. | kartfil |
| **spreadsheet** (CSV) | Stops, routes or tickets as a CSV file; **templates** show the columns. | kalkylark |

## The tool

| Term | Meaning |
| --- | --- |
| **Map prototypes** | The tool's name. "for Ticket to Ride" says what it is for. |
| **unofficial** | Always said with the game's name in anything public: not affiliated with Days of Wonder. |
| **editor** | The tool itself, in its own text and in the narration ("the editor shows…"). Not *the app*. |

## Not in the editor

Words we have chosen not to use, each with the word to use instead.

- `wagon slot`, use `wagon space`
- `Suggest a deck`, use `Build a full deck of tickets`
- `Saved locally`, use `Saved in this browser`
- `minimap`, use `small map`
- `mini map`, use `small map`
- `ticket's score`, use `points`
- `Analyze balance`, use `Map balance`
- `the suggester`, use `Build a full deck of tickets` (or "when the editor builds a deck")
- `ticket suggester`, use `Build a full deck of tickets`
- `balance report`, use `Map balance`
- `balance view`, use `Map balance`
- `Name position`, use `Name on the map`
- `low-connection`, use `dead end` (or `stop with no route`)

## Open questions

None at the moment. Settled on 2026-10-04: the button and the panel are both *Map balance*, and the
video says a ticket's length is "what the ticket is worth", keeping *score* for decks.
