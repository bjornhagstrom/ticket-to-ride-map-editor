// The ticket suggester on small invented maps. These checks need no private data, so they run for
// everyone, every time.
//
//   npm run test:synthetic
//
// What they show is that the suggester behaves: its decks are valid, repeatable, within what a
// player can build, worth what the shortest path says, and they follow the rules they are given. What
// they cannot show is that it is calibrated against the real games. That is
// tests/ticket-suggester.cjs and tests/ticket-calibration.cjs, against the private official maps.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-synthetic-"));
execFileSync("npx", ["tsc", "app/ticket-suggester.ts", "app/map-data.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck"], { cwd: root, stdio: "inherit" });
const { suggestTickets, evaluateTicketDeck, suggestedDeckSize, ticketEndStopCount, TICKET_SUGGESTER } = require(path.join(out, "ticket-suggester.js"));
const maps = require("./fixtures/synthetic-maps.cjs");

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };

// ---------------------------------------------------------------- an oracle of our own
// Shortest paths in wagon spaces, worked out here from the routes alone (Dijkstra), so a ticket's
// worth can be checked against something that is not the code under test.
function distances(data, from) {
  const near = new Map(data.stops.map((s) => [s.id, []]));
  for (const r of data.routes) { near.get(r.a).push([r.b, r.length]); near.get(r.b).push([r.a, r.length]); }
  const dist = new Map([[from, 0]]);
  const todo = new Set(data.stops.map((s) => s.id));
  while (todo.size) {
    let best = null;
    for (const id of todo) if (dist.has(id) && (best === null || dist.get(id) < dist.get(best))) best = id;
    if (best === null) break;
    todo.delete(best);
    for (const [other, length] of near.get(best)) if (!dist.has(other) || dist.get(best) + length < dist.get(other)) dist.set(other, dist.get(best) + length);
  }
  return dist;
}
const distance = (data, a, b) => distances(data, a).get(b) ?? null;
const pairKey = (t) => [t.a, t.b].sort().join("|");
const shape = (tickets) => tickets.map((t) => `${pairKey(t)}:${t.points}`).sort().join(",");
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

const made = { ring: maps.ring(), grid: maps.grid(), sparse: maps.sparse() };
const reachFor = (data) => Math.min(Math.floor(0.47 * data.wagonsPerPlayer), Math.max(...data.stops.map((s) => Math.max(...[...distances(data, s.id).values()]))));

