# Shared routes, bottlenecks and double routes

This covers how tickets that share the same routes should affect the ticket suggester and the Balancing view. It builds on `docs/TICKET-SUGGESTER.md`, where `load` and `lanes` are defined in §4.1, §4.3 and §4.5.

## Question

Many tickets may need the same routes. That is an advantage if you have already built there, and it can close you out if you haven't. Should it change ticket points or the deck? Should double routes count?

## Findings

### 1. Congestion does not change ticket points

The official designers do not price congestion. Tickets through the busiest routes are still worth exactly their shortest path:

| Map | Tickets equal to shortest path |
| --- | --- |
| Nordic | 46 / 46 |
| India | 58 / 58 |
| Polska | 35 / 35 |
| Old West | 41 / 42 |

The risk of being blocked is part of play, not part of a ticket's value. **Do not add a congestion premium to `valueTicket`.**

### 2. Official decks put the busiest corridors on double routes

We measured `load` for each route: the number of tickets whose shortest paths use it, shared evenly among the shortest paths. We then compared routes with several lanes against single routes, in the official deck and in random decks of the same size. Random decks are drawn from city pairs within reach, 10 samples, median.

| Map | Share of routes with 2+ lanes | Load ratio (multi / single), official | Load ratio, random | Multi-lane share of the 10 % busiest routes, official | Same, random |
| --- | --- | --- | --- | --- | --- |
| USA | 28 % | 2.20 | 1.57 | 100 % | 57 % |
| Europe | 12 % | 1.97 | 1.45 | 44 % | 28 % |
| Nordic | 21 % | 1.68 | 1.27 | 50 % | 25 % |
| India | 35 % | 1.35 | 1.51 | 50 % | 50 % |
| Switzerland | 20 % | 3.10 | 1.92 | 100 % | 50 % |
| Old West | 55 % | 2.42 | 1.79 | 100 % | 75 % |
| Polska | 34 % | 1.39 | 1.23 | 50 % | 42 % |
| Northern Lights | 46 % | 2.15 | 1.91 | 80 % | 90 % |

On 7 of 8 maps the official ratio is above random; India is the exception. The designers either placed double routes where tickets crowd, or chose tickets that run along the double routes. Either way, the busiest corridors have spare lanes.

The current score already accounts for this in part. `f_load` is the variance of `load / lanes` over routes, so a double route can carry twice the tickets before it counts as crowded. The suggestions (style `generic`, seed 1) follow the pattern, but more weakly than the originals:

| Map | Suggested ratio | Official ratio | Suggested multi-lane share of the busiest 10 % |
| --- | --- | --- | --- |
| USA | 1.50 | 2.20 | 86 % |
| Nordic | 1.72 | 1.68 | 67 % |
| Old West | 2.04 | 2.42 | 100 % |

### 3. Double routes depend on the player count

Each map sets its own threshold for when a double route opens; see §5. The standard rule limits every multi-lane route to one lane at 2–3 players. The 2–3 player maps (Nordic, Switzerland), India and Northern Lights open double routes already at 3 players.

## What to build

### A. Bottleneck warning in the Balancing view (map feedback)

- For the current deck, compute `load` per route pair: all parallel routes between the same two stops count as one edge with `lanes` = number of routes.
- A bottleneck is an edge where `load / lanesUsable` is high:
  - `lanesUsable` comes from the map's `lanesUsableByPlayers` (§5) for the chosen player count. Without data, use the standard rule: 1 lane at 2–3 players, all lanes at 4+.
  - Flag it when the ratio is in the top 10 % of edges and ≥ 3 tickets, or ≥ 2 × the mean ratio.
- Show bottlenecks as a list, with stops, length, lanes, load and the tickets that use the edge, and highlight them on the map.
- Suggested action text: "Many tickets need this route. Consider making it a double route, adding an alternative path, or moving a ticket." The fix is usually a change to the **map**, not to the tickets.
- A player-count control switches `lanesUsable`. Its range is the map's `players {min, max}`, and it defaults to `max`.

