# Backlog

What is agreed with the owner and not built yet, newest decisions first within each part. Kept current
in the same commit as the work (AGENTS.md).

## Agreed and next

1.0 to 1.7.0 are published (1.0 and 1.1 on 2026-10-07, 1.2 on 2026-10-08, 1.3, 1.4 and 1.5 on 2026-10-09, 1.6 on 2026-10-11, 1.7 on 2026-10-13; the notes are in CHANGELOG.md and the What's new page).

- **Code review of 1.0** (`ttr-reviewer`, `docs/REVIEW.md`, Trials): the first full review is done and most of it is fixed. Done on the owner's word: the official figures in Build a full deck are the eight maps' own, with a test; tickets go with a deleted stop (asked first, Undo); an import that replaces the stops asks what became of the tickets of the other decks (flag, rebind or remove, undo the import); spreadsheets carry ids beside the names (ids decide, names are the reserve); the notes say that the default deck now crowds like the official maps; tickets go with a deleted stop (the question says so, Undo brings them back), a file with no map in it is refused, the tension chosen in Build a full deck is kept with the map, the video preconnect is a decision (`docs/DECISIONS.md`). The example map is made for two or three players (28 × 3 = 84 wagons against the 95 spaces open at three players), and its rules no longer speak of four or five (decided by Claude on the owner's word, 2026-10-08). Smaller, not done: the balance page of a print recounts on every render, section 34 of the suite runs on an empty map, network files do not filter `hub` and `contested`, "crowded on purpose" in README and About against TERMINOLOGY.md.
- **Faster testing**: three tiers (quick while working, merge before `main`, release before any push or
  deploy). Steps 1 to 5 are built: `npm run test:quick` (about 30 s), `npm run test:merge` (about 2 minutes), `npm run test:release` (about 3.5 minutes), `TTR_ONLY=…`, the parallel runner with shorter waits. Left: waits for a condition in the sections still on `--fast`'s list of real waits (37, 55), splitting the chain of sections 1–32 and 34 (about 93 s, the longest job), and step 6, the impact map. The plan and the measurements are in `docs/TESTING.md`.

## Waiting

- **Two-sided score targets**: too even counts against a deck too, so suggestions take on the
  official character by default. Needs the calibration redone. After deck tension, and only if the
  official setting proves to be what most people choose.
- **Playtest results**: which routes were claimed on the marked-up sheet and which tickets were made,
  entered after a game and set against the predicted crowding, per map version. A printed playtest
  sheet (date, players, scores, tickets made and missed, notes) could be its paper half. Large.
- **Short videos on reading the editor**, later: how to read Map balance (crowding, how the network
  holds together, the official ranges), building a deck and its tension, printing and playtesting.
  Each a few minutes, pointing to the others; an end card long enough for YouTube's end screen, the
  address in the picture and high in the description. The tour itself stays as it is.
- **Map collaboration** (accounts, shared maps, versions, live editing): waits; the editor stays
  without a backend for now. Notes on what a first version would hold are in the git history of this
  file.

## Smaller follow-ups

- **Keyboard access to the objects on the map** (user test 2026-10-15, no. 50): Tab does not reach a stop, a route or a background shape. Needs a way to move between them (Tab or arrow keys), a name for each (the stop's name, the route's two ends), Enter to select, and the arrow keys to move the selected one; a larger piece than a fix, and it touches how the map is drawn.
- **Where the map starts on a phone** (user test 2026-10-15, no. 47): it starts at 900 px, a size to work in, so on a phone only part of the board is seen until Show the whole map is pressed. Left as it is because it was chosen and is tested (section 67); decide whether the first view should be the whole map.

- **Drag moves the shape that is being edited** (the owner, 2026-10-15): in Draw background, while a shape is being edited, a press on the shape and a drag moves it, without Shift; a press and a release without a drag still puts in a new point. So a point is made when the pointer comes up and has not moved (a few pixels of slack), not when it goes down; Shift and drag stays for a shape that is locked and for one that is not the one being edited. To settle: a press on the shape's body only, or anywhere on the map (the shape would then follow the pointer from any spot), and how it sits with a press on a point, which already drags that point.
- **A deck from Build a full deck of tickets needs no name** (the owner, 2026-10-15): Save as new deck should work with the name box left empty, and name the deck after the map, today's date and the time, for example "Example map 2026-10-15 21:40". That name is shown in grey in the box (Name for a new deck), as a hint that goes when you start typing and comes back if you clear the box, and not as text to edit. The same name is used for a deck that arrives from a ticket file with no name of its own.
- **Zoom in the map** (the owner, 2026-10-15): zoom and pan on a computer as well as on a phone (the phone has the buttons and the pinch since 1.6.0), for drawing and editing close up: buttons and the wheel with Ctrl or Cmd held, drag with the space bar to move about, and the same zoom for the print preview. Nothing is decided about how it sits with the board's fixed size on the page.
- **A map note that was folded away starts folded** (the owner, 2026-10-15): a note on the map (the playtest box and the others) that was minimised once should start minimised when the map is loaded again, and show large only if it has been changed since the map was exported. Needs the folded state in the map file (an addition) and a way to tell that the note changed since the last export (the map's version fingerprint may do).
- **The box for the number of wagons when a route is edited** (the owner, 2026-10-15): drawing a route brings up a box to set its number of wagons; the same box should come up when a route is edited, and it must not sit over the plus and the cross that start a route (the wagons-plus-and-cross buttons), so it has to be placed beside them.

- **ttr-map-generator, orientation**: not checked by eye in the tool's own window (the tool's code reads y upward, like ours). Left to the tool's author by the owner's word on 2026-10-08; corrected if he reports a mirror or an upside-down map. Fix would be in `positionsJson`.
- **The lane rule of a map** (`laneRule`; the analysis called it `lanesUsableByPlayers`, a name every older build drops, so the field was renamed before release): built on the owner's word (2026-10-09): Settings has a box, "Second lane opens from" 2 to 6 players (4, the standard, is no rule in the file), carried through export and import, and Map balance follows it. Released as 1.5.0. Not covered: triple routes ruled apart from doubles, as Northern Lights does.
- **Small boards (New York, Amsterdam, London)**: built 2026-10-11 to 2026-10-12 and released as 1.7.0 (`docs/PROPOSAL-SMALL-BOARDS.md`): the board profile (`panelMm`, `wagonMm`, `stopMm`, `nameMm`; additions to the file, OK'd by the owner), drawing in millimetres with the standard boards unchanged (golden test), analysis with the map's own wagon, printing (one A4 sheet per panel, small ticket cards), Settings presets (New York standing, Amsterdam and London lying) and real sizes, the game that follows the board (15 or 16 wagons, 2 to 4 players, only where the person has not chosen), and Map balance ranges of its own for boards under 500 mm. Open: London's data when it comes (the ranges rest on two maps and are narrow), San Francisco, the Deck builder has a set of rules for small boards from the two maps (Amsterdam's own deck does not fit it well; London will tell), the number of tickets dealt and kept and the double-route rule on the small boards are not known, so a preset leaves them alone, a mention in the welcome guide.
- **Rules text**: a link from one part of the rules to another, images, and a way to see in the
  preview where a printed page would break.
- **Safari** has not been tried for the small ticket map, the standing board or its print.
- **Phones**: built (below 721 px: the header in two rows with a menu, the facts of the map in a row of their own that folds, the map first, the tools and the properties as sheets with a cross, zoom in the bar and a pinch, Settings in one column, notices above the bar; sections 66, 67, 69 and 70 of the suite). Not done: it has been tried only in Chromium and WebKit at 390 px with synthetic touches, never on a real phone or with a real screen reader; the wide tables in Map balance and Tickets are read by scrolling the sheet.
## Decided against

- Tickets to countries or groups of stops, as Switzerland has: no support. A person draws the countries as background areas and puts the stops where they belong; decided by the owner on 2026-10-10.
- Pictures for a stop's size and symbol (the selected stop shows on the map) and for where its name
  sits (it is dragged on the map now). Route types, the board and the wagon spaces already have theirs;
  stop types were added after 0.4.1. A drawing of how the print's sheets divide the board was added and taken away again: it counted the board alone.

- The rules in the PNG image of the map.
- Mirroring or turning a map's content on its own board.
- Reading a stop × stop table of route lengths (as fan generators use) as a route list.

## The case for uneven maps

`docs/PROPOSAL-UNEVEN-MAPS.md` has the measurements. Built: hubs and routes contested on purpose, a deck's tension (a slider from calm through like the official maps to tense), every balance figure beside the official range (Against the official maps), crowding set against it,
and how the network holds together (dead ends, routes that cut the map in two, corners), with buttons
for what it warns of. The rest is above.
