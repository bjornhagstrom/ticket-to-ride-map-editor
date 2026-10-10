// Hostile maps: one odd value at a time in every field of a sound map, through everything that runs on a map. Written after an
// independent review found that a plain-object lookup by a name from a file (`table[stop.size]`) threw on a value the editor does not
// know ("huge", 5), which a newer build could write: reading must keep such a value (so a round trip through an older build does not
// lose what a newer one added), and nothing that runs on the map may throw on it or turn a number into NaN.
//
//   npm run test:hostile-maps
//
// Each field of the first stop, route, ticket, deck, style, note, background shape and image, and of the map itself, is set to each of the
// values below in turn. The map is read (`repairMap`), analysed (everything the editor works out when it draws), written to a spreadsheet
// and to the file for the other tool, planned for printing and written to a file, and the file is read again.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-hostile-"));
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/map-storage.ts", "app/map-data.ts", "app/map-analysis.ts", "app/csv-export.ts", "app/ttr-map-generator-export.ts", "app/print-plan.ts", "app/board.ts", "app/map-geometry.ts",
  "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const storage = require(path.join(out, "map-storage.js"));
const { initialMap, problemMap } = require(path.join(out, "map-data.js"));
const A = require(path.join(out, "map-analysis.js"));
const csv = require(path.join(out, "csv-export.js"));
const gen = require(path.join(out, "ttr-map-generator-export.js"));
const plan = require(path.join(out, "print-plan.js"));
const G = require(path.join(out, "map-geometry.js"));

const clone = (value) => JSON.parse(JSON.stringify(value));
const HOSTILE = ["huge", "", 5, -1, 0, null, true, {}, [], "__proto__", "toString", "constructor"];

// Every path to something worth changing: the fields of the first object of each list, and of the map itself.
const paths = [];
const walk = (value, trail, depth) => {
  if (Array.isArray(value)) { if (value.length) walk(value[0], [...trail, 0], depth + 1); paths.push(trail); return; }
  if (value && typeof value === "object") { for (const key of Object.keys(value)) walk(value[key], [...trail, key], depth + 1); return; }
  paths.push(trail);
};
// The sample is the map with a problem, with every optional field filled in once, so that each has something to change.
const sample = clone(problemMap);
Object.assign(sample.stops[0], { hub: true, size: "medium", symbol: "letter", letter: "A", labelAngle: 45, endGapMm: 2, locked: true, labelLocked: true });
Object.assign(sample.routes[0], { contested: true, points: [{ x: sample.stops[0].x + 10, y: sample.stops[0].y + 10 }], locomotiveSlots: [1], curved: true });
if (sample.lineStyles[0]) sample.routes[0].lineStyle = sample.lineStyles[0].id;
if (sample.wagonStyles && sample.wagonStyles[0]) sample.routes[0].wagonStyle = sample.wagonStyles[0].id;
Object.assign(sample.tickets[0], { long: true, adjust: 1, set: sample.ticketSets[0].id });
Object.assign(sample.routeTypeStyles[0], { shape: "plain", glyph: "R" });
if (sample.wagonStyles && sample.wagonStyles[0]) sample.wagonStyles[0].glyph = "W";
Object.assign(sample.stopTypeStyles[0], { square: true, junction: false });
Object.assign(sample, { orientation: "portrait", rules: "Some rules.", endGapMm: 2, deckTension: 50, ticketBands: { medium: 0.35, long: 0.6 }, ticketMix: { short: 30, medium: 47, long: 23 },
  ticketValuation: { longBonus: true, ferryPremium: 1 }, laneRule: { "2+": 1, "3+": "all" }, players: { min: 2, max: 3 }, wagonsPerPlayer: 28, startingTickets: 3, keptTickets: 2,
  mapVersion: { number: 1, fingerprint: "x", issued: [] },
  backgroundImage: { dataUrl: "data:image/png;base64,AAAA", naturalWidth: 10, naturalHeight: 10, x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, crop: { top: 0, right: 0, bottom: 0, left: 0 } } });
sample.unknown = { somethingNew: { a: 1 } };
walk(clone(sample), [], 0);
const setAt = (root_, trail, value) => { let at = root_; for (let i = 0; i < trail.length - 1; i++) at = at[trail[i]]; at[trail[trail.length - 1]] = value; };
// The raw lists beyond the first are left as they are; fields of the first of each are the ones changed.