### B. Player count in the deck report

- `TicketDeckReport` gets `bottlenecks: { a, b, lanes, load, ticketIds }[]` for each player-count mode, or a `players: "2-3" | "4-5"` option on `evaluateTicketDeck`.
- The suggester keeps optimising for 4–5 players, because that is where double routes count. The report shows both modes so the designer sees how much tighter 2–3 players is.

### C. Test on the calibration maps

For every map with `useForCalibration: true`:

- For the official deck, the load ratio (multi / single) is above the random median, except India. This checks the metric itself.
- For suggestions (seeds 1 and 2), the ratio is ≥ the random median. Report it next to the official value.
- Only if suggestions fall clearly below the official ratio on most maps, strengthen the load term, for example by raising the `f_load` weight from 0.5, and rerun all §6 checks in `docs/TICKET-SUGGESTER.md`. Don't tune before the test says so.

## Built

A, B and C are built. `lanesUsableByPlayers` came into the editor's own map model, the score counts
the lanes open at the map's largest table, and the balancing view lists crowded routes at a table
the designer picks inside the map's range, marking them on the map. Feeding the real per-map lane
rules into the calibration changed no score on any of the eight maps, which is what §5.3 predicted
and is now checked rather than assumed.

## Outcome of C

The test was built and run on all eight calibration maps. Two things came out of it.

**The metric is a faithful port.** The official load ratio reproduces the §2 table exactly on all
eight maps, and India is the exception there too.

**The load term needed strengthening.** With `f_load` at 0.5, suggestions fell below the random
median on 7 of 16 seed runs and clearly below the official ratio on 5 of 8 maps — the condition §C
sets for tuning. Raising the weight was measured at 0.5, 1.5, 2, 3 and 6:

| `f_load` weight | Load-ratio shortfalls | §6 score checks |
| --- | --- | --- |
| 0.5 | 7 of 16 | pass |
| 1.5 | 3 of 16 | pass |
| **2** | **0 of 8 map pairs** | **pass** |
| 3 | 2 of 16 | India and Northern Lights break "under 5" |
| 6 | fewest | several break |

The weight is now **2**. The §6 checks were rerun and the §2b table in `docs/TICKET-SUGGESTER.md` was
rewritten, since every score moved with the weight.

Ratios at weight 2 (mean load on multi-lane edges over mean load on single ones):

| Map | Official | Random median | Seed 1 | Seed 2 |
| --- | --- | --- | --- | --- |
| USA | 2.20 | 1.59 | 1.66 | 1.72 |
| Europe | 1.97 | 1.55 | 2.99 | 1.89 |
| Nordic | 1.68 | 1.35 | 1.69 | 1.48 |
| India | 1.35 | 1.38 | 1.77 | 1.67 |
| Switzerland | 3.10 | 1.98 | 2.32 | 1.96 |
| Old West | 2.42 | 1.77 | 1.95 | 2.24 |
| Polska | 1.39 | 1.17 | 1.07 | 1.53 |
| Northern Lights | 2.15 | 1.92 | 1.96 | 2.06 |

A single anneal run is stochastic: the ratio swings by a third between seeds on the same map, as
Polska's 1.07 and 1.53 show. The test therefore judges the two seeds together against the random
median, and prints both so one seed sliding is still visible.

## Answered: should the score follow the map's player range?

Yes, by reading the lanes usable at the map's **maximum** player count rather than `lanes` raw. §5
below measured the official decks and found them balanced for all lanes open, not for one lane per
edge, so counting lanes in full is right — but the count itself belongs to the map. On all eight
calibration maps the two are the same, because every one of them opens all lanes at its own maximum.
The difference shows on a map of one's own built for two or three players under the standard rule.

The premise the question was asked on was wrong: Nordic and Switzerland do not keep their doubles
shut across their whole range. They open at three players.

## Not in scope

