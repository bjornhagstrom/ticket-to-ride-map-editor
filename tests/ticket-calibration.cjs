// Acceptance checks for the ticket suggester against the eight official maps marked
// `useForCalibration` in the private reference data (ttr-reference-maps.json). The targets come from
// docs/TICKET-SUGGESTER.md §6 and docs/TICKET-VALUATION.md.
//
//   npm run test:calibration
//
// The suggester is plain logic, so it is compiled with the project's own TypeScript and run in Node.
// The Python reference in scripts/ticket-suggester-reference.py produces the same metrics; the
// ticket lists differ because the two use different random number generators.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
// The official maps are private and live in their own repository beside this one
// (../ttr-reference-data), or wherever TTR_REFERENCE_DATA points. Without them these checks cannot
// run, and they say so and step aside: the editor itself needs none of this data.
const referencePath = process.env.TTR_REFERENCE_DATA || path.join(root, "..", "ttr-reference-data", "ttr-reference-maps.json");
if (!fs.existsSync(referencePath)) {
  console.log(`Reference data not found at ${referencePath}.\nThese checks calibrate the suggester against the official maps, so they need the private ttr-reference-data repository beside this one, or TTR_REFERENCE_DATA pointing at its ttr-reference-maps.json. Skipped. "npm run test:synthetic" checks that the suggester behaves, on invented maps, and needs no data.`);
  process.exit(0);
}
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-calibration-"));
execFileSync("npx", ["tsc", "app/ticket-suggester.ts", "app/map-data.ts",
  "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck"],
  { cwd: root, stdio: "inherit" });
