# Ticket suggester — specification

This feature adds a **Suggest tickets…** button to the ticket editor. It proposes a complete destination-ticket deck for the current map, and the person then edits that deck. Every rule and target number below comes from the official Ticket to Ride decks. None of them come from our own maps.

- **Reference data:** `../ttr-reference-data/ttr-reference-maps.json`. It holds 15 official maps with routes, and 14 of them have tickets. Eight maps have `useForCalibration: true`: USA, Europe, Nordic, India, Switzerland, Old West, Polska and Northern Lights. On these maps points equal the shortest path, with at most a few exceptions. The file also has deck profiles and volume data for about 25 more maps. `../ttr-reference-data/README.md` describes the format.
- **Valuation:** `docs/TICKET-VALUATION.md`. How official maps value tickets, and when they do not follow the shortest path.
- **Reference implementation:** `scripts/ticket-suggester-reference.py`. It is Python and needs networkx. It suggests decks and evaluates existing decks with the same score. The numbers in this document come from running it.
- **The default style is `generic`** (§2b). Its targets are the mean of seven official decks. `classic` (USA) and `europe` remain as presets.

## 1. What the official decks show

Both official decks are complete in the data file. In the table, "reach" is the longest ticket a player can realistically build; it is defined in §4.1.

| | USA (30 tickets) | Europe (40 regular + 6 long) |
| --- | --- | --- |
| Tickets per stop | 0.83 | 0.85 regular, 0.13 long, 0.98 in total |
| Longest ticket, as a share of reach (21 for 45 trains) | 0.95 | regular 0.62, long 0.95–1.0 |
| Length histogram over reach bins `<.30 / .30–.45 / .45–.60 / .60–.75 / ≥.75` | 10 / 30 / 27 / 13 / 20 % | regular 25 / 53 / 20 / 2 / 0 %; long all ≥ .90 |
| Points − shortest path | 0 for 25 tickets; +1/+2 for the 5 longest | 0 for 43 of 46 |
| Endpoints of long tickets (≥ .60 of reach), periphery 0 = centre, 1 = edge | 0.62 | 0.62 |
| Endpoints of short tickets, compared with the map average | 0.38 vs 0.41 | 0.30 vs 0.37 |
| Most tickets naming one stop | 5 | 4 |
| Stops with no ticket | 6 | 0 |
| Near-duplicate pairs (definition in §4.4) | 1.6 % | 0.3 % |
| Routes on no ticket's shortest path | 14 % | 17 % |

Volume data from the other official maps:

- Most full-size maps have 44–58 tickets.
- Trains per player are 35–45.
- Germany and Märklin split their tickets into short (3/5–11) and long (12–22).

### Rules the design follows

1. **Points = shortest path in wagons.** Colour, grey routes, tunnels and ferry locomotives do not change points in Europe. Palermo–Constantinople needs 2 ferry locomotives and a tunnel and still gives exactly its 8 wagons. Only the very longest tickets get a bonus of +1–2, and only in the USA deck.
2. **About one ticket per stop,** not two.
3. **The train supply limits ticket length more than the size of the map does.** The longest ticket is about 0.47 × trains per player.
4. **Two deck styles.**
   - *Classic* (USA): one deck with lengths across the whole reach.
   - *Europe*: a short/medium regular deck, plus a small long deck at the edge of reach.
5. **Long tickets connect the edges of the map. Short tickets sit at or slightly inside the average.** Hubs are not given extra tickets. In the USA deck, tickets per stop do not correlate with a stop's number of neighbours (r ≈ 0).
6. **Some imperfection is normal.** About 1–2 % near-duplicate pairs and 15–25 % unused routes are fine. Only more than that is penalised.
7. **Difficulty is reported but not paid for.** Locomotives and tunnels on a ticket's path are shown to the designer. No regular ticket needs more than 2 ferry locomotives, so that is a soft limit.

## 2. Calibration check

The score (§4.5) must rank the official decks as good and random decks as bad. Random decks are decks of the same size drawn from all valid pairs.

