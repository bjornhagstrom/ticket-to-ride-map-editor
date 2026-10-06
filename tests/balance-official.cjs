// The official range beside every balance figure: measured on the eight calibration maps from the
// private reference data, converted as tests/ticket-calibration.cjs does, with each map's own deck at
// the largest table it is for. Checks that BALANCE_OFFICIAL in map-analysis.ts says what they measure.
//
//   npm run test:balance-official
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const referencePath = process.env.TTR_REFERENCE_DATA || path.join(root, "..", "ttr-reference-data", "ttr-reference-maps.json");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-balance-official-"));
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/ticket-suggester.ts", "app/map-analysis.ts", "app/map-data.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const { evaluateTicketDeck, TICKET_SUGGESTER } = require(path.join(out, "ticket-suggester.js"));
const { networkStats, connectionCount, BALANCE_OFFICIAL } = require(path.join(out, "map-analysis.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
check("the official ranges are there to set beside the figures", BALANCE_OFFICIAL && ["crowded", "crowdedPct", "loadRatio", "unusedPct", "maxPerStop", "hubDegree"].every((key) => Array.isArray(BALANCE_OFFICIAL[key]) && BALANCE_OFFICIAL[key][0] <= BALANCE_OFFICIAL[key][1]), JSON.stringify(BALANCE_OFFICIAL));

if (!fs.existsSync(referencePath)) {
  console.log(`Reference data not found at ${referencePath}: the measurement against the official maps is skipped.`);
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
  const measured = reference.maps.filter((map) => map.useForCalibration).map((source) => {
    const map = buildMap(source);
    const report = evaluateTicketDeck(map, { setId: "main", atTable: map.players.max });
    const stats = networkStats(map);
    const hubs = [...stats.hubDegree.values()];
    return { id: source.id, dupPct: report.dupPct, perStop: report.perStop, crowded: report.bottlenecks.length, crowdedPct: 100 * report.bottlenecks.length / connectionCount(map), loadRatio: report.loadRatio, unusedPct: report.unusedPct, maxPerStop: report.maxPerStop, hubDegree: hubs.reduce((sum, value) => sum + value, 0) / (hubs.length || 1) };
  });
  const span = (key, digits = 0) => { const values = measured.map((m) => m[key]).filter((v) => typeof v === "number"); const f = 10 ** digits; return [Math.round(Math.min(...values) * f) / f, Math.round(Math.max(...values) * f) / f]; };
  const found = { crowded: span("crowded"), crowdedPct: span("crowdedPct"), loadRatio: span("loadRatio", 1), unusedPct: span("unusedPct"), maxPerStop: span("maxPerStop"), hubDegree: span("hubDegree", 1) };
  console.log("measured", JSON.stringify(found), measured.map((m) => `${m.id}: ${m.crowded} crowded, ratio ${m.loadRatio && m.loadRatio.toFixed(2)}, ${Math.round(m.unusedPct)} % unused, ${m.maxPerStop} at one stop, hub ${m.hubDegree.toFixed(1)}`).join("; "));
  // Build a full deck shows the same figures beside its own table, and they must be the same eight maps.
  const suggesterFound = { perStop: span("perStop", 2), maxPerStop: span("maxPerStop"), dupPct: span("dupPct", 1), unusedPct: span("unusedPct") };
  for (const key of Object.keys(suggesterFound)) check(`${key}: Build a full deck quotes what the eight official maps measure`, JSON.stringify(suggesterFound[key]) === JSON.stringify(TICKET_SUGGESTER.official[key]), `${JSON.stringify(suggesterFound[key])} measured, ${JSON.stringify(TICKET_SUGGESTER.official[key])} quoted`);
  for (const key of Object.keys(found)) check(`${key}: the range the editor quotes is what the eight official maps measure`, JSON.stringify(found[key]) === JSON.stringify(BALANCE_OFFICIAL[key]), `${JSON.stringify(found[key])} measured, ${JSON.stringify(BALANCE_OFFICIAL[key])} quoted`);
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