for (const [name, data] of Object.entries(made)) {
  const started = Date.now();
  const r = suggestTickets(data, { seed: 1 });
  const elapsed = Date.now() - started;
  const junctions = new Set(data.stops.filter((s) => data.stopTypeStyles.find((t) => t.id === s.type)?.junction).map((s) => s.id));
  const connected = new Set(data.routes.flatMap((x) => [x.a, x.b]));
  const reach = reachFor(data);
  const want = suggestedDeckSize(data, "generic", ticketEndStopCount(data));

  check(`${name}: a deck is suggested, of the size the rules ask for`, r.tickets.length === want.regular + want.long && r.tickets.length > 0, `${r.tickets.length} tickets, asked for ${want.regular + want.long}`);
  check(`${name}: every ticket joins two different stops that are on the map`, r.tickets.every((t) => t.a !== t.b && data.stops.some((s) => s.id === t.a) && data.stops.some((s) => s.id === t.b)));
  check(`${name}: no ticket ends at a junction or at a stop nothing reaches`, r.tickets.every((t) => !junctions.has(t.a) && !junctions.has(t.b) && connected.has(t.a) && connected.has(t.b)));
  check(`${name}: every ticket can be built: a way exists, within what a player can build`, r.tickets.every((t) => { const d = distance(data, t.a, t.b); return d !== null && d <= reach; }), `reach ${reach}`);
  check(`${name}: no pair of stops is on two tickets`, new Set(r.tickets.map(pairKey)).size === r.tickets.length);
  const worth = r.tickets.map((t) => [t.points, distance(data, t.a, t.b)]);
  check(`${name}: a ticket is worth its shortest path in wagon spaces, or more where the way is hard`, worth.every(([points, d]) => points >= d && points <= d + 2) && worth.filter(([points, d]) => points === d).length >= worth.length * 0.8, JSON.stringify(worth.slice(0, 5)));
  check(`${name}: its report adds up: tickets, length bands`, r.report.regular + r.report.long === r.tickets.length && r.report.bins.reduce((a, b) => a + b, 0) === r.report.regular, JSON.stringify([r.report.regular, r.report.long, r.report.bins]));
  check(`${name}: every stop with a route is named by some ticket`, r.report.zeroStops === 0, `${r.report.zeroStops} not named`);
  check(`${name}: it takes well under two seconds`, elapsed < 2000, `${elapsed} ms`);

  const again = suggestTickets(data, { seed: 1 });
  check(`${name}: the same seed gives the same deck`, shape(again.tickets) === shape(r.tickets));
  const others = [2, 3, 4].map((seed) => shape(suggestTickets(data, { seed }).tickets));
  check(`${name}: another seed gives another deck`, others.some((s) => s !== shape(r.tickets)));

  const small = suggestTickets(data, { seed: 1, deckSize: 6 });
  check(`${name}: a deck of the size asked for`, small.tickets.length === 6, `${small.tickets.length}`);

  // what is already in the deck stays, and is built on
  const kept = r.tickets.slice(0, 3).map((t, i) => ({ ...t, id: `keep-${i}`, set: "main" }));
  const withKept = suggestTickets({ ...data, tickets: kept }, { seed: 5, keep: kept.map((t) => t.id), deckSize: 8, setId: "main" });
  const keptPairs = new Set(kept.map(pairKey));
  check(`${name}: tickets asked to be kept are kept, and the deck is made up to its size`, [...keptPairs].every((k) => withKept.tickets.map(pairKey).includes(k)) && withKept.tickets.length === 8, `${withKept.tickets.length} tickets`);
}

// ---------------------------------------------------------------- which stops count
// A deck is sized by the stops a ticket can end at: not a junction, and not a stop nothing reaches.
check("a ring of twelve stops has twelve to end a ticket at", ticketEndStopCount(made.ring) === 12);
check("a grid of twenty and a junction has twenty: the junction is only passed through", ticketEndStopCount(made.grid) === 20, String(ticketEndStopCount(made.grid)));
check("a map with nine stops, one of them an island, has eight", ticketEndStopCount(made.sparse) === 8, String(ticketEndStopCount(made.sparse)));
const apart = maps.build({ name: "Apart", stops: [["a", "A", 0, 0], ["b", "B", 1, 0], ["c", "C", 2, 0], ["d", "D", 3, 0], ["e", "E", 4, 0], ["f", "F", 5, 0]], routes: [["a", "b", 2], ["b", "c", 2], ["c", "a", 2], ["d", "e", 3]] });
check("where the network falls apart only the largest part counts, as the suggester works in it", ticketEndStopCount(apart) === 3, String(ticketEndStopCount(apart)));

// ---------------------------------------------------------------- the rules steer it
const grid = made.grid;
const withRule = (id, bins) => ({ ...grid, deckRules: [{ ...TICKET_SUGGESTER.styles.generic, id, label: id, basedOn: "generic", bins }] });
const lengths = (data, style) => suggestTickets(data, { style, seed: 1 }).tickets.map((t) => distance(grid, t.a, t.b));
const shortHeavy = lengths(withRule("short", [1, 0, 0, 0, 0]), "short"), longHeavy = lengths(withRule("long", [0, 0, 0, 0, 1]), "long");
check("a rule that wants short tickets gives a shorter deck than one that wants long tickets", mean(shortHeavy) + 3 <= mean(longHeavy), `${mean(shortHeavy).toFixed(1)} against ${mean(longHeavy).toFixed(1)} wagon spaces`);
check("and the deck from the short rule has mostly short tickets", shortHeavy.filter((d) => d <= 6).length >= shortHeavy.length * 0.5, shortHeavy.join(","));