| | Official deck | Random decks (median, 20 samples) | Suggested (seeds 1–3) |
| --- | --- | --- | --- |
| USA, classic | 3.6 | 32.7 | 0.6–1.0 |
| Europe, europe | 2.1 | 101.9 | 0.8–1.2 |

If a change to the weights or targets lets the official decks score worse than about 5, or random decks better than about 10, the calibration is broken.

## 2b. Multi-map calibration: why `generic` is the default

The first targets (§1, `classic`) were fitted to the USA deck alone. Scored with them, several official decks scored *worse* than random decks:

| Map | Official deck | Random decks (median) |
| --- | --- | --- |
| Nordic | 66 | 79 |
| Switzerland | 124 | 95 |
| Northern Lights | 93 | 76 |

The USA targets were USA habits, not design rules.

Across the seven classic calibration decks, only three things separate an official deck from a random deck of the same size (drawn from pairs within reach):

1. **Fewer very short tickets.** Less than 0.30 × reach is below random on 6 of 7 maps; more tickets fall in 0.30–0.45.
2. **Nearly every city is used.**
3. **Fewer routes are left unused.**

Periphery and near-duplicate rates are not consistent between maps. Tickets per stop range from 0.83 (USA) to 1.49 (India), with a mean of 1.1. Most tickets naming one stop range from 4 to 9.

The `generic` style therefore uses:

- **Length bins:** the mean of the seven decks, `.18 .33 .22 .16 .11`.
- **Tickets per stop:** 1.1.
- **Periphery:** relative only. Long-ish endpoints should be at or above the map's mean periphery, and short endpoints at or below it. Only the wrong side is penalised.
- **Most tickets per stop:** 7.
- **Near-duplicates:** 3 %.

Result with `generic` (Python reference, seeds 1–2; official decks limited to city–city tickets within reach):

| Map | Official | Suggested | Random (median) |
| --- | --- | --- | --- |
| USA | 10.2 | 1.7–1.9 | 22.4 |
| Nordic | 26.1 | 2.8–3.2 | 47.5 |
| India | 25.5 | 3.9–4.2 | 43.6 |
| Old West | 14.9 | 1.8–1.9 | 24.4 |
| Polska | 9.4 | 1.8–2.1 | 20.7 |
| Northern Lights | 34.5 | 3.4–3.7 | 43.0 |
| Switzerland | 30.1 | 2.6–3.5 | 29.0 |
| Europe (`europe` style) | 4.1 | 1.9–2.0 | 116.8 |

These numbers are from `load` weighted 2, not the 0.5 the targets were first fitted with. The load
term was raised after the test in `docs/ROUTE-LOAD.md` §C showed suggestions spreading their tickets
more evenly than the official decks do. Every score above moved with it, official and random alike,
so the relations are what matter, not the absolute figures: an official deck below random, and a
suggestion below the official deck. At weight 3 suggestions on India and Northern Lights break the
"under 5" check in §6, so 2 is the ceiling.

Northern Lights was remeasured after the reference data gained its real train count: 40 per player,
not the 45 that stood in for a missing value, which brings its reach from 20 down to 18. Polska's
count also arrived, 35, but its reach is 14 either way, so its row is unchanged.

Switzerland is the known exception, because a large part of its deck is country tickets, which the suggester does not model yet. The score is a guide, not a verdict. An official deck is expected to score clearly below random, and a suggestion is expected to score below the official deck.

## 3. API

Add this to `app/map-analysis.ts`, next to `reviewTickets`:

```ts
export type TicketStyle = "generic" | "classic" | "europe";
export type TicketSuggestOptions = {
  style: TicketStyle;          // default "generic"
  trainsPerPlayer: number;     // default 45
  ticketsPerStop?: number;     // override the style's value (generic 1.1, classic 0.85, europe 0.85 + 0.13 long)
  seed: number;                // default 1; "Shuffle" increments it
  keep: string[];              // ticket ids that must stay
  steps?: number;              // annealing steps, default 6000
};
export type TicketDeckReport = {
  diameter: number; reach: number; regular: number; long: number;
  bins: number[];                      // regular tickets per reach bin (5 bins)
  longPeriphery: number | null;        // mean periphery of endpoints of tickets ≥ .60 reach
  shortPeriphery: number | null;
  zeroStops: number; maxPerStop: number;
  duplicatePairs: [string, string][]; dupPct: number;
  unusedRoutes: string[]; unusedPct: number;
  hard: { ticketId: string; locomotives: number; tunnels: number }[];
  score: number;
};
export function suggestTickets(data: MapData, options: Partial<TicketSuggestOptions>): { tickets: Ticket[]; report: TicketDeckReport };
export function evaluateTicketDeck(data: MapData, options?: Partial<TicketSuggestOptions>): TicketDeckReport;
```

