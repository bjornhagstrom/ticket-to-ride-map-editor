# Backlog

What is agreed with the owner and not built yet, newest decisions first within each part. Kept current
in the same commit as the work (AGENTS.md).

## Agreed and next

1.0 to 1.4.0 are published (1.0 and 1.1 on 2026-10-07, 1.2 on 2026-10-08, 1.3 and 1.4 on 2026-10-09; the notes are in CHANGELOG.md and the What's new page).

- **Code review of 1.0** (`ttr-reviewer`, `docs/REVIEW.md`, Trials): the first full review is done and most of it is fixed. Done on the owner's word: the official figures in Build a full deck are the eight maps' own, with a test; tickets go with a deleted stop (asked first, Undo); an import that replaces the stops asks what became of the tickets of the other decks (flag, rebind or remove, undo the import); spreadsheets carry ids beside the names (ids decide, names are the reserve); the notes say that the default deck now crowds like the official maps; tickets go with a deleted stop (the question says so, Undo brings them back), a file with no map in it is refused, the tension chosen in Build a full deck is kept with the map, the video preconnect is a decision (`docs/DECISIONS.md`). The example map is made for two or three players (28 × 3 = 84 wagons against the 95 spaces open at three players), and its rules no longer speak of four or five (decided by Claude on the owner's word, 2026-10-08). Smaller, not done: the tension slider commits on `pointerup` and `keyup` only (a screen reader on a phone may not trigger it), the balance page of a print recounts on every render, section 34 of the suite runs on an empty map, network files do not filter `hub` and `contested`, "crowded on purpose" in README and About against TERMINOLOGY.md.
- **Faster testing**: three tiers (quick while working, merge before `main`, release before any push or
  deploy), built in six steps. Steps 1 and 2 are built (`npm run test:quick`, `TTR_ONLY=…`); next are the waits instead of sleeps, sharding, one command per tier and the impact map. The plan and the measurements are in `docs/TESTING.md`.

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

- **ttr-map-generator, orientation**: not checked by eye in the tool's own window (the tool's code reads y upward, like ours). Left to the tool's author by the owner's word on 2026-10-08; corrected if he reports a mirror or an upside-down map. Fix would be in `positionsJson`.
- **The lane rule of a map has no setting** (`lanesUsableByPlayers`, found in the 1.2.0 review, and the owner's point on 2026-10-09): the analysis reads it, but nothing in the editor sets it, and loading a file never copies it, so it is lost on load and on export. The standard rule (the second lane of a double route opens from four players, the constant `LANES_OPEN_FROM`) is the only one a person can have. Proposal, waiting for the owner's OK (it is a file addition and a new setting, so it would be 1.5.0): one box in Settings beside Players, "The second lane of a double route opens from N players" (2 means always open), written as `lanesUsableByPlayers`, carried through export and import, and the text in Map balance following it. It covers USA and Europe (from 4), Northern Lights (from 3) and Nordic and Switzerland (one lane at 2, open from 3); triple routes, which Northern Lights rules separately, are not covered.
- **Small boards (San Francisco, London) and a size of the board**: waits for measurements, which the owner will take from a small board: the whole unfolded board (width × height), a train piece (length × width) and, if it can be measured, the distance between two cities on a route of known length. The ttr-map-generator has no data for official boards (its `doc/measurement_instructions.md` asks the user for them), and the box sizes found on the web are not the boards'. A *size* of the board (small, normal, Anniversary, a scale beside the panel size) is two different things: as a print choice (as the Anniversary size is now, for the 2×3 only) it is a small addition; stored in the map it also changes what Map balance and the room per wagon are measured against, and is a file addition that needs the owner's OK. Leaning to storing it, so the analysis is right for a small map and Anniversary can follow the same mechanism. A board of one panel or less cannot be told to lie or stand by its shape (width against height), so a free size in millimetres needs that settled as well.
- Tickets to countries or groups of stops, as Switzerland has, are not modelled.
- **Names after a turn.** A name left to place itself is placed again after the board turns, and some
  then sit on a route; Move names clear fixes it in one click. Doing that as part of the turn would
  save the click, at the cost of moving names the person may have liked.
- **Rules text**: a link from one part of the rules to another, images, and a way to see in the
  preview where a printed page would break.
- **Safari** has not been tried for the small ticket map, the standing board or its print.
- **Phones**: the editor works, with the map panning inside its own area at a width a finger can use,
  but the tools come first and push the map down the page. A phone layout with the map first and the
  tools in a drawer would suit looking and light editing better.

## Decided against

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
