# Decisions

Choices that shaped the editor, why they were made, and what would make us change our minds. The
last line is the point: when a decision is revisited after more playtesting, this says what evidence
would settle it.

## Tickets are worth their shortest path

**Chosen.** A ticket's points equal the shortest path between its two stops, in wagon spaces.
Nothing else changes the value: not colour, not grey routes, not tunnels, not ferry locomotives, not
how crowded the corridor is.

**Why.** It is exact on the classic official maps — Nordic 46/46, India 58/58, Polska 35/35,
Switzerland's city tickets 34/34 — and it is the only rule with evidence across many maps. Adding a
ferry premium breaks Nordic from 46/46 to 13/46.

**Rejected.** Pricing difficulty or congestion. The risk of being blocked is part of play, not part
of a ticket's value, and no official designer prices it.

**Would change it.** A map with rules the editor cannot model, where playtesting shows the values
are plainly wrong. Modifiers exist for exactly that — a long-ticket bonus, a ferry premium, a manual
adjustment — all off unless a map asks for them. See `docs/TICKET-VALUATION.md`.

## One function decides a ticket's value

**Chosen.** `valueTicket` in `app/ticket-valuation.ts` is the only place points are set.

**Why.** Valuation is the part most likely to need a house rule. Keeping it in one function means a
new rule is a parameter, not a change to the search.

**Would change it.** Nothing foreseeable. If valuation ever depends on the deck as a whole rather
than one ticket, the signature grows; the single door stays.

## The default deck style is the average of seven maps, not the USA's habits

**Chosen.** `generic`: 1.1 tickets per stop, length bins `.18 .33 .22 .16 .11`, at most 7 tickets on
one stop, 3 % near-duplicates, and a periphery term that only penalises the wrong side.

**Why.** The first targets were fitted to the USA deck alone. Scored with them, several official
decks came out *worse* than random decks of the same size: Nordic 66 against 79, Switzerland 124
against 95, Northern Lights 93 against 76. They were one game's habits, not design rules. Only three
things separate an official deck from a random one across all seven: fewer very short tickets,
nearly every city used, and fewer routes left unused.

**Rejected.** Keeping `classic` as the default. It stays as a preset, as does `europe`.

**Would change it.** More official maps with full route and ticket data, especially Germany and
Märklin with their short/long split.

## Length bands are fractions of the map's own diameter

**Chosen.** Short, medium and long are cut at shares of the longest journey on the map, defaulting
to 0.35 and 0.60. The map carries both the cuts and the target mix.

**Why.** It is the measure the official decks were read with, so a mix carries between maps of
different sizes. Fixed wagon counts would mean something different on a small map than a large one.

**Rejected.** The invented fixed bands used at first, 7 and 13 wagon spaces.

**Would change it.** Evidence that players think in absolute lengths rather than relative ones.

## The suggester counts every lane, at the map's largest table

**Chosen.** `f_load` divides a route's load by the lanes usable at the map's **maximum** player
count, taken from the map's `laneRule` when it has one (docs/FILE-FORMAT.md, "The lane rule").

**Why.** Measured: where an official deck is distinguishable from random at all, it is balanced for
all lanes open, not for one lane per edge. Switzerland is the clearest — a 2–3 player map whose deck
is perfectly balanced for three players with both lanes open, and ordinary at two. See
`docs/ROUTE-LOAD.md` §5.2.

**Rejected.** Following the *smallest* table, which seemed right until the data said otherwise.

**Would change it.** A map whose rules keep doubles shut across its whole player range. None of the
eight calibration maps does; Nordic and Switzerland open theirs at three players.

## Player count changes the diagnosis, never the deck

**Chosen.** The bottleneck view follows the chosen player count. The deck score does not.

**Why.** Crowding is a reading of how tight a game gets, not a target to design against. Making the
score follow the player count would also move `f_load` on Nordic, Switzerland and India and
invalidate the calibration table.

**Would change it.** Playtesting that shows a deck built for five plays badly at two in a way the
bottleneck list does not already reveal.

## The load weight is 2, not the 0.5 it was fitted at

**Chosen.** Raised after the test asked for it, not before.

**Why.** At 0.5, suggestions spread their tickets more evenly over the map than the official decks
do, which run their busy corridors along routes that have a second lane. Suggestions fell below the
random median on 7 of 16 seed runs. Measured at 0.5, 1.5, 2, 3 and 6: at 3, suggestions on India and
Northern Lights break the "under 5" check, so 2 is the ceiling.

**Would change it.** Any change to the other weights or targets, which would need the whole
calibration rerun.

## No countries in the prototype

**Chosen.** Only city-to-city tickets. Border flags are dropped when reference maps are loaded.