`evaluateTicketDeck` scores the deck the map already has. The Balancing view can show it all the time.

## 4. Algorithm

### 4.1 Graph and map constants

- Build the graph from `data.routes` with `buildAdjacency`.
- Parallel routes between the same two stops form one edge.
  - Its weight is the shortest of their lengths.
  - `lanes` is the number of routes.
  - `locos` is the number of `locomotiveSlots` on the shortest route.
  - `tunnel` is true when that route is drawn as a tunnel (`wagonStyle`/route type; match whatever the map uses).
- Ignore stops that have no routes. If the graph is not connected, use the largest component and say so in the report.
- Border countries: the test loader drops country and border-flag stops from the reference maps. The editor itself has no country concept (§4.8).
- Waypoints (kind `waypoint`) stay in the graph as junctions, but are never endpoints and never count as stops for coverage, periphery or tickets per stop.
- Run Dijkstra from every stop to get all-pairs distances `D`.

```
diameter = max D
reach    = min(diameter, floor(0.47 × trainsPerPlayer))           // 21 for 45 trains
periphery(stop) = mean D from the stop to all others, rescaled so that the most central stop is 0 and the most peripheral is 1
```

### 4.2 Style presets

| | generic (default) | classic (USA) | europe |
| --- | --- | --- | --- |
| Regular tickets | round(1.1 × stops) | round(0.85 × stops) | round(0.85 × stops) |
| Long tickets | 0 | 0 | round(0.13 × stops) |
| Regular pool | 0.15·reach ≤ L ≤ reach | 0.15·reach ≤ L ≤ reach | 0.15·reach ≤ L < 0.9·reach |
| Long pool | – | – | 0.9·reach ≤ L ≤ reach |
| Target bin shares (regular) | .18 .33 .22 .16 .11 | .10 .30 .27 .13 .20 | .25 .53 .20 .02 .00 |
| Periphery term | relative (§4.5) | point targets | point targets |
| Most tickets per stop | 7 | 5 | 5 |
| Near-duplicate allowance | 3 % | 2 % | 2 % |
| Point bonus | none | +1 when L ≥ 0.9·reach | none |

The lower bound is `max(3, round(0.15 × reach))`.

### 4.3 Candidates

A candidate is an unordered stop pair inside a pool. For each one, compute:

- `L`, and `frac = L / reach`.
- `bin`, from `frac` and the bin edges `0, .30, .45, .60, .75`.
- `load`: every route on any shortest path, weighted by the share of shortest paths that use it. Enumerate at most 32 shortest paths.
- `corridor`: the stops on any shortest path.
- `locos` and `tunnels`, counted on the shortest path with the fewest locomotives.

### 4.4 Near-duplicates

Two tickets x and y are near-duplicates when both of these hold:

- `min(Lx, Ly) / max(Lx, Ly) ≥ 0.6`, and
- once one ticket's corridor is built, the other costs ≤ 1 more wagon: `dist(a, corridor) + dist(b, corridor) ≤ 1` in either direction.

### 4.5 Score (lower is better)

Tickets with `frac ≥ .60`, whether in the regular or the long deck, count as "long-ish" for the endpoint terms.

