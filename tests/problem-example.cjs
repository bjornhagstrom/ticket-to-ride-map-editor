// The example map with problems: the clean example map plus two things done wrong on purpose, so a new
// user can see how the editor's warnings look: a route that crosses another, and a stop reached by one
// route only (a dead end). The clean example stays clean. Written before the map existed.
//
//   npm run test:problem-example
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-problem-example-"));
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/map-analysis.ts", "app/map-storage.ts", "app/map-data.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const A = require(path.join(out, "map-analysis.js"));
const storage = require(path.join(out, "map-storage.js"));
const { initialMap, problemMap } = require(path.join(out, "map-data.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };

check("there is a map with problems, named for it", problemMap && /problems/i.test(problemMap.name) && problemMap.name !== initialMap.name, problemMap && problemMap.name);
check("the clean example is still clean: no crossing and no dead end", A.crossings(initialMap).length === 0 && A.networkShape(initialMap).deadEnds.length === 0);

const crossingList = A.crossings(problemMap);
check("the map with problems has a route that crosses another", crossingList.length >= 1, `${crossingList.length} crossing(s)`);
const shape = A.networkShape(problemMap);
check("and one stop reached by one route only", shape.deadEnds.length === 1, shape.deadEnds.map((s) => s.name).join(", "));
const dead = shape.deadEnds[0];
const lanes = problemMap.routes.filter((r) => r.a === dead.id || r.b === dead.id);
check("by a single route, not a double one", lanes.length === 1, `${lanes.length} route(s)`);
check("the only route that cuts the map in two is that one, so the rest of the map still holds together", shape.bridges.length === 1 && shape.bridges[0].routeIds.length === 1 && shape.bridges[0].routeIds[0] === lanes[0].id, `${shape.bridges.length} bridge(s)`);

const keptStops = initialMap.stops.every((s) => problemMap.stops.some((p) => p.id === s.id && p.x === s.x && p.y === s.y));
const keptRoutes = initialMap.routes.every((r) => problemMap.routes.some((p) => p.id === r.id && p.a === r.a && p.b === r.b && p.length === r.length));
check("everything of the clean example is there, as it was", keptStops && keptRoutes && problemMap.tickets.length === initialMap.tickets.length);
check("with exactly one stop and two routes added", problemMap.stops.length === initialMap.stops.length + 1 && problemMap.routes.length === initialMap.routes.length + 2, `${problemMap.stops.length - initialMap.stops.length} stop(s), ${problemMap.routes.length - initialMap.routes.length} route(s)`);
const ids = [...problemMap.stops, ...problemMap.routes, ...problemMap.tickets].map((x) => x.id);
check("every id is its own", new Set(ids).size === ids.length);
const added = problemMap.routes.filter((r) => !initialMap.routes.some((o) => o.id === r.id));
const spacing = A.routeSpacing(problemMap, 790).filter((s) => added.some((r) => r.id === s.route.id));
check("the added routes are drawn as long as their wagons need, so the only problems are the two meant", spacing.length === 2 && spacing.every((s) => s.verdict === "ok"), spacing.map((s) => `${s.route.length}: ${s.ratio.toFixed(2)}`).join(", "));
check("the two decks still deal a full table of the standard players", [...new Set(problemMap.tickets.map((t) => t.set))].every((set) => problemMap.tickets.filter((t) => t.set === set).length >= 5 * (problemMap.startingTickets ?? 3)));

// The rules and the note say what is wrong, and every name they use is on the map.
const names = new Set(problemMap.stops.map((s) => s.name));
const pairNames = new Set(problemMap.routes.map((r) => `${problemMap.stops.find((s) => s.id === r.a).name}–${problemMap.stops.find((s) => s.id === r.b).name}`));
const links = [...(problemMap.rules || "").matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
check("its rules explain the two problems and link only to stops and routes on the map", /cross/i.test(problemMap.rules) && /dead end/i.test(problemMap.rules) && links.length >= 3 && links.every((l) => names.has(l) || pairNames.has(l) || [...pairNames].some((p) => p.split("–").reverse().join("–") === l)), links.join(" | "));
check("and a note on the map says the same", problemMap.notes.some((n) => /on purpose/i.test(n.text) && /cross/i.test(n.text) && /dead end/i.test(n.text)));

// It is an ordinary map: it survives a file.
const back = storage.normalizeMap(storage.readMapFile(JSON.parse(JSON.stringify(storage.writeMapFile("map", storage.mapPayload(storage.normalizeMap(problemMap)), problemMap)))).payload);
check("it survives a round trip through a file", back.stops.length === problemMap.stops.length && back.routes.length === problemMap.routes.length && back.name === problemMap.name);

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