**Why.** Countries only matter for tickets *to* a country, which need an endpoint that is a group of
stops — a model the `Ticket` type does not have. Transit through a country changes almost nothing:
0 of 34 tickets on Switzerland, 0 of 35 on Polska, 1 of 46 on Italia.

**Would change it.** Wanting to design a map with country tickets, which needs group endpoints first.

## A junction is a stop type, not a flag on a stop

**Chosen.** A stop type can be marked "no tickets end here". Stops of that type join routes and
nothing else.

**Why.** It puts the property where the map's vocabulary already lives, so a whole class of stops
gets it at once, and a new map starts with a Junction type ready to use.

**Rejected.** A boolean on each stop, which would have to be set one stop at a time.

## The map knows its board's shape; printing is asked for each time

**Chosen.** Settings offers two board shapes, `2×3` (790 × 525 mm) and `2×4` (1053 × 526 mm), and
wagons are always measured against that board. The Print button opens a dialog that decides the
run: one sheet, a sheet per panel or full size; A4, A3, US Letter or Tabloid; and for a 2×3, an
Anniversary size that prints the larger board at full size. All of it is picked in one table of sheets,
with a box of its own for the whole board on one big page. The choice is remembered in the
browser, never in the map. Every page prints upright with the map turned on it, because that is what
every browser does by default, Safari included. The arithmetic is in `docs/PRINTING.md`.

**Why.** One list used to mix the shape of the map with how it was printed, and a test sheet needed
a second setting to say which board it stood in for. Paper cannot be dropped — a 790 × 525 mm board
is 9 sheets of A4 but 12 of Letter, and the page size has to be declared in millimetres for the
print dialog to pick the orientation — but it is a decision about one print run, not about the map.

**Rejected.** Stretching old maps onto the new boards, as a format change used to. A 4 × 2 sheet
board is 41 % shorter than a 2×4, so stretching would distort every route; old maps are scaled
evenly and centred instead. Also rejected: bumping the file version for this, since the ids that
remain are ones every version 3 reader already knows. And a page box the size of the paper with
`@page` margin 0: Safari ignores that margin, and full size on A4 printed 18 sheets, every other one
blank.

**Would change it.** A second official board shape worth designing for, or printers that make the
10 mm margin and 8 mm caption a poor guess — both are constants in `app/print-plan.ts`.

## Files carry a version and keep what they do not understand

**Chosen.** Every file has an envelope with a schema version, and any field a reader does not
recognise is written back out untouched.

**Why.** Once files are in other people's hands the format is fixed. Without a version there is
nowhere to hang a migration; without preserving unknown fields, two people on different builds
destroy each other's work silently. See `docs/FILE-FORMAT.md`.

**Would change it.** Nothing. This is the floor, not a preference.

## Tests drive the work

**Chosen.** A feature starts with the checks it has to pass, written before the code, driving the
app the way a person does rather than calling internal functions.

**Why.** It has repeatedly caught real defects that looked like nothing: Dijkstra sized by the wrong
node list, which silently cut Denmark off Northern Lights; a corridor translated through the wrong
index list, which doubled the duplicate count on every map but read plausibly on seven of eight.

**Would change it.** Nothing. Where a check fails, the first question is which side is wrong — the
feature or the expectation — and the answer is stated either way.

## The tour video warms up when it is pointed at

**Chosen.** Pointing at the picture of the tour video in the welcome box adds a `preconnect` to
youtube-nocookie.com, so that the video starts at once when play is pressed. Nothing is loaded and no cookie
is set before play; the connection itself (DNS and the TLS handshake) does show the visitor's address to
Google. Decided by the owner on 2026-10-06, after the code review pointed out that it goes against the
letter of `docs/REVIEW.md` item 3.

**Why.** The video is the first thing a new visitor may press, and a few seconds' wait for it to start is
what a visitor remembers. The release notes say that it warms up when pointed at.

**Would change it.** A wish, from anyone who uses the editor, to have nothing at all leave the page before
play, or a visitor count that shows that the wait is not noticed. Removing it is one line in
`app/map-dialogs.tsx`.

## Names after a turn

**Decision.** Turning the board (standing it up or laying it down) also moves the stop names that would end up on a route,
as the button "Move names clear" does, in the same step. A name that is already clear of the routes and of the other names stays where it is, a locked name stays,
and what cannot be placed is said in the notice (and left as the turn put it). Undo takes the turn and the names back together.
Decided by the owner on 2026-10-09.

**Why.** A name left to place itself (no angle of its own) is placed again after a turn, and some then sit on a route; on the
example map four to five names did. Pressing the button was the cure every time, so the turn does it, at the cost of moving
names the person had not asked to move: only those that would sit on a route, never one that was already clear.

**Would change it.** A wish to have a turn move nothing but the geometry (the button is still there for it), or names that were
set by hand being moved; those are locked to stay (`labelLocked`).
