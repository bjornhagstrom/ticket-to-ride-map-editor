// What a shared file must survive. Written before the envelope was built.
//
//   npm run test:file-format
//
// The rules under test come from docs/FILE-FORMAT.md: every file says what it is and which schema
// it follows, every file we have ever written still opens, a file from a newer build is refused
// rather than quietly stripped, and anything a reader does not understand comes back out untouched.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-file-format-"));
execFileSync("npx", ["tsc", "app/map-storage.ts", "app/map-data.ts",
  "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"],
  { cwd: root, stdio: "inherit" });
const storage = require(path.join(out, "map-storage.js"));
const { initialMap, FILE_FORMAT, FILE_VERSION } = { ...require(path.join(out, "map-data.js")), ...storage };

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };

const sample = storage.normalizeMap(require(path.join(out, "map-data.js")).initialMap);

// ---------------------------------------------------------------- the envelope
const file = storage.writeMapFile("map", storage.mapPayload(sample), sample);
check("a file says what format it is", file.format === storage.FILE_FORMAT, String(file.format));
check("and which schema it follows", file.version === storage.FILE_VERSION && typeof file.version === "number", String(file.version));
check("and what kind of file it is", file.kind === "map");
check("and when it was written", typeof file.written === "string" && !Number.isNaN(Date.parse(file.written)), file.written);
check("and by what", Boolean(file.app && file.app.name && file.app.version), JSON.stringify(file.app));
check("and in what frame its coordinates are", Boolean(file.board && file.board.width > 0 && file.board.height > 0), JSON.stringify(file.board));
check("the payload sits under its own key, never spread", Boolean(file.payload) && file.name === undefined && file.stops === undefined);

// ---------------------------------------------------------------- round trips
const readBack = storage.readMapFile(JSON.parse(JSON.stringify(file)));
check("a map file reads back as a map", readBack.kind === "map" && readBack.version === storage.FILE_VERSION);
const reloaded = storage.normalizeMap(readBack.payload);
check("a map survives a round trip", reloaded.stops.length === sample.stops.length && reloaded.routes.length === sample.routes.length && reloaded.name === sample.name,
  `${reloaded.stops.length} stops, ${reloaded.routes.length} routes`);
check("its settings survive too", reloaded.wagonsPerPlayer === sample.wagonsPerPlayer && reloaded.startingTickets === sample.startingTickets);

// ---------------------------------------------------------------- files we wrote before the envelope
const legacyMap = { kind: "map", ...JSON.parse(JSON.stringify(sample)) };
delete legacyMap.unknown;
const legacyRead = storage.readMapFile(legacyMap);
check("a file written before the envelope still opens", legacyRead.kind === "map" && legacyRead.version === 1, `version ${legacyRead.version}`);
check("and keeps its content", storage.normalizeMap(legacyRead.payload).stops.length === sample.stops.length);

const legacyNoKind = JSON.parse(JSON.stringify(sample));
check("even one with no kind at all is taken as a map", storage.readMapFile(legacyNoKind).kind === "map");

for (const kind of ["background", "network", "tickets"]) {
  const legacy = { kind, format: "board-2x3", stops: [], routes: [], background: [], tickets: [], sets: [] };
  check(`a ${kind} file written before the envelope still opens`, storage.readMapFile(legacy).kind === kind);
}

// ---------------------------------------------------------------- a file from a newer build
let refused = null;
try { storage.readMapFile({ ...file, version: storage.FILE_VERSION + 1 }); }
catch (error) { refused = error.message; }
check("a file from a newer build is refused, not quietly stripped", Boolean(refused), refused || "it was accepted");
check("and the refusal names both versions", refused && refused.includes(String(storage.FILE_VERSION + 1)) && refused.includes(String(storage.FILE_VERSION)), refused || "");

// ---------------------------------------------------------------- what a reader does not understand
const fromTheFuture = JSON.parse(JSON.stringify(file));
fromTheFuture.payload.weatherRules = { rain: "slows ferries" };
fromTheFuture.payload.stops[0].elevation = 120;
const keptMap = storage.normalizeMap(storage.readMapFile(fromTheFuture).payload);
const writtenAgain = storage.writeMapFile("map", storage.mapPayload(keptMap), keptMap);
check("a field this build has never heard of comes back out untouched",
  JSON.stringify(writtenAgain.payload.weatherRules) === JSON.stringify({ rain: "slows ferries" }), JSON.stringify(writtenAgain.payload.weatherRules));
check("and it is not left lying in the map as a stray key", keptMap.weatherRules === undefined);
check("an unknown field on a stop survives as well", writtenAgain.payload.stops[0].elevation === 120, String(writtenAgain.payload.stops[0].elevation));

// ---------------------------------------------------------------- a file carries what it refers to
const network = storage.networkPayload(sample);
const styleIds = new Set([...(network.stopTypeStyles || []).map((s) => s.id)]);
const missingStopTypes = [...new Set(network.stops.map((stop) => stop.type))].filter((type) => !styleIds.has(type));
check("a network file carries every stop type its stops use", missingStopTypes.length === 0, missingStopTypes.join(", "));
const wagonIds = new Set((network.wagonStyles || []).map((s) => s.id));
const missingWagons = [...new Set(network.routes.map((route) => route.wagonStyle).filter(Boolean))].filter((id) => !wagonIds.has(id));
check("and every wagon style its routes use", missingWagons.length === 0, missingWagons.join(", "));
const routeTypeIds = new Set((network.routeTypeStyles || []).map((s) => s.id));
const missingRouteTypes = [...new Set(network.routes.map((route) => route.type))].filter((type) => !routeTypeIds.has(type));
check("and every route type", missingRouteTypes.length === 0, missingRouteTypes.join(", "));

console.log("PASS:"); ok.forEach((line) => console.log("  ✓ " + line));
if (bad.length) { console.log("FAIL:"); bad.forEach((line) => console.log("  ✗ " + line)); }
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