const { suggestTickets, evaluateTicketDeck, mulberry32 } = require(path.join(out, "ticket-suggester.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };

// ---------------------------------------------------------------- reference maps as MapData
const reference = JSON.parse(fs.readFileSync(referencePath, "utf8"));
const calibrationMaps = reference.maps.filter((map) => map.useForCalibration);

// "2-5" and the like, as the data writes it.
const playersOf = (source) => {
  const match = /^(\d+)\s*-\s*(\d+)$/.exec(String(source.players || ""));
  return match ? { min: Number(match[1]), max: Number(match[2]) } : { min: 2, max: 5 };
};

const trainsOf = (source) => {
  const value = source.trainsPerPlayer ?? (source.setup || {}).trainsPerPlayer;
  return typeof value === "number" ? value : 45;
};

// Border flags are dead ends the suggester has no concept of, so they are dropped. Waypoints stay in
// the graph as junctions: journeys run through them, no ticket ends at one.
const buildMap = (source) => {
  const dropped = new Set(source.stops.filter((stop) => stop.deadEnd || stop.kind === "country" || stop.kind === "country-group").map((stop) => stop.id));
  const stops = source.stops.filter((stop) => !dropped.has(stop.id)).map((stop, i) => ({
    id: stop.id, name: stop.name, type: stop.kind === "waypoint" ? "junction" : "city",
    x: stop.x ?? i * 10, y: stop.y ?? i * 10,
  }));
  const routes = source.routes.filter((route) => !dropped.has(route.a) && !dropped.has(route.b)).map((route, i) => ({
    id: `r-${i}`, a: route.a, b: route.b, length: route.length, type: "city", color: route.color ?? "neutral",
    locomotiveSlots: Array.from({ length: route.ferryLocomotives ?? 0 }, (_, k) => k),
    wagonStyle: route.tunnel ? "tunnel" : undefined,
  }));
  const tickets = (source.tickets || [])
    .filter((ticket) => ticket.a && ticket.b && !dropped.has(ticket.a) && !dropped.has(ticket.b))
    .map((ticket, i) => ({ id: `t-${i}`, a: ticket.a, b: ticket.b, points: ticket.points, long: ticket.long || undefined, set: "main" }));
  return {
    name: source.name, format: "board-2x3", background: [], stops, routes, notes: [],
    lineStyles: [], routeTypeStyles: [{ id: "city", label: "City", stroke: "#736d64", dash: "", strokeWidth: 3, infrastructure: false }],
    wagonStyles: [],
    stopTypeStyles: [{ id: "city", label: "City", fill: "#fff", stroke: "#000" }, { id: "junction", label: "Junction", fill: "#eee", stroke: "#888", junction: true }],
    tickets, ticketSets: [{ id: "main", label: "Main deck" }],
    wagonsPerPlayer: trainsOf(source), startingTickets: 3, keptTickets: 2,
    // The map's own player range and double-route rule, so the score counts the lanes a player may
    // actually use at the largest table it is built for (docs/ROUTE-LOAD.md §5).
    players: playersOf(source),
    laneRule: source.lanesUsableByPlayers,
  };
};

const styleFor = (id) => (id === "europe" ? "europe" : "generic");
const built = new Map(calibrationMaps.map((source) => [source.id, buildMap(source)]));
check("all eight calibration maps build", built.size === 8, [...built.keys()].join(", "));

// ---------------------------------------------------------------- valuation: the printed points
// The real test that the graph is right: dead ends, waypoints and parallel lanes all have to be
// handled correctly for the printed points to come back out.
const expectedExact = {
  nordic: [46, 46], india: [58, 58], poland: [35, 35], switzerland: [34, 34],
  oldwest: [41, 42], northernlights: [54, 55], europe: [43, 46], usa: [25, 30],
};
for (const source of calibrationMaps) {
  const map = built.get(source.id);
  const report = evaluateTicketDeck(map, { style: styleFor(source.id), pointsAudit: true });
  const [wanted, total] = expectedExact[source.id];
  const audit = report.valuation;
  check(`${source.id}: the printed points come back out of the graph`,
    audit.exact === wanted && audit.total === total,
    `${audit.exact} of ${audit.total} exact, expected ${wanted} of ${total}${audit.off.length ? ` · off: ${audit.off.slice(0, 4).map((x) => `${x.a}–${x.b} ${x.printed}≠${x.path}`).join(", ")}` : ""}`);
}

// ---------------------------------------------------------------- the official decks beat random
const randomDeck = (map, size, seed, reach, pairs) => {
  const random = mulberry32(seed);
  const picked = [];
  const used = new Set();
  while (picked.length < size && used.size < pairs.length) {
    const pair = pairs[Math.floor(random() * pairs.length)];
    const key = pair.join("|");
    if (used.has(key)) continue;
    used.add(key);
    picked.push({ id: `rand-${picked.length}`, a: pair[0], b: pair[1], points: 1, set: "main" });
  }
  return { ...map, tickets: picked };
};

const officialScores = {};
for (const source of calibrationMaps) {
  const map = built.get(source.id);
  const style = styleFor(source.id);
  const official = evaluateTicketDeck(map, { style });
  officialScores[source.id] = official;
  const pairs = official.reachablePairs;
  const scores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    .map((seed) => evaluateTicketDeck(randomDeck(map, official.regular + official.long, seed, official.reach, pairs), { style }).score)
    .sort((a, b) => a - b);
  const median = (scores[4] + scores[5]) / 2;
  // Switzerland is the known exception: much of its real deck is country tickets, which the
  // suggester does not model, so what is left scores worse than a random draw.
  const expected = source.id !== "switzerland";
  check(`${source.id}: the official deck ${expected ? "beats" : "does not beat"} random decks`,
    (official.score < median) === expected, `official ${official.score.toFixed(1)} against random median ${median.toFixed(1)}`);
}

// ---------------------------------------------------------------- suggestions
for (const source of calibrationMaps) {
  const map = built.get(source.id);
  const style = styleFor(source.id);
  const official = officialScores[source.id];
  for (const seed of [1, 2]) {
    const { tickets, report } = suggestTickets(map, { style, seed, tension: 0 });
    check(`${source.id}: seed ${seed} scores under 5`, report.score < 5, report.score.toFixed(1));
    check(`${source.id}: seed ${seed} scores better than the official deck`, report.score < official.score,
      `${report.score.toFixed(1)} against ${official.score.toFixed(1)}`);
    const junctions = new Set(map.stops.filter((stop) => stop.type === "junction").map((stop) => stop.id));
    check(`${source.id}: seed ${seed} never ends a ticket at a junction`,
      tickets.every((ticket) => !junctions.has(ticket.a) && !junctions.has(ticket.b)),
      `${junctions.size} junctions on the map`);
  }
}

// ---------------------------------------------------------------- busy corridors sit on double routes
// docs/ROUTE-LOAD.md §2: the official decks run their busiest corridors along routes that have a
// second lane. The ratio is mean load on multi-lane edges over mean load on single ones.
const publishedRatio = { usa: 2.20, europe: 1.97, nordic: 1.68, india: 1.35, switzerland: 3.10, oldwest: 2.42, poland: 1.39, northernlights: 2.15 };
const loadRatios = {};
console.log("\nLoad ratio, multi-lane against single-lane (docs/ROUTE-LOAD.md §2 in brackets):");
console.log(`  ${"map".padEnd(16)}${"official".padStart(9)}${"published".padStart(11)}${"random".padStart(9)}${"seed 1".padStart(8)}${"seed 2".padStart(8)}`);
for (const source of calibrationMaps) {
  const map = built.get(source.id);
  const style = styleFor(source.id);
  const official = evaluateTicketDeck(map, { style });
  const pairs = official.reachablePairs;
  const size = official.regular + official.long;
  const randoms = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    .map((seed) => evaluateTicketDeck(randomDeck(map, size, seed, official.reach, pairs), { style }).loadRatio)
    .filter((value) => value !== null)
    .sort((a, b) => a - b);
  const randomMedian = randoms.length ? (randoms[4] + randoms[5]) / 2 : null;
  const suggested = [1, 2].map((seed) => suggestTickets(map, { style, seed, tension: 0 }).report.loadRatio);
  loadRatios[source.id] = { official: official.loadRatio, randomMedian, suggested };
  const show = (value) => (value === null || value === undefined ? "  —" : value.toFixed(2));
  console.log(`  ${source.id.padEnd(16)}${show(official.loadRatio).padStart(9)}${String(publishedRatio[source.id]).padStart(11)}${show(randomMedian).padStart(9)}${show(suggested[0]).padStart(8)}${show(suggested[1]).padStart(8)}`);
}

for (const source of calibrationMaps) {
  const { official, randomMedian, suggested } = loadRatios[source.id];
  if (official === null || randomMedian === null) { check(`${source.id}: has lanes to compare`, false, "no multi-lane or no single-lane edges"); continue; }
  // India is the known exception: its official deck does not favour the double routes.
  const expected = source.id !== "india";
  check(`${source.id}: the official deck ${expected ? "leans on" : "does not lean on"} the double routes`,
    (official > randomMedian) === expected, `${official.toFixed(2)} against a random median of ${randomMedian.toFixed(2)}`);
  // A single anneal run is stochastic and the ratio swings by a third between seeds, so the pair is
  // judged together. Both are printed above, so one seed sliding is still visible.
  const meanSuggested = suggested.reduce((sum, value) => sum + (value ?? 0), 0) / suggested.length;
  check(`${source.id}: suggestions are at least as concentrated as chance`, meanSuggested >= randomMedian,
    `${suggested.map((v) => (v === null ? "—" : v.toFixed(2))).join(" and ")} against a random median of ${randomMedian.toFixed(2)}`);
}

// ---------------------------------------------------------------- bottlenecks follow the table
for (const source of calibrationMaps.slice(0, 3)) {
  const map = built.get(source.id);
  const style = styleFor(source.id);
  const large = evaluateTicketDeck(map, { style, atTable: 5 });
  const small = evaluateTicketDeck(map, { style, atTable: 2 });
  // Fewer usable lanes lift every multi-lane edge at once, which moves the busiest-tenth cut as
  // well, so the count is not monotonic. What must hold is that no edge gets roomier.
  const largeRatio = new Map(large.bottlenecks.map((edge) => [`${edge.a}|${edge.b}`, edge.ratio]));
  check(`${source.id}: no edge is roomier at a smaller table`,
    small.bottlenecks.every((edge) => edge.ratio >= (largeRatio.get(`${edge.a}|${edge.b}`) ?? 0)),
    `${small.bottlenecks.length} at two players, ${large.bottlenecks.length} at five`);
  check(`${source.id}: every bottleneck names the tickets that crowd it`,
    large.bottlenecks.every((edge) => edge.ticketIds.length === edge.tickets && edge.tickets > 0),
    `${large.bottlenecks.length} edges`);
  check(`${source.id}: a double route counts as one lane at a small table`,
    small.bottlenecks.every((edge) => edge.lanesUsable === 1) && large.bottlenecks.every((edge) => edge.lanesUsable === edge.lanes));
}

// ---------------------------------------------------------------- the +1 pattern is flagged
// docs/TICKET-VALUATION.md: several official +1 cards follow a path that costs one space more but
// is built from fewer routes. The suggester never raises a value for it, but it must say so.
const flagged = (mapId, a, b) => {
  const map = built.get(mapId);
  const report = evaluateTicketDeck({ ...map, tickets: [{ id: "x", a, b, points: 1, set: "main" }] }, { style: styleFor(mapId) });
  return report.ambiguous.length === 1;
};
check("Old West: Seattle–Great Falls is flagged as value ambiguous", flagged("oldwest", "seattle", "great-falls"));
check("Northern Lights: Helsinki–Gdansk is flagged as value ambiguous", flagged("northernlights", "helsinki", "gdansk"));
check("a plain ticket is not flagged", !flagged("poland", built.get("poland").tickets[0].a, built.get("poland").tickets[0].b),
  `${built.get("poland").tickets[0].a}–${built.get("poland").tickets[0].b}`);

// ---------------------------------------------------------------- determinism and edge cases
const usa = built.get("usa");
const sameDeck = (x, y) => JSON.stringify(x.map((t) => [t.a, t.b, t.points].join()).sort()) === JSON.stringify(y.map((t) => [t.a, t.b, t.points].join()).sort());
check("the same seed gives the same deck", sameDeck(suggestTickets(usa, { seed: 4 }).tickets, suggestTickets(usa, { seed: 4 }).tickets));
check("a different seed gives a different deck", !sameDeck(suggestTickets(usa, { seed: 4 }).tickets, suggestTickets(usa, { seed: 5 }).tickets));
check("the default style is generic", suggestTickets(usa, { seed: 1 }).report.style === "generic", suggestTickets(usa, { seed: 1 }).report.style);

const tiny = { ...usa, stops: usa.stops.slice(0, 3), routes: usa.routes.slice(0, 2), tickets: [] };
const tinyResult = suggestTickets(tiny, {});
check("a map with too few stops returns an empty deck and a reason", tinyResult.tickets.length === 0 && Boolean(tinyResult.report.note), tinyResult.report.note || "no note");
check("a map with no routes does not throw", suggestTickets({ ...usa, routes: [], tickets: [] }, {}).tickets.length === 0);
check("evaluating an empty deck does not throw", evaluateTicketDeck({ ...usa, tickets: [] }, {}).regular === 0);

// ---------------------------------------------------------------- the table in §2b
console.log("\nMetrics against docs/TICKET-SUGGESTER.md §2b (Python reference in brackets):");
// The §2b table as it stands now: load weighted 2, and the reference data's own train counts.
// The calibration here is of calm decks (tension 0), the objective docs/TICKET-SUGGESTER.md §2b describes: a
// deck built like the official maps (the default since 1.0) crowds corridors on purpose and so scores worse
// on evenness. tests/deck-tension.cjs holds what the other places on the scale do.
const published = { usa: [10.2, 1.8], nordic: [26.1, 3.0], india: [25.5, 4.0], oldwest: [14.9, 1.85], poland: [9.4, 1.95], northernlights: [34.5, 3.55], switzerland: [30.1, 3.05], europe: [4.1, 1.95] };
console.log(`  ${"map".padEnd(16)}${"official".padStart(9)}${"published".padStart(11)}${"suggested".padStart(11)}${"published".padStart(11)}`);
for (const source of calibrationMaps) {
  const style = styleFor(source.id);
  const suggested = suggestTickets(built.get(source.id), { style, seed: 1, tension: 0 }).report.score;
  const [pubOfficial, pubSuggested] = published[source.id];
  console.log(`  ${source.id.padEnd(16)}${officialScores[source.id].score.toFixed(1).padStart(9)}${String(pubOfficial).padStart(11)}${suggested.toFixed(1).padStart(11)}${String(pubSuggested).padStart(11)}`);
}

console.log("\nPASS:"); ok.forEach((line) => console.log("  ✓ " + line));
if (bad.length) { console.log("FAIL:"); bad.forEach((line) => console.log("  ✗ " + line)); }
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
