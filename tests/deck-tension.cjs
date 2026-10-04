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
const { suggestTickets, evaluateTicketDeck, TENSION_LOAD_WEIGHT } = require(path.join(out, "ticket-suggester.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
check("three tensions: calm, official, tense, each with its weight", TENSION_LOAD_WEIGHT && ["calm", "official", "tense"].every((t) => typeof TENSION_LOAD_WEIGHT[t] === "number"), JSON.stringify(TENSION_LOAD_WEIGHT));

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
  const built = (tension) => maps.flatMap(([id, map]) => [1, 2].map((seed) => measure(map, suggestTickets(map, { style: id === "europe" ? "europe" : "generic", seed, ...(tension ? { tension } : {}) }).tickets)));
  const official = maps.map(([, map]) => measure(map, map.tickets));
  const calm = built("calm"), like = built("official"), tense = built("tense"), plain = built(null);
  const [o, c, l, t] = [official, calm, like, tense].map((rows) => ({ top: mean(rows, "top"), unused: mean(rows, "unused") }));
  console.log("busiest route, tickets per lane: official", o.top.toFixed(1), "calm", c.top.toFixed(1), "like the official maps", l.top.toFixed(1), "tense", t.top.toFixed(1), "| unused %: official", o.unused.toFixed(1), "calm", c.unused.toFixed(1), "like", l.unused.toFixed(1), "tense", t.unused.toFixed(1));
  check("calm crowds the busiest route least, tense most, like the official maps in between", c.top < l.top && l.top < t.top, `${c.top.toFixed(1)} < ${l.top.toFixed(1)} < ${t.top.toFixed(1)}`);
  check("like the official maps lands near the official decks: the busiest route within a third of theirs", Math.abs(l.top - o.top) <= o.top / 3, `${l.top.toFixed(1)} against ${o.top.toFixed(1)}`);
  check("and leaves about as many routes unneeded, within 3 points", Math.abs(l.unused - o.unused) <= 3, `${l.unused.toFixed(1)} % against ${o.unused.toFixed(1)} %`);
  check("tense stays within what the tensest official maps do", t.top <= Math.max(...official.map((r) => r.top)), `${t.top.toFixed(1)} against at most ${Math.max(...official.map((r) => r.top)).toFixed(1)}`);
  check("with no tension asked for, a deck is calm, as it always was", JSON.stringify(plain) === JSON.stringify(calm));
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
