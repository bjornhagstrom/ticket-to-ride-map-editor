// What an independent review (2026-10-10) found, written as checks before the fixes (docs/REVIEW.md, "After the review"):
//  1. a board name that a plain object has anyway (`__proto__`, `constructor`, `toString`) was read as an old board and turned
//     every coordinate into NaN, which a save turned into null and the next reading threw away;
//  2. a field that an older build keeps under `unknown` and that this build knows (the lane rule) stayed there, so the setting
//     showed the standard and an export wrote the old value over the new one;
//  3. two different pairs of stops could get one key ("a~b" + "c" and "a" + "b~c"), so two routes were counted as a double route.
// (The fourth finding, keyboard focus on the phone, is section 66 of the browser suite.)
//
//   npm run test:codex-findings
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-codex-findings-"));
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/map-storage.ts", "app/map-data.ts", "app/map-analysis.ts", "app/csv-export.ts", "app/ticket-suggester.ts",
  "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const storage = require(path.join(out, "map-storage.js"));
const data = require(path.join(out, "map-data.js"));
const A = require(path.join(out, "map-analysis.js"));
const csv = require(path.join(out, "csv-export.js"));
const { initialMap } = data;

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const finite = (map) => map.stops.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y)) && map.routes.every((r) => (r.points || []).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));

// ---------------------------------------------------------------- 1. names a plain object has
for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "isPrototypeOf"]) {
  const raw = clone(initialMap); Object.defineProperty(raw, "format", { value: name, enumerable: true, writable: true, configurable: true });
  const { map, repairs } = storage.repairMap(JSON.parse(JSON.stringify(raw)));
  const again = storage.repairMap(JSON.parse(JSON.stringify(map))).map;
  check(`a board named ${name} reads as the standard board, every stop where it was`, map.format === "board-2x3" && finite(map) && map.stops.length === initialMap.stops.length && map.stops.every((s, i) => s.x === initialMap.stops[i].x && s.y === initialMap.stops[i].y), `${map.format}, ${map.stops.length} stops`);
  check(`and keeps them through a save and a second reading (${name})`, again.stops.length === initialMap.stops.length && again.routes.length === initialMap.routes.length && again.tickets.length === initialMap.tickets.length);
}
{
  const oldRaw = clone(initialMap); oldRaw.format = "a4";
  const migrated = storage.repairMap(oldRaw).map;
  check("a real old board name is still moved onto its board, as before", migrated.format === "board-2x3" && finite(migrated) && migrated.stops.length === initialMap.stops.length);
}
{
  // A network file, a background file and a ticket file name their board too.
  const net = { format: "__proto__", stops: clone(initialMap.stops), routes: clone(initialMap.routes), tickets: [] };
  let result = null, threw = null;
  try { result = storage.normalizeNetworkFile(net, { width: 1100, height: 731 }); } catch (error) { threw = String(error.message || error); }
  check("a network file naming a board that is a plain object's own name brings its stops over with real numbers", threw === null && result && result.stops.length === initialMap.stops.length && result.stops.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y)), threw || "");
}

// ---------------------------------------------------------------- 2. a stored copy that holds what is known now
{
  // What a 1.4.0 build keeps in its browser: the lane rule it does not know, under `unknown`.
  const stored = storage.normalizeMap(clone(initialMap));
  stored.unknown = { laneRule: { "2+": "all" }, weatherRules: { rain: "slows ferries" } };
  const wire = JSON.parse(JSON.stringify(stored));
  const read = storage.normalizeMap(wire);
  check("a rule that an older build kept as unknown is the map's rule here, so the setting shows it (opens from two players)", data.lanesOpenFrom(read.laneRule) === 2, JSON.stringify(read.laneRule));
  check("and it is not kept twice: what is left unknown is what is still unknown", JSON.stringify(read.unknown) === JSON.stringify({ weatherRules: { rain: "slows ferries" } }), JSON.stringify(read.unknown));
  const chosen = clone(read); chosen.laneRule = data.laneRuleOpeningFrom(5);
  const exported = storage.mapPayload(chosen);
  check("choosing another number writes it, and the old value does not win over it in the file", JSON.stringify(exported.laneRule) === JSON.stringify({ "2+": 1, "5+": "all" }), JSON.stringify(exported.laneRule));
  check("what is still unknown comes out too", JSON.stringify(exported.weatherRules) === JSON.stringify({ rain: "slows ferries" }));
  const standard = clone(read); delete standard.laneRule;
  check("choosing the standard four leaves no rule in the file, and no old one comes back", storage.mapPayload(standard).laneRule === undefined);
  const both = clone(wire); both.laneRule = { "2+": 1, "3+": "all" };
  check("a rule on the map itself wins over one under unknown", data.lanesOpenFrom(storage.normalizeMap(both).laneRule) === 3);
  const fromFile = storage.normalizeMap(storage.readMapFile({ format: "ticket-to-ride-map", version: 3, kind: "map", payload: Object.assign(clone(initialMap), { unknown: { laneRule: { "2+": "all" } } }) }).payload);
  check("the same when a file carries it under unknown", data.lanesOpenFrom(fromFile.laneRule) === 2);
}

// ---------------------------------------------------------------- 3. pairs of stops with a tilde in their ids
{
  const stop = (id, x) => ({ id, name: id, type: "city", x, y: 100 });
  const two = storage.normalizeMap(clone(initialMap));
  two.stops = [stop("a~b", 100), stop("c", 300), stop("a", 500), stop("b~c", 700)];
  const route = (id, a, b) => ({ id, a, b, length: 6, type: "city", color: "gray" });
  two.routes = [route("r1", "a~b", "c"), route("r2", "a", "b~c")];
  two.tickets = []; two.players = { min: 2, max: 3 };
  const s = A.setupBalance(two, "main");
  check("two different routes whose ids make the same joined text are two routes, not a double one", s.totalSpaces === 12 && s.usableSpaces === 12, `${s.usableSpaces} of ${s.totalSpaces}`);
  check("the spreadsheet does not call them a double route either", csv.routesCsv(two).split(/\r?\n/).slice(1).filter(Boolean).every((line) => line.split(",")[7] !== "yes"));
  const double = clone(two); double.routes = [route("r1", "a", "c"), route("r2", "c", "a")];
  check("a real double route is still one", A.setupBalance(double, "main").usableSpaces === 6, String(A.setupBalance(double, "main").usableSpaces));
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
