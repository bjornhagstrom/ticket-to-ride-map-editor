// A deck's tension: calm, like the official maps, or tense. Measured on the eight calibration maps,
// each built twice per tension, against the official decks: how hard the busiest route is crowded at a
// full table, and how many routes no ticket needs. Written before the tension setting existed.
//
//   npm run test:deck-tension
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const referencePath = process.env.TTR_REFERENCE_DATA || path.join(root, "..", "ttr-reference-data", "ttr-reference-maps.json");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-tension-"));
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/ticket-suggester.ts", "app/map-data.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck"], { cwd: root, stdio: "inherit" });
const { suggestTickets, evaluateTicketDeck, tensionWeight, tensionPeakWeight, TENSION_EXPECTED, TENSION_OFFICIAL } = require(path.join(out, "ticket-suggester.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
check("a tension from 0 to 100 has a weight on uneven traffic: 2 for calm, 0 for like the official maps, -1.75 for tense", tensionWeight(0) === 2 && tensionWeight(50) === 0 && tensionWeight(100) === -1.75, JSON.stringify([tensionWeight(0), tensionWeight(50), tensionWeight(100)]));
check("and a weight on the busiest route, 2 at calm, none from the middle up", tensionPeakWeight(0) === 2 && tensionPeakWeight(25) === 1 && tensionPeakWeight(50) === 0 && tensionPeakWeight(100) === 0, JSON.stringify([0, 25, 50, 100].map(tensionPeakWeight)));
check("and it falls steadily between them", [0, 10, 25, 40, 50, 60, 75, 90, 100].every((level, i, all) => i === 0 || tensionWeight(level) < tensionWeight(all[i - 1])));
check("outside the scale it stops at the ends", tensionWeight(-30) === 2 && tensionWeight(180) === -1.75 && tensionPeakWeight(-30) === 2);

if (!fs.existsSync(referencePath)) {
  console.log(`Reference data not found at ${referencePath}: the calibration of tension is skipped.`);
} else {
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
    lanesUsableByPlayers: source.lanesUsableByPlayers,
  };
};


  const reference = JSON.parse(fs.readFileSync(referencePath, "utf8"));
  const maps = reference.maps.filter((m) => m.useForCalibration).map((source) => [source.id, buildMap(source)]);
  const measure = (map, tickets) => {
    const deck = { ...map, tickets: tickets.map((t) => ({ ...t, set: "main" })) };
    const report = evaluateTicketDeck(deck, { setId: "main", atTable: map.players.max });
    return { top: report.bottlenecks.length ? Math.max(...report.bottlenecks.map((b) => b.ratio)) : 0, unused: report.unusedPct };
  };
  const mean = (rows, key) => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
  const built = (tension) => maps.flatMap(([id, map]) => [1, 2, 3].map((seed) => measure(map, suggestTickets(map, { style: id === "europe" ? "europe" : "generic", seed, ...(tension === null ? {} : { tension }) }).tickets)));
  const official = maps.map(([, map]) => measure(map, map.tickets));
  const levels = [0, 25, 50, 75, 100];
  const rows = levels.map((level) => { const r = built(level); return { level, top: mean(r, "top"), unused: mean(r, "unused") }; });
  const o = { top: mean(official, "top"), unused: mean(official, "unused") };
  console.log("busiest route, tickets per lane: official", o.top.toFixed(1), "| by tension", rows.map((r) => `${r.level}: ${r.top.toFixed(1)}`).join(", "), "| unused %: official", o.unused.toFixed(1), "| by tension", rows.map((r) => `${r.level}: ${r.unused.toFixed(1)}`).join(", "));
  check("the busiest route is more crowded at every step from calm to tense", rows.every((r, i) => i === 0 || r.top > rows[i - 1].top), rows.map((r) => r.top.toFixed(1)).join(" < "));
  check("and more routes are left unneeded at every step", rows.every((r, i) => i === 0 || r.unused > rows[i - 1].unused), rows.map((r) => r.unused.toFixed(1)).join(" < "));
  check("like the official maps (50) lands near the official decks: the busiest route within a third of theirs", Math.abs(rows[2].top - o.top) <= o.top / 3, `${rows[2].top.toFixed(1)} against ${o.top.toFixed(1)}`);
  check("and leaves about as many routes unneeded, within 3 points", Math.abs(rows[2].unused - o.unused) <= 3, `${rows[2].unused.toFixed(1)} % against ${o.unused.toFixed(1)} %`);
  const lowest = Math.min(...official.map((r) => r.top)), highest = Math.max(...official.map((r) => r.top));
  check("calm (0) is a little calmer than the calmest official deck, on average: its busiest route is no busier", rows[0].top <= lowest, `${rows[0].top.toFixed(1)} against ${lowest.toFixed(1)}`);
  check("tense (100) is a little tenser than the tensest official deck, on average, but not wildly: up to a third over", rows[4].top > highest && rows[4].top <= highest * 4 / 3, `${rows[4].top.toFixed(1)} against ${highest.toFixed(1)}`);
  check("the official figures the editor quotes are what the eight decks measure", Math.abs(TENSION_OFFICIAL.top[0] - lowest) < 0.1 && Math.abs(TENSION_OFFICIAL.top[1] - highest) < 0.1 && Math.abs(TENSION_OFFICIAL.topMean - o.top) < 0.1 && Math.abs(TENSION_OFFICIAL.unusedMean - o.unused) < 0.1, JSON.stringify(TENSION_OFFICIAL));
  check("the figures the editor quotes under the slider are what is measured, within one", [0, 50, 100].every((level, k) => { const r = rows[[0, 2, 4][k]]; return Math.abs(TENSION_EXPECTED[level].top - r.top) <= 1 && Math.abs(TENSION_EXPECTED[level].unused - r.unused) <= 1; }), JSON.stringify(TENSION_EXPECTED));
  check("with no tension asked for, a deck is like the official maps", JSON.stringify(built(null)) === JSON.stringify(built(50)));
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
