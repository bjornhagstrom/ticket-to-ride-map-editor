# How official maps value destination tickets

What the ticket points on 14 official Ticket to Ride maps say about valuation, and what the ticket suggester must allow for.

The data is in `../ttr-reference-data/ttr-reference-maps.json`, where each map has a `valuation` object; see `../ttr-reference-data/README.md` for the format. All numbers below come from comparing every printed ticket with shortest paths on the transcribed boards.

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
| Old West | 41 / 42 | Seattle–Great Falls +1 (fewer routes, see below) |
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

### The "fewer routes" pattern behind many +1 cards

Björn noticed this on Old West. Seattle–Great Falls prints 9. The cheapest path is 8 (Seattle–Spokane 4, Spokane–Missoula 2, Missoula–Great Falls 2), but the natural path is Seattle–Spokane 4 + the red 5 to Great Falls = 9. That path has one route less, so it costs one turn less to build.

The same explains 6 of the 10 deviations on the calibration maps: a path exists that is exactly +1 space and uses fewer routes, and the card follows it.

- Old West: Seattle–Great Falls.
- Northern Lights: Helsinki–Gdańsk.
- USA: Los Angeles–Chicago, Los Angeles–Miami and Los Angeles–New York.
- Europe: Edinburgh–Athina.

It is **not** a general rule. Applied to every ticket ("use the +1 path when it has fewer routes"), it breaks many exact cards: India falls from 58/58 to 46/58, Northern Lights from 54/55 to 37/55, Old West from 41/42 to 37/42.

What the suggester should do with it:

- Keep points = shortest path.
- When a path exists that costs exactly +1 and has fewer routes, flag the ticket as *value ambiguous (+1 alternative)* in the preview. The designer can then choose.
- Never raise the value automatically.

## 2. Maps whose special rules change valuation

On maps with a mechanism that makes some connections harder or more rewarding than their length, the designer priced tickets above the shortest path. The exception is Great Lakes, where many tickets are below it. The two Rails & Sails maps do not follow the path in either direction, so treat train/ship maps as uncalibrated.

| Map | Plain shortest path | What changes | Best simple model |
| --- | --- | --- | --- |
| **Italia** | 31 / 56 | Ferries use separate ferry cards; region bonus scoring | **Length + 0.5 per ferry (wave) space, total rounded up → 48 / 56.** The premium applies to Italia's ferries only; applied to the other ferry maps it breaks them. |
| **Iberia** | 29 / 50 | Festival bonus cards pull players toward the cities on display | No simple rule. 21 tickets are +1 to +5, including every long one to Palma. |
| **South Korea** | 20 / 44 | Coloured zones strongly affect play | No simple rule. The longest tickets are up to ~1.5× the path (Gangneung–Ulsan 20 vs 13). Route lengths were checked on the board. |
| **Japan** | 7 / 54 | Shared bullet-train track that everyone builds and uses | No shortest-path rule fits. Counting bullet spaces as half gives 11–18 / 54. Tickets inside the Tokyo inset are ~1.4× their path. The values look hand-set. |
| **Rails & Sails – Great Lakes** | 11 / 55 | Trains and ships; separate pieces | No path rule fits, and 30 cards are *below* the shortest path (Marquette–Albany 10 vs 16). Weighting ship spaces ×0.7 gives 25 / 55 at best. The values look hand-set, possibly based on the distance on the map rather than on the route network. |
| **Rails & Sails – World** | 4 / 57 | Trains and ships; harbours; tour cards | Every card is at or above the path (mean 1.35×, up to 1.83×). Weighting trains ×1.5 and ships ×1.25 gives 24 / 57 at best. Tour cards follow a fixed pattern: out-of-order ≈ ⅔ of in-order, and the penalty is in-order + 6. |

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
7. **Calibration uses only maps with `useForCalibration: true`:** USA, Europe, Nordic, India, Northern Lights, Switzerland, Polska and Old West. Maps with hand-set values must not pull the length targets or the per-stop targets.

## 4. How to re-check

`scripts/ticket-suggester-reference.py` works on the classic maps. To test a valuation model against the data, rebuild the graph as described above, apply the model, and count exact matches for each map. The numbers in section 2 came from exactly that. Report per-map match counts whenever the model changes.
