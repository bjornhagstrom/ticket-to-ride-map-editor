# Proposal: uneven maps on purpose

Status: **for decision**, 2026-10-03. Nothing here is built. Section 6 lists the decisions to take.

## 1. The question

A map is not good because it is perfectly balanced. Chokepoints, a crowded corridor, a remote corner
that is expensive to reach, a hub everyone wants: these are often the challenge that makes a map worth
playing. How should the editor treat unevenness, and what support should it give a designer who wants
it?

## 2. What the editor does today

It mostly treats unevenness as a fault, in words and in numbers:

| Where | What it says or does |
| --- | --- |
| Left column | A stop with fewer than two neighbours is a *low-connection stop*, with a warning sign; "Well connected" is the reward. Europe's Edinburgh would be flagged. |
| Map balance, *Where the tickets crowd* | Lists routes more tickets want than they can carry, then: "Consider making one a double route, adding a way round, or moving a ticket. The fix is nearly always a change to the map." |
| Suggest routes | Proposes routes to poorly connected stops. |
| Deck score (suggester) | Penalises stops no ticket names, more than ~20 % of routes unused, tickets piling on one stop, and uneven load per lane. |
| About page, until today | Promised that official decks score below 5. They do not (section 3). |

Two things already point the other way. The score's load term divides traffic by the lanes a player
may use, so it is *satisfied* when heavy traffic runs over double routes: it rewards a contested
corridor, as long as it has a second lane. And route lengths, colours and tickets are free: nothing
stops a designer from building a tight map. But every message nudges towards evening it out.

## 3. What the official maps show

Measured on the eight official maps used for calibration, with the editor's own analysis (the
official deck as printed, at the largest table the map is for). "Ours" is the average of three decks
the editor suggests for the same map.

| Map | Crowded routes, official / ours | Traffic on double routes¹, official / ours | Routes no ticket needs, official / ours | Most tickets on one stop | Deck score, official / ours |
| --- | --- | --- | --- | --- | --- |
| USA | 8 / 7.7 | 2.2 / 1.9 | 14 % / 11 % | 5 | 10.2 / 2.1 |
| Europe | 9 / 11.7 | 2.0 / 2.3 | 17 % / 11 % | 4 | 4.1 / 2.5 |
| Nordic Countries | 9 / 7.0 | 1.7 / 1.6 | 7 % / 4 % | 7 | 26.1 / 3.3 |
| India | 9 / 8.0 | 1.4 / 1.7 | 13 % / 11 % | 5 | 25.5 / 3.7 |
| Switzerland² | 8 / 6.0 | 3.1 / 2.1 | 17 % / 9 % | 9 | 30.1 / 3.1 |
| Old West | 8 / 10.7 | 2.4 / 2.0 | 14 % / 13 % | 5 | 14.9 / 2.0 |
| Polska | 10 / 7.7 | 1.4 / 1.4 | 13 % / 9 % | 7 | 9.4 / 2.2 |
| Northern Lights | 19 / 16.3 | 2.2 / 2.1 | 21 % / 17 % | 7 | 34.5 / 3.8 |

¹ Mean ticket load on routes with two lanes against routes with one. Above 1 means the busy corridors
are the double ones. ² Most of Switzerland's deck is country tickets, which the editor does not model.

What it says:

1. **Every official map has crowded routes**: 8 to 19 at a full table. Contention is designed in.
2. **The crowding is put on double routes** (ratio 1.4 to 3.1 on every map). Designers make a corridor
   busy and then give it a second lane, which disappears at a small table. That is a chokepoint that
   tightens as the table shrinks: a design tool, not an accident.
3. **The official decks leave more of the map unneeded** than ours: 7 to 21 % of routes, against 4 to
   17 %. Quiet corners are allowed.
4. **Hubs exist**: up to 9 tickets on one stop.
5. **But the network itself has almost no single points of failure.** Only one of the eight maps has a
   route whose loss splits the board (Europe: Edinburgh–London, and it is a double route), and only one
   has a dead end. The pressure is in *demand*, not in *topology*.
6. **Our score calls every official deck worse than our own suggestions**: 4 to 35 against 2 to 4.
   Official decks are clearly better than random ones, so the score is not wrong about what is bad. It is
   wrong to treat the gap between an official deck and ours as the official designers' mistake. It is
   mostly character the score does not value.