const pipeline = (raw) => {
  const failures = [];
  const step = (name, fn) => { try { return fn(); } catch (error) { failures.push(`${name}: ${String(error && error.message).slice(0, 80)}`); return undefined; } };
  const read = step("repairMap", () => storage.repairMap(clone(raw)));
  if (!read) return failures;
  const map = read.map;
  const setIds = map.ticketSets.map((s) => s.id);
  step("setupBalance", () => A.setupBalance(map, setIds[0]));
  step("networkShape", () => A.networkShape(map));
  step("networkStats", () => A.networkStats(map));
  step("crossings", () => A.crossings(map));
  step("routeSpacing", () => A.routeSpacing(map, 790));
  step("colourLengthTable", () => A.colourLengthTable(map));
  step("compareWithClassics", () => A.compareWithClassics(map));
  step("reviewTickets", () => A.reviewTickets(map, setIds[0]));
  step("stopCoverage", () => A.stopCoverage(map, setIds[0]));
  step("mapDiameter", () => A.mapDiameter(map));
  step("coveredLabels", () => A.coveredLabels(map));
  step("autoPlaceLabels", () => A.autoPlaceLabels(map));
  step("turnAndTidy", () => A.turnAndTidy(map, "portrait"));
  step("routeGeometry", () => { for (const route of map.routes) { const pts = G.pointsFor(map, route); G.curvedSamples(pts); G.parallelPoints(map, route); } });
  step("stopsCsv", () => csv.stopsCsv(map));
  step("routesCsv", () => csv.routesCsv(map));
  step("ticketsCsv", () => csv.ticketsCsv(map, setIds));
  step("distancesCsv", () => csv.distancesCsv(map));
  step("generatorFiles", () => gen.generatorFiles(map));
  step("printPlan", () => { for (const split of ["sheet", "panel", "full", "page"]) plan.printPlan(map.format, { split, paper: "a4", size: "standard" }, undefined, map.orientation === "portrait" ? "portrait" : "landscape"); plan.printChoices(map.format); });
  const written = step("writeMapFile", () => JSON.stringify(storage.writeMapFile("map", storage.mapPayload(map), map)));
  if (written) {
    const again = step("read again", () => storage.repairMap(storage.readMapFile(JSON.parse(written)).payload));
    if (again && again.repairs.length) failures.push(`read again: said ${again.repairs.join(" / ").slice(0, 80)}`);
  }
  // Numbers the editor draws with must not have become NaN or infinite.
  step("finite", () => {
    const bad = [];
    for (const s of map.stops) for (const k of ["x", "y"]) if (!Number.isFinite(s[k])) bad.push(`stop ${k}`);
    for (const r of map.routes) { if (!Number.isFinite(r.length)) bad.push("route length"); for (const p of r.points || []) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) bad.push("bend"); }
    if (bad.length) throw new Error(`not finite: ${[...new Set(bad)].join(", ")}`);
  });
  return failures;
};

const found = new Map();
let runs = 0;
const started = Date.now();
for (const trail of paths) {
  if (!trail.length) continue;
  for (const value of HOSTILE) {
    const raw = clone(sample);
    try { setAt(raw, trail, value); } catch { continue; }
    runs++;
    for (const failure of pipeline(raw)) {
      const key = `${trail.join(".")} = ${JSON.stringify(value)}`;
      if (!found.has(failure.split(":")[0] + " | " + trail.join("."))) found.set(failure.split(":")[0] + " | " + trail.join("."), `${key} -> ${failure}`);
    }
  }
}
// Sound maps are left alone: no message, nothing changed.
for (const [name, source] of [["the example map", initialMap], ["the map with problems", problemMap]]) {
  const r = storage.repairMap(clone(source));
  if (r.repairs.length) found.set(`sound ${name}`, `${name} -> said ${r.repairs.join(" / ").slice(0, 100)}`);
}
const lines = [...found.values()];
console.log(`${runs} hostile maps in ${((Date.now() - started) / 1000).toFixed(1)} s over ${paths.length} fields`);
for (const line of lines.slice(0, 40)) console.log(`  FAIL  ${line}`);
if (lines.length > 40) console.log(`  ... and ${lines.length - 40} more`);
console.log(`\n${lines.length ? 0 : 1} passed, ${lines.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(lines.length ? 1 : 0);
