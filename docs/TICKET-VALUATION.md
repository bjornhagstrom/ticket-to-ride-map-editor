# How official maps value destination tickets

What the ticket points on 11 official Ticket to Ride maps say about valuation, and what the ticket suggester must allow for.

The data is in `data/ttr-reference-maps.json`, where each map has a `valuation` object; see `data/README.md` for the format. All numbers below come from comparing every printed ticket with shortest paths on the transcribed boards.

The graph used everywhere:

- Edge weight is the route length (the shortest lane between two stops).
- Border-flag stops (`deadEnd: true`) may end a path but never be passed through. This rule is set per map (`countryTransit`) and is `false` in the rulebooks of Italia, Switzerland and Märklin (Polska has only one entrance per country).
- A ticket to a country uses the nearest of its flags.

## 1. The baseline: points = shortest path

In every "classic" map a ticket is worth the length of the shortest path between its two stops.

| Map | Tickets equal to shortest path | Deviations |
| --- | --- | --- |
| Nordic Countries | 46 / 46 | – |
| India | 58 / 58 | – |
| Northern Lights | 54 / 55 | Helsinki–Gdańsk +1 |
| Polska | 35 / 35 | — (country cards are a separate bonus and do not change ticket values) |
| Europe | 43 / 46 | London–Wien +1 (ferry), Edinburgh–Athina +1 (longest deck), Stockholm–Wien −1 (maybe a transcription error) |
| USA | 25 / 30 | the 5 longest are +1/+2 |
| Switzerland (city–city) | 34 / 34 | – |
| Switzerland (country options) | 31 / 40 | Chur→France +1 off, Deutschland↔Italia, France↔Italia |

Things that do NOT change points on these maps:

- Colour of the route, and whether it is grey.
- Tunnels.
- Ferry locomotives. Nordic, Northern Lights, Europe and India have many ferries, and adding any premium for them breaks the fit. For example, Nordic falls from 46/46 to 13/46.

Small deliberate bonuses exist:

- The very longest tickets get +1–2 (USA, the Europe long deck).
- An occasional single card gets +1.

## 2. Maps whose special rules change valuation

On maps with a mechanism that makes some connections harder or more rewarding than their length, the designer priced tickets above the shortest path, never below.

| Map | Plain shortest path | What changes | Best simple model |
| --- | --- | --- | --- |
| **Italia** | 31 / 56 | Ferries use separate ferry cards; region bonus scoring | **Length + 0.5 per ferry (wave) space, total rounded up → 48 / 56.** The premium applies to Italia's ferries only; applied to the other ferry maps it breaks them. |
| **Iberia** | 29 / 50 | Festival bonus cards pull players toward the cities on display | No simple rule. 21 tickets are +1 to +5, including every long one to Palma. |
| **South Korea** | 20 / 44 | Coloured zones strongly affect play | No simple rule. The longest tickets are up to ~1.5× the path (Gangneung–Ulsan 20 vs 13). Route lengths were checked on the board. |
| **Japan** | 7 / 54 | Shared bullet-train track that everyone builds and uses | No shortest-path rule fits. Counting bullet spaces as half gives 11–18 / 54. Tickets inside the Tokyo inset are ~1.4× their path. The values look hand-set. |

Open anomaly: Italia Genova–Pescara prints 7, but the shortest path is 10.

## 3. What this means for the ticket suggester

1. **Keep the default at points = shortest path.** It is exact for the classic maps and is the only rule with evidence across many maps.
2. **Make valuation a pluggable function, not a constant.** A suggested ticket's points come from `valueTicket(path, map)`. The default returns the path length.
3. **Offer valuation modifiers as explicit, per-map options.** None should be on by default, and each option should show its effect in the preview.
   - **Long-ticket bonus:** +1 for tickets ≥ 0.9 × reach, +2 for the single longest (USA style).
   - **Ferry premium:** + `k` per ferry space, rounded up (Italia: `k` = 0.5). Only for maps where ferries need extra cards or effort beyond a locomotive; Europe/Nordic-style locomotive ferries get no premium.
   - **Designer adjustment:** a manual ±points field per ticket. Keep it separate from the computed value, so a re-suggest never overwrites it.
4. **Report difficulty separately from points.** On classic maps, tunnels, locomotives and grey routes are difficulty, not value. Show them as flags on the ticket.
5. **Rules the editor cannot model yet produce a warning, not a guess.** This covers zones, festivals, shared tracks and region bonuses. The warning should say the official maps with such rules valued tickets 1.2–1.5× the path, so the designer should expect to raise values by hand after testing.
6. **Graph rules the suggester must respect:**
   - Whether a path may pass through a country is a per-map rule (`countryTransit` = true, false or unknown), because rules differ between maps. Make it a map setting. The default for new maps is "no transit", since that is the rule in every rulebook that states it (Italia, Switzerland, Märklin).
   - A ticket to a country is completed via any of its entrances.
   - Waypoints are never ticket endpoints.
   - A map may have both train and ship routes (Rails & Sails). Keep `kind` on the route, and do not assume every route can be used by every piece.
7. **Calibration uses only maps with `useForCalibration: true`:** USA, Europe, Nordic, India, Northern Lights, Switzerland and Polska. Maps with hand-set values must not pull the length targets or the per-stop targets.

## 4. How to re-check

`scripts/ticket-suggester-reference.py` works on the classic maps. To test a valuation model against the data, rebuild the graph as described above, apply the model, and count exact matches for each map. The numbers in section 2 came from exactly that. Report per-map match counts whenever the model changes.