```
f_bins   = Σ_bins (count − share × nRegular)² / nRegular               regular deck only
f_ends   (classic, europe) = (meanPeriphery(long-ish endpoints) − 0.62)²
                            + (meanPeriphery(short endpoints) − (mapMeanPeriphery − 0.05))²
f_ends   (generic)         = max(0, mapMeanPeriphery − meanPeriphery(long-ish endpoints))²
                            + max(0, meanPeriphery(short endpoints) − mapMeanPeriphery)²
f_cov    = Σ_stops max(0, count − maxPerStop)²          maxPerStop: generic 7, others 5
zero     = stops named by no ticket
f_dup    = max(0, duplicatePairs − dupRate × allPairs)  dupRate: generic 0.03, others 0.02
f_unused = max(0, unusedRoutes − 0.20 × routes)
f_load   = variance over edges of load / lanes
f_hard   = Σ_tickets max(0, locos − 2)

score = 10·f_bins + 400·f_ends + 1·f_cov + 0.5·zero + 4·f_dup + 1·f_unused + 2·f_load + 2·f_hard
```

Keep the constants and weights together in one exported object, so they can be tuned and their provenance is visible. The same values are at the top of the Python reference.

### 4.6 Search

1. Start with the kept tickets, sorted into the regular and long groups.
2. Fill the long deck first, then the regular deck. Each step samples 80 candidates from the group's pool and adds the one that gives the lowest score.
3. Improve with simulated annealing for `steps` iterations:
   - Swap a non-kept ticket with an unused candidate from the same group. Choose the long group with probability 0.15 when it exists.
   - Accept the swap when the score drops, otherwise with probability `exp((old − new)/T)`, where `T = 5·(1 − k/steps) + 0.01`.
4. Use a seeded PRNG such as mulberry32, so the same map and seed always give the same deck.

Performance notes:

- Precompute the near-duplicate relation for every candidate pair once, as a bitset or boolean matrix.
- Update the score incrementally: a swap changes only one ticket's contributions.
- Python takes 9–15 s with full re-scoring. An incremental TypeScript version should take well under a second. If it doesn't, run it in a Web Worker.

### 4.7 Output

- Return ordinary `Ticket` objects: `{ id, a, b, points, long }`, with `points = L + bonus` as set by the style.
- The suggester does not learn a points-per-space rate from the map's existing tickets. `reviewTickets` keeps its own fit.
- Tickets with `locos > 0` or `tunnels > 0` are listed in `report.hard`, so the designer can see them.

### 4.7b Valuation is pluggable

Read `docs/TICKET-VALUATION.md` before implementing points. The default stays `points = shortest path` (§4.7), but the value must come from one function, `valueTicket(path, map, options)`, so that the following can be added as explicit per-map options without touching the search:

- a long-ticket bonus
- a ferry premium (Italia style, +0.5 per ferry space, rounded up)
- a manual designer adjustment kept separate from the computed value

Maps with rules the editor cannot model (zones, festivals, shared tracks) get a warning instead of a guessed value.

Also flag, without changing the value, any ticket where a path exists that costs exactly +1 space and uses fewer routes. Label it *value ambiguous (+1 alternative)*. That pattern explains 6 of the 10 remaining deviations on the calibration maps; see `docs/TICKET-VALUATION.md`.

Maps that do not follow the shortest path must never be used to tune targets or weights: Italia, Iberia, South Korea, Japan, Rails & Sails Great Lakes (often below the path) and Rails & Sails World (always above it). Their rules, such as harbours, tours, country cards and festival cards, are recorded as `specialRules` in the data. Tours (R&S World) have their own key, `tours`, and are out of scope for the suggester.

### 4.8 Border countries and waypoints

- **Not part of the prototype.** Border countries do not change city–city tickets on the official maps. If a path may pass through a country, 0 of 34 tickets change on Switzerland, 0 of 35 on Polska and 1 of 46 on Italia. They only matter for tickets *to* a country, which need group endpoints and are out of scope. The editor gets no country setting or stop type for this.
- The Python reference and the acceptance tests drop country and border-flag stops when they load the reference maps. That keeps the maps comparable.
- Waypoints and other non-city stops are junctions only. Paths may pass through them, but they are never ticket endpoints.

## 5. UI

- **Suggest tickets…** opens a dialog with:
  - style (Classic / Europe), with one line explaining each
  - trains per player
  - the resulting deck size, with an override
  - a choice between "Keep existing tickets" and "Replace all"
