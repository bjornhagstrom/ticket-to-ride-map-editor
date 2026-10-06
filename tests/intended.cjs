// Intended chokepoints and hubs: a route marked contested on purpose, a stop marked as a hub. Building
// a full deck then sends tickets through the route instead of spreading them away from it, and lets the
// hub take more tickets than the rules' limit per stop; Map balance lists such a route as on purpose.
// Written before the marks existed.
//
//   npm run test:intended
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-intended-"));
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/ticket-suggester.ts", "app/map-analysis.ts", "app/map-storage.ts", "app/map-data.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const { suggestTickets, evaluateTicketDeck } = require(path.join(out, "ticket-suggester.js"));
const { buildAdjacency, shortestPath } = require(path.join(out, "map-analysis.js"));
const storage = require(path.join(out, "map-storage.js"));
const { initialMap } = require(path.join(out, "map-data.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const base = storage.normalizeMap(clone(initialMap));
const seeds = [1, 2, 3, 4];

// How many of a deck's tickets run along a route, and how many end at a stop.
const through = (map, tickets, routeId) => { const adjacency = buildAdjacency(map); return tickets.filter((t) => (shortestPath(adjacency, t.a, t.b)?.routeIds ?? []).includes(routeId)).length; };
const at = (tickets, stopId) => tickets.filter((t) => t.a === stopId || t.b === stopId).length;
const average = (fn) => seeds.reduce((sum, seed) => sum + fn(seed), 0) / seeds.length;

// A route in the middle of the example map, on one lane.
const chosen = base.routes.find((r) => base.routes.filter((o) => (o.a === r.a && o.b === r.b) || (o.a === r.b && o.b === r.a)).length === 1 && r.length >= 3);
const marked = clone(base); marked.routes.find((r) => r.id === chosen.id).contested = true;
const plainThrough = average((seed) => through(base, suggestTickets(base, { seed }).tickets, chosen.id));
const markedThrough = average((seed) => through(marked, suggestTickets(marked, { seed }).tickets, chosen.id));
check("a route contested on purpose gets more tickets through it in a built deck", markedThrough > plainThrough, `${markedThrough.toFixed(2)} against ${plainThrough.toFixed(2)} on average`);

// The pull does not depend on the deck's tension: at calm, like the official maps and tense alike.
for (const tension of [0, 50, 100]) {
  const plain = average((seed) => through(base, suggestTickets(base, { seed, tension }).tickets, chosen.id));
  const pulled = average((seed) => through(marked, suggestTickets(marked, { seed, tension }).tickets, chosen.id));
  check(`a route contested on purpose gets more tickets through it at tension ${tension}`, pulled > plain, `${pulled.toFixed(2)} against ${plain.toFixed(2)} on average`);
}

// A stop that is a hub on purpose.
const hubStop = base.stops.find((s) => s.name === "Central");
const hubbed = clone(base); hubbed.stops.find((s) => s.id === hubStop.id).hub = true;
const plainAt = average((seed) => at(suggestTickets(base, { seed }).tickets, hubStop.id));
const hubAt = average((seed) => at(suggestTickets(hubbed, { seed }).tickets, hubStop.id));
check("a hub on purpose is allowed more tickets than another stop would get", hubAt > plainAt, `${hubAt.toFixed(2)} against ${plainAt.toFixed(2)} on average`);

// The crowding report says which crowded routes are on purpose.
const deck = clone(marked); deck.tickets = suggestTickets(marked, { seed: 1, tension: 100 }).tickets.map((t) => ({ ...t, set: "main" }));
const report = evaluateTicketDeck(deck, { setId: "main", atTable: 2 });
check("every crowded route says whether it is crowded on purpose", report.bottlenecks.length > 0 && report.bottlenecks.every((b) => typeof b.onPurpose === "boolean"), `${report.bottlenecks.length} crowded`);
check("and only a marked one is", report.bottlenecks.filter((b) => b.onPurpose).every((b) => b.routeIds.includes(chosen.id)));

// In the file: an addition, kept as true or left out.
const read = storage.normalizeMap({ ...clone(base), stops: base.stops.map((s, i) => (i === 0 ? { ...s, hub: true } : i === 1 ? { ...s, hub: "yes" } : s)), routes: base.routes.map((r, i) => (i === 0 ? { ...r, contested: true } : i === 1 ? { ...r, contested: 1 } : r)) });
check("a hub mark and a contested mark survive a file as true", read.stops[0].hub === true && read.routes[0].contested === true);
check("and a mark that is not true is left out", read.stops[1].hub === undefined && read.routes[1].contested === undefined, JSON.stringify([read.stops[1].hub, read.routes[1].contested]));

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
