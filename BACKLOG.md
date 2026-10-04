# Backlog

What is agreed with the owner and not built yet, newest decisions first within each part. Kept current
in the same commit as the work (AGENTS.md).

## Agreed and next

- **The official range beside every balance figure** (step one of uneven maps, the rest of it): routes
  no ticket needs (official 7–21 %), most tickets on one stop (4–9), traffic on double routes against
  single ones (1.4–3.1), average hub degree, colour balance. Stated as a fact, never as a warning.
- **Intended chokepoints and hubs**: a route marked *contested on purpose*, a stop marked *hub*, in
  Properties. Map balance lists them as intended instead of among the crowded, and Build a full deck
  of tickets keeps sending tickets through them. Stored in the map file as an addition.
- **Deck tension as a choice**: calm, like the official maps, or tense, in Build a full deck of tickets
  and in the map's deck rules; the middle one calibrated to land inside the official range of crowded
  routes. Today's behaviour stays the default.
- **Print the rules alone from the Rules panel**, with a button there (the print dialog can already
  do it by unticking the board and the cards).
- **Printing and PDF**: say in the print dialog that it saves a PDF too; give the browser a file name
  worth keeping (map, version, what is printed, date); a page of the balance figures as they stood,
  ticked in the print dialog, so a printed or saved milestone says what the editor thought of the map.
- **Illustrations where words fall short** (list to be made, then drawn from the editor's own data):
  line styles, stop types, how the sheets tile the board in the print dialog, label angles.
- **The tour video in the welcome box**, from YouTube, played only when asked (a picture with a play
  button that loads the player on click), and a link to About.
- **About** checked against the film and the editor as it is, with screenshots.

## Waiting

- **Two-sided score targets**: too even counts against a deck too, so suggestions take on the
  official character by default. Needs the calibration redone. After deck tension, and only if the
  official setting proves to be what most people choose.
- **Playtest results**: which routes were claimed on the marked-up sheet and which tickets were made,
  entered after a game and set against the predicted crowding, per map version. A printed playtest
  sheet (date, players, scores, tickets made and missed, notes) could be its paper half. Large.
- **A longer end card on the tour video**, for YouTube's end screen.
- **Map collaboration** (accounts, shared maps, versions, live editing): waits; the editor stays
  without a backend for now. Notes on what a first version would hold are in the git history of this
  file.

## Smaller follow-ups

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

- The rules in the PNG image of the map.
- Mirroring or turning a map's content on its own board.
- Reading a stop × stop table of route lengths (as fan generators use) as a route list.

## The case for uneven maps

`docs/PROPOSAL-UNEVEN-MAPS.md` has the measurements. Built: crowding set against the official range,
and how the network holds together (dead ends, routes that cut the map in two, corners), with buttons
for what it warns of. The rest is above.