The short version: real maps are *tense but connected*. They concentrate demand on purpose and relieve
it with double routes; they avoid stops and corridors that can be cut off.

## 4. Kinds of unevenness

The editor cannot know intent, but it can tell kinds apart, and some are almost never intended:

| Kind | Usually | What the editor can know |
| --- | --- | --- |
| A corridor many tickets want, with two lanes | Intended: the official pattern | Load per lane, at each table size |
| A corridor many tickets want, with one lane at every table | Sometimes intended, often a surprise | Same, plus whether a way round exists and how much longer it is |
| A hub many tickets name | Intended | Tickets per stop |
| A remote corner reached by long or costly routes | Intended | Distance, tunnels and locomotives on the way |
| A quiet region no ticket needs | Often intended in moderation | Routes no ticket needs, where they are |
| A route whose loss cuts the board in two | Rarely intended (1 of 8 maps, and doubled there) | Bridges and cut points, exactly |
| A stop no ticket names | Rarely intended | Exactly |
| A ticket whose points ignore how hard it is | Unintended | Already flagged as value ambiguous |

## 5. Options

**A. Keep it as it is.** Simple. But every message pushes designers towards bland maps, and the score
disagrees with the published games.

**B. Describe, don't judge.** Every figure gets the official range beside it, worded as a fact: "12
crowded routes at a full table. Official maps: 8 to 19." Warnings are kept for what is rarely intended
(section 4, last three rows). The advice about crowding is rewritten as options, not a fix. *Small:
mostly wording, plus figures we already compute.*

**C. Let the designer say what is intended.** Mark a route as *contested on purpose*, or a stop as a
*hub*. Analysis then lists those under *intended* rather than as problems, and the suggester stops
spreading tickets away from them. Stored in the map file. *Medium.*

**D. A deck tension setting.** On the same map, a calm deck spreads tickets out and a tense one sends
them through the same corridors. A choice in Suggest a deck (and in the map's deck rules), with the
official range marked: calm, like the official average, tense. Technically the weight on load per lane,
already a single number. *Medium, including calibration tests.*

**E. Two-sided targets in the score.** Too even is also off: penalise a deck for leaving fewer routes
unneeded, or crowding fewer corridors, than the official range, as well as more. Makes the suggester
produce decks with the official character by default. *Medium; needs the calibration redone and the
"suggestion beats official" test replaced.*

**F. A structural view.** Bridges, cut points and dead ends shown on the map, with the official counts
beside them, so a designer sees the difference between *contested* and *fragile*. *Small.*

**G. Learn from playtests.** Record which routes were claimed on the marked-up paper and set that
against the predicted crowding. The real measure of a chokepoint, but needs a way to enter a playtest
result. *Large.*

## 6. Decisions

1. **Should the editor describe rather than judge?** Recommended: **yes (B)**, now. It costs little,
   corrects a bias the measurements do not support, and changes nothing a designer has built.
2. **Should a designer be able to mark intended chokepoints and hubs (C)?** Recommended: **yes, later**,
   after B shows which figures people actually look at.
3. **Should a deck's tension be a choice (D), or should the default deck look like the official ones
   (E)?** Recommended: **D first**. It keeps today's calm default, makes tension a deliberate choice,
   and its range can be taken from the official decks. E changes every suggestion at once and can follow
   if D shows the official character is what most people pick.
4. **Should fragility be shown separately from contention (F)?** Recommended: **yes, with B**. It is the
   one kind of unevenness the official maps nearly never have, and it is exact.
5. **Playtest results (G)?** Recommended: **not now**; worth it once maps are being played on paper and
   people ask for it.

## 7. How the figures were measured

The eight calibration maps from the private reference data, converted as `tests/ticket-calibration.cjs`
does. Crowded routes, load ratio, unneeded routes, tickets per stop and score from `evaluateTicketDeck`
at the map's largest table; "ours" from `suggestTickets` with seeds 1 to 3 in the map's own style.
Bridges, cut points and dead ends by a depth-first search on the stops and routes, counting a double
route as one connection. The official scores match `docs/TICKET-SUGGESTER.md` §2b.
