# Ticket suggester — specification

This feature adds a **Suggest tickets…** button to the ticket editor. It proposes a complete destination-ticket deck for the current map, and the person then edits that deck. Every rule and target number below comes from the official Ticket to Ride decks. None of them come from our own maps.

- **Reference data:** `data/ttr-reference-maps.json`. It holds the full USA and Europe maps (routes and tickets), deck profiles, and volume data for about 25 other official maps.
- **Reference implementation:** `scripts/ticket-suggester-reference.py`. It is Python and needs networkx. It suggests decks and evaluates existing decks with the same score. The numbers in this document come from running it.

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

## 3. API

Add this to `app/map-analysis.ts`, next to `reviewTickets`:

```ts
export type TicketStyle = "classic" | "europe";
export type TicketSuggestOptions = {
  style: TicketStyle;          // default "classic"
  trainsPerPlayer: number;     // default 45
  ticketsPerStop?: number;     // override the style's value (classic 0.85, europe 0.85 + 0.13 long)
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
- Run Dijkstra from every stop to get all-pairs distances `D`.

```
diameter = max D
reach    = min(diameter, floor(0.47 × trainsPerPlayer))           // 21 for 45 trains
periphery(stop) = mean D from the stop to all others, rescaled so that the most central stop is 0 and the most peripheral is 1
```

### 4.2 Style presets

| | classic | europe |
| --- | --- | --- |
| Regular tickets | round(0.85 × stops) | round(0.85 × stops) |
| Long tickets | 0 | round(0.13 × stops) |
| Regular pool | 0.15·reach ≤ L ≤ reach | 0.15·reach ≤ L < 0.9·reach |
| Long pool | – | 0.9·reach ≤ L ≤ reach |
| Target bin shares (regular) | .10 .30 .27 .13 .20 | .25 .53 .20 .02 .00 |
| Point bonus | +1 when L ≥ 0.9·reach | none |

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
f_ends   = (meanPeriphery(long-ish endpoints) − 0.62)²
         + (meanPeriphery(short endpoints) − (mapMeanPeriphery − 0.05))²
f_cov    = Σ_stops max(0, count − 5)²
zero     = stops named by no ticket
f_dup    = max(0, duplicatePairs − 0.02 × allPairs)
f_unused = max(0, unusedRoutes − 0.20 × routes)
f_load   = variance over edges of load / lanes
f_hard   = Σ_tickets max(0, locos − 2)

score = 10·f_bins + 400·f_ends + 1·f_cov + 0.5·zero + 4·f_dup + 1·f_unused + 0.5·f_load + 2·f_hard
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

### 4.8 Border countries and waypoints

- Whether a path may pass through a border country, entering at one flag and leaving at another, differs between maps. Model it as a map setting `countryTransit` with the default `false`. When it is `false`, border-flag stops are dead ends: a shortest path may start or end there but never pass through. The rulebooks of Italia, Switzerland and Märklin all say `false`; Polska has one entrance per country, so transit cannot happen there.
- A ticket to a country is completed via any of its flags, so its distance is the shortest path to the nearest flag. The suggester may propose such tickets only if the editor supports ticket endpoints that are a group of stops; until then it only uses cities.
- Waypoints (kind `waypoint`) are junctions only: never ticket endpoints, but paths may pass through them.

## 5. UI

- **Suggest tickets…** opens a dialog with:
  - style (Classic / Europe), with one line explaining each
  - trains per player
  - the resulting deck size, with an override
  - a choice between "Keep existing tickets" and "Replace all"
- The preview shows the report for the current deck and the suggestion side by side. Each metric shows the official range next to it (§1), for example "Near-duplicates 1.1 % (official 0.3–1.6 %)". There are three buttons: **Apply**, **Shuffle** (seed + 1) and **Cancel**.
- Applied tickets are ordinary tickets. The existing review verdicts apply to them.
- The Balancing view can shade routes by `load / lanes`, mark unused routes, and flag hard tickets.

## 6. Acceptance checks

Build the USA and Europe maps from `data/ttr-reference-maps.json` as `MapData`: stops from `stops`, routes from `routes`, locomotives from `ferryLocomotives`, tunnels from `tunnel`. Then check:

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
- Only USA and Europe have full route and ticket data. Adding more official maps to `data/ttr-reference-maps.json` would let the style presets be checked against them, especially Germany and Märklin with their short/long split, and Nordic and Switzerland, which have 40 trains.

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