- The preview shows the report for the current deck and the suggestion side by side. Each metric shows the official range next to it (§1), for example "Near-duplicates 1.1 % (official 0.3–1.6 %)". There are two buttons: **Apply** and **Shuffle** (seed + 1). There is no Cancel button. A run is fast enough that nothing needs stopping, and closing the dialog the normal way (close icon, Esc or clicking outside) discards the suggestion.
- Applied tickets are ordinary tickets. The existing review verdicts apply to them.
- The Balancing view can shade routes by `load / lanes`, mark unused routes, and flag hard tickets.

## 6. Acceptance checks

**Multi-map check (the main one).**

1. Build every map with `useForCalibration: true` from `../ttr-reference-data/ttr-reference-maps.json` as `MapData`. Use `trainsPerPlayer` from the data, or 45 when it is missing. Drop country and border-flag stops, and keep waypoints as junctions.
2. With `generic` (Europe with `europe`), check each map:
   - The official deck, limited to city–city tickets within reach, scores below the median of 10 random decks of the same size. Switzerland is the known exception.
   - `suggestTickets` with seeds 1 and 2 scores < 5 and below the official deck.
   - No suggested ticket has a non-city stop as an endpoint.
3. Compare the §2b table metric by metric, not ticket by ticket.

**Valuation check.** With the default `valueTicket`, the printed points of the official tickets match exactly:

| Map | Exact matches |
| --- | --- |
| Nordic | 46 / 46 |
| India | 58 / 58 |
| Polska | 35 / 35 |
| Switzerland city tickets | 34 / 34 |
| Old West | 41 / 42 |
| Northern Lights | 54 / 55 |
| Europe | 43 / 46 |

This is the test that the graph is built correctly: dead ends, waypoints and parallel lanes.

**Classic and europe presets.** These checks still hold for the older presets:

Build the USA and Europe maps from `../ttr-reference-data/ttr-reference-maps.json` as `MapData`: stops from `stops`, routes from `routes`, locomotives from `ferryLocomotives`, tunnels from `tunnel`. Then check:

- `evaluateTicketDeck` on the official decks gives:
  - USA, classic: score < 5, dupPct 1.6, unusedPct 14, maxPerStop 5.
  - Europe, europe: score < 5, dupPct 0.3, unusedPct 17, maxPerStop 4.
- `suggestTickets` with defaults gives:
  - USA: 31 regular tickets, each regular bin within ±2 of its target, no ticket longer than 21, score < 5.
  - Europe: 40 regular + 6 long tickets, every long ticket 19–21, score < 5.
- Random decks of the same size score above 10 (the median in §2).
- The same seed gives an identical deck, and `keep` tickets are always included.
- A map with fewer than 4 stops, or with an empty pool, returns an empty deck and a report that explains why. It does not throw.

The exact tickets will differ from the Python reference because the PRNGs differ. Compare the metrics, not the ticket lists.

## 7. Known data gaps

- Europe's source does not mark double routes, and colours are only grey or not grey. That affects only `f_load`. The data file says what was corrected.
- Märklin has routes but no tickets yet. Germany is missing, so the short/long split (as in Europe) is only checked on Europe.
- Country tickets (Switzerland, Italia, Polska) need endpoints that are a group of stops. The editor's `Ticket` model does not support that yet, so the suggester only proposes city–city tickets.
- The route graphs for maps other than USA, Europe and India were extracted from board photos and confirmed by Björn; `notes` in the data file lists what was checked.

## Sources

- **USA routes:** github.com/Rob217/TicketToRideAnalysis.
- **USA tickets:** the original 30-card deck.
- **Europe routes and tickets:** github.com/leonsi7/ticket-to-ride-europe, with two corrections listed in the data file.
- **Volume data:** rulebooks and product pages, listed per map in the data file.
- **Background:**
  - Quantum Dice, *How to make your own Ticket to Ride map*
  - mgfernan, *Graph theory to model Ticket to Ride*
  - Schaefer & Schaefer (2025), arXiv 2511.08441
  - de Mesentier Silva et al., *Evolving maps and decks for Ticket to Ride*