const fewWagons = { ...grid, wagonsPerPlayer: 10 };
const limited = suggestTickets(fewWagons, { seed: 1 });
check("fewer wagons shorten what a player can be asked to build", limited.report.reach <= 4 && limited.tickets.every((t) => distance(grid, t.a, t.b) <= 4), `reach ${limited.report.reach}`);

// ---------------------------------------------------------------- judging a deck that was made by hand
const ring = made.ring;
const good = suggestTickets(ring, { seed: 1 });
const goodReport = evaluateTicketDeck({ ...ring, tickets: good.tickets.map((t) => ({ ...t, set: "main" })) }, { setId: "main" });
check("a suggested deck, judged again, is the deck it was: same size, same length bands", goodReport.regular === good.report.regular && JSON.stringify(goodReport.bins) === JSON.stringify(good.report.bins));
const lazy = Array.from({ length: 6 }, (_, i) => ({ id: `lazy-${i}`, a: "s0", b: "s1", points: 2, set: "main" }));
const lazyReport = evaluateTicketDeck({ ...ring, tickets: lazy }, { setId: "main" });
check("a deck of one ticket six times is found out: its repeats are seen", lazyReport.duplicatePairs.length >= 1, `${lazyReport.duplicatePairs.length} repeated pairs`);
check("and most stops are said to have no ticket", lazyReport.zeroStops >= 8, `${lazyReport.zeroStops} of 12`);
check("and it scores worse than the suggested deck", lazyReport.score > goodReport.score, `${lazyReport.score.toFixed(2)} against ${goodReport.score.toFixed(2)}`);
const exact = evaluateTicketDeck({ ...ring, tickets: good.tickets.map((t) => ({ ...t, set: "main" })) }, { setId: "main", pointsAudit: true });
check("points that are the shortest path are all recognised as such", exact.valuation.total > 0 && exact.valuation.exact === exact.valuation.total, JSON.stringify([exact.valuation.exact, exact.valuation.total]));
const inflated = evaluateTicketDeck({ ...ring, tickets: good.tickets.map((t) => ({ ...t, points: t.points + 5, set: "main" })) }, { setId: "main", pointsAudit: true });
check("and points five too high are all caught", inflated.valuation.exact === 0 && inflated.valuation.off.length === inflated.valuation.total, JSON.stringify([inflated.valuation.exact, inflated.valuation.off.length]));
const crowded = evaluateTicketDeck({ ...ring, tickets: Array.from({ length: 8 }, (_, i) => ({ id: `c-${i}`, a: "s0", b: i % 2 ? "s2" : "s3", points: 5, set: "main" })) }, { setId: "main" });
check("eight tickets that all want the same few routes make them crowded", crowded.bottlenecks.length >= 1, `${crowded.bottlenecks.length} crowded routes`);

// ---------------------------------------------------------------- what it refuses
const tiny = suggestTickets({ ...ring, stops: ring.stops.slice(0, 3), routes: ring.routes.filter((r) => ["s0", "s1", "s2"].includes(r.a) && ["s0", "s1", "s2"].includes(r.b)) }, { seed: 1 });
check("a map with fewer than four stops gets no deck, and is told why", tiny.tickets.length === 0 && /four stops/i.test(tiny.report.note || ""), tiny.report.note);
const unconnected = suggestTickets({ ...ring, routes: [] }, { seed: 1 });
check("a map with stops and no routes gets no deck either", unconnected.tickets.length === 0 && (unconnected.report.note || "").length > 0, unconnected.report.note);
const sparse = made.sparse;
check("a stop no route reaches is never given a ticket, however many are asked for", suggestTickets(sparse, { seed: 9, deckSize: 40 }).tickets.every((t) => t.a !== "c8" && t.b !== "c8"));
const greedy = suggestTickets(sparse, { seed: 9, deckSize: 40 });
check("asking for more tickets than there are pairs gives what there is, without hanging", greedy.tickets.length <= (8 * 7) / 2 && greedy.tickets.length >= 8, `${greedy.tickets.length} tickets`);

console.log(`${ok.length} passed, ${bad.length} failed`);
if (bad.length) { console.log("FAIL:"); for (const b of bad) console.log("  ✗ " + b); }
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