- A congestion premium on points: official decks don't have one.
- Simulating actual games (who blocks whom). The load measure is a static proxy.
- Special route types, such as ferries, tunnels and ships, are not treated differently here.

## How the numbers were produced

The Python reference is `scripts/ticket-suggester-reference.py`, and the data is `../ttr-reference-data/ttr-reference-maps.json`. `Model.cand()` gives each ticket's `load`, and `Model.lanes` gives the lane counts. Official decks were limited to city–city tickets within reach, with country stops removed.

## 5. Follow-up: per-map double-route rules and whether decks are balanced for them

Added 2026-09-29 at the build session's request. **Measured** = computed from `../ttr-reference-data/ttr-reference-maps.json` with the Python reference. **Confirmed** = read in the rulebook text. **Secondary** = a verbatim quote or summary on another site. **Inferred** = neither.

### 5.1 The rule per map (data: `doubleRouteRule`, `lanesUsableByPlayers`, `doubleRouteRuleSource`)

| Map | Players | `doubleRouteRule` | Usable lanes by player count | Source |
| --- | --- | --- | --- | --- |
| USA | 2–5 | `restricted-below-4` | 2: 1, 3: 1, 4+: all | secondary: verbatim rulebook quote on 64ouncegames.com |
| Europe | 2–5 | `restricted-below-4` | 2: 1, 3: 1, 4+: all | secondary: BGG rules thread (page returned 403, so the title was the only thing read) — **treat as inferred** |
| Nordic | 2–3 | `restricted-below-3` | 2: 1, 3: all | **confirmed**, rulebook |
| Switzerland | 2–3 | `restricted-below-3` | 2: 1, 3: all | secondary: Esoteric Order of Gamers rules summary, quoting the rule |
| India | 2–4 | `restricted-below-3` | 2: 1, 3–4: all | secondary: fan wiki |
| Old West | 2–6 | `restricted-below-4` | 2: 1, 3: 1, 4+: all (doubles and triples) | **confirmed**, rulebook |
| Polska | 2–4 | `restricted-below-4` | 2: 1, 3: 1, 4: all | **confirmed**, rulebook |
| Northern Lights | 2–5 | `restricted-below-3` | doubles 2: 1, 3+: all; triples 2: 1, 3: 2, 4+: all | **confirmed**, rulebook |
| Other maps | – | `null` | – | not checked |

The premise needed one correction. On Nordic and Switzerland, doubles are **not** closed for the whole player range. They are one lane at 2 players and open at 3, so they are not lanes that can never open. The enum therefore has a fifth value, `restricted-below-3`. `lanesUsableByPlayers` carries the exact counts, including Northern Lights' triples (1 / 2 / all), which fit no single threshold. The builder should read `lanesUsableByPlayers`, not the enum.

**Gaps filled:** Polska is 2–4 players with 35 trains (confirmed, rulebook). Northern Lights is 2–5 players (Days of Wonder product page) with 40 trains ("200 trains, 40 per player", rulebook).

### 5.2 Are official decks balanced for one lane or for all lanes? (measured)

**Method.** For each edge (parallel routes merged), take `load / usable`:

- **all lanes:** `usable = lanes`
- **one lane:** `usable = 1`

Three numbers are compared:

- the variance of `load / usable` over edges (what `f_load` uses)
- the mean of the busiest 10 % of edges
- the maximum

The official deck is compared with 30 random decks of the same size, drawn from city pairs within reach. The table gives the **share of random decks that are more balanced than the official deck**. Low means the official deck is unusually balanced in that mode; about 50 % means it looks like random.

