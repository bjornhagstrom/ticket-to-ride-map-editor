# Task: build the ticket suggester in the editor

This is the start prompt for the implementation session. It points to the files; the files hold the details.

## Goal

Add **Suggest tickets…** to the ticket editor. It proposes a complete destination-ticket deck for the current map. The designer can inspect, shuffle, apply and then edit it like any other tickets.

## Read first, in this order

1. `docs/TICKET-SUGGESTER.md`: the spec (API, algorithm, score, UI, acceptance checks). Sections §2b, §4.7b and §6 are the most recent.
2. `docs/TICKET-VALUATION.md`: how official maps value tickets. Default points = shortest path.
3. `data/README.md`: the format of the reference data.
4. `scripts/ticket-suggester-reference.py`: the Python reference. Port its logic; don't redesign it. Run it with `python3 scripts/ticket-suggester-reference.py 'data/ttr-reference-maps.json#nordic' --evaluate` (needs networkx).
5. `app/map-data.ts` and `app/map-analysis.ts`: the existing `Ticket`, `MapData`, `buildAdjacency`, `shortestPath` and `reviewTickets`.

## What to build

1. **`suggestTickets` and `evaluateTicketDeck`** in `app/map-analysis.ts`, with the §3 types.
   - Styles: `generic` (default), `classic` and `europe`, with the constants in one exported object.
   - Seeded PRNG (mulberry32).
   - Incremental score and a precomputed near-duplicate matrix. Use a Web Worker if a run takes more than about 1 second.
2. **`valueTicket(path, map, options)`** as the only place points are set. The default is the path length.
   - Per-map opt-in modifiers, off by default: long-ticket bonus, ferry premium, manual designer adjustment.
   - Flag *value ambiguous (+1 alternative)* when a path exists that costs exactly one space more but uses fewer routes. Never raise the value automatically.
3. **Graph rules.**
   - Parallel lanes form one edge with a `lanes` count.
   - Only city–city tickets. Stops that are not cities, such as waypoints or anything else the editor marks as non-city, are junctions: never endpoints, and not counted as stops.
   - **No country feature in the prototype.** Border countries do not affect city–city tickets: 0 of 34 on Switzerland, 0 of 35 on Polska and 1 of 46 on Italia change if transit through a country is allowed. Don't add a `countryTransit` setting or a country stop type. When the test loads reference maps, drop country stops from the graph.
4. **UI (§5).**
   - The dialog has style, trains per player, deck size, and keep existing or replace all.
   - The preview shows the report next to the official range for each metric.
   - Buttons: Apply and Shuffle (seed + 1). No Cancel button; closing the dialog discards the suggestion.
   - Applied tickets are ordinary tickets.
5. **Tests (§6).**
   - Load each map with `useForCalibration: true` from `data/ttr-reference-maps.json`.
   - **Valuation:** the default `valueTicket` must reproduce the printed points: Nordic 46/46, India 58/58, Polska 35/35, Switzerland city tickets 34/34, Old West 41/42, Northern Lights 54/55, Europe 43/46.
   - **Score:** each official deck scores below random decks; Switzerland is the known exception.
   - **Suggestions:** seeds 1 and 2 score < 5 and below the official deck, and no suggested ticket has a non-city stop as an endpoint.
   - **Determinism:** the same seed gives the same deck.
   - **Edge cases:** a map with fewer than 4 stops returns an empty deck and a reason, and does not throw.
   - Compare metrics with the Python reference, not exact ticket lists.

## Out of scope for now

- Countries in general: country tickets (endpoint = a group of stops), transit rules and country bonuses.
- Tours (R&S World) and any special-rule valuation: zones, festivals, harbours, country cards, shared tracks. Show a warning instead.
- Tuning targets on maps with `useForCalibration: false`.

## Working rules

- Work on a branch and commit locally in small steps.
- Never push, open a PR or publish anything without Björn's explicit approval for that specific action.
- Keep the Python reference and the TypeScript constants in sync. If you change a target or weight, rerun the §6 checks and update the §2b table.