| Map (player range) | Rule | Variance, all lanes | Busiest 10 %, all lanes | Variance, one lane | Busiest 10 %, one lane |
| --- | --- | --- | --- | --- | --- |
| Switzerland (2–3) | below-3 | **0 %** | **0 %** | 17 % | 50 % |
| Nordic (2–3) | below-3 | 37 % | 60 % | 70 % | 77 % |
| Northern Lights (2–5) | below-3 | 40 % | 60 % | 87 % | 90 % |
| India (2–4) | below-3 | 80 % | 83 % | 57 % | 60 % |
| USA (2–5) | below-4 | **13 %** | **17 %** | 67 % | 80 % |
| Old West (2–6) | below-4 | **3 %** | **3 %** | 37 % | 53 % |
| Polska (2–4) | below-4 | 27 % | 27 % | 60 % | 67 % |
| Europe (2–5) | below-4 | 0 % | 0 % | 0 % | 3 % (only 12 % of edges have 2 lanes, so the modes barely differ) |

**Reading.**

- Where the deck is distinguishable from random, it is balanced for **all lanes open**. That holds on Switzerland, USA and Old West, and more weakly on Polska.
- With one lane per edge, every map with many doubles looks like random or worse. Nordic, Northern Lights and USA land at 60–90 %.
- Nordic does not stand out in either mode; it is only slightly better with all lanes.
- India is the exception, as in §2: it is worse than random in both modes.
- Together with the load ratio in §2 (busy corridors sit on double routes on 7 of 8 maps), there is no sign that any designer tuned a deck for the restricted case. Switzerland is the clearest: a 2–3 player map whose deck is perfectly balanced for 3 players with both lanes open, and ordinary at 2.

### 5.3 What this implies (for the build session; nothing changed here)

- **The suggester's `f_load` should keep counting lanes in full,** using the lanes usable at the map's **maximum** player count. That is what the official decks match. This is a data-backed confirmation of the current behaviour. No weight or target in `TICKET-SUGGESTER.md` was changed.
- **The bottleneck view should follow the selected player count,** using `lanesUsableByPlayers`, down to the map's minimum. It is a diagnostic of how tight the smallest game gets, not a target for the suggester.
- **Possible spec change (not made):** if the map's `players.max` is below the threshold, for example a custom 2–3 player map on the standard rule, then no lane beyond the first can ever open and the full-lane count would be wrong. In that case `f_load` should use `lanesUsableByPlayers[players.max]`. None of the official maps hits this case. Nordic and Switzerland looked like they did, but their rule opens doubles at 3.
- **Knock-on: Northern Lights' `trainsPerPlayer` is now 40,** not the default 45, so reach drops from 20 to 18. Rerunning `generic` with 40 trains (measured): official 31.0, random median 37.1, suggested (seed 1) 1.3. The official deck still beats random, but the §2b row in `TICKET-SUGGESTER.md` (23.6 / 35.8 / 1.5–1.6) was computed with 45 trains and should be updated by the build session. Polska at 35 trains keeps reach 14, so its numbers are unchanged.
- **The §2 table here** used 45 trains for Northern Lights, and for Polska through the same default. The Polska row is unaffected; Northern Lights would drop 2 of 55 tickets that are over reach, which changes nothing visible.

Sources:

- [USA rules quote](https://www.64ouncegames.com/pages/ticket-to-ride)
- [BGG Europe thread](https://boardgamegeek.com/thread/2124330/double-routes-in-2-3-player-game)
- [Nordic rulebook](https://edp.org/Games/TicketToRideNordicCountries.pdf)
- [Switzerland rules summary](https://www.orderofgamers.com/downloads/TicketToRideSwitzerland_v1.1.pdf)
- [India wiki](https://ticket-to-ride.fandom.com/wiki/India)
- [Old West rulebook](https://cdn.svc.asmodee.net/staging-daysofwonder/uploads/2024/07/720128-T2RMC6-Rules-OldWest-EN-2019-1.pdf)
- [Polska rulebook](https://cdn.1j1ju.com/medias/2e/e9/d8-ticket-to-ride-map-collection-61-2-poland-rulebook.pdf)
- [Northern Lights rulebook](https://archive.org/details/ticket-to-ride-northern-lights-rules)
- [Northern Lights product page](https://www.daysofwonder.com/game/ticket-to-ride-northern-lights/)
