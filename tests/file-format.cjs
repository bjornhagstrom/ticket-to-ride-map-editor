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
check("a file says which version of the editor wrote it, and it is the package's", file.app && file.app.version === JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version, JSON.stringify(file.app));
check("a file says what format it is", file.format === storage.FILE_FORMAT, String(file.format));
// A lying map is still written as version 3, so every version 3 reader opens it; only a standing
// map is version 4 (tests/board.cjs).
check("and which schema it follows: 3 for a lying map, the newest a version 3 reader still opens", file.version === 3 && storage.FILE_VERSION === 4, String(file.version));
check("and what kind of file it is", file.kind === "map");
check("and when it was written", typeof file.written === "string" && !Number.isNaN(Date.parse(file.written)), file.written);
check("and by what", Boolean(file.app && file.app.name && file.app.version), JSON.stringify(file.app));
check("and in what frame its coordinates are", Boolean(file.board && file.board.width > 0 && file.board.height > 0), JSON.stringify(file.board));
check("the payload sits under its own key, never spread", Boolean(file.payload) && file.name === undefined && file.stops === undefined);

// ---------------------------------------------------------------- round trips
const readBack = storage.readMapFile(JSON.parse(JSON.stringify(file)));
check("a map file reads back as a map", readBack.kind === "map" && readBack.version === 3);
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

// ---------------------------------------------------------------- formats that are now print choices
// Test sheets and boards measured in sheets of paper stopped being board formats: a map is a 2×3 or
// a 2×4 board, and paper is chosen when printing. A file that names an old format opens on the
// nearest board, scaled uniformly and centred, so nothing is stretched out of shape.
//
// Heights are in map units, where the board is always 1100 wide:
//   a4 778, a3 778, us-letter 850, board-2x3-large 733  →  board-2x3, 731
//   a4-3x2 519, a4-4x2 389, letter-3x2 567, letter-4x2 425  →  board-2x4, 549
const legacyFile = (format, extra = {}) => ({
  format: "ticket-to-ride-map", version: 3, kind: "map", written: "2026-09-01T00:00:00.000Z",
  app: { name: "Map prototypes", version: "0.1.0" }, board: { width: 1100, height: 778 },
  payload: {
    ...JSON.parse(JSON.stringify(sample)), format,
    stops: [{ id: "s1", name: "Centre", x: 550, y: 389, type: sample.stops[0].type }, { id: "s2", name: "Corner", x: 0, y: 0, type: sample.stops[0].type }],
    routes: [{ ...sample.routes[0], a: "s1", b: "s2", points: [{ x: 1100, y: 0 }] }],
    notes: [{ id: "n1", x: 100, y: 100, width: 200, height: 100, text: "note" }],
    background: [{ id: "b1", type: "area", points: [{ x: 0, y: 778 }], labelPoint: { x: 550, y: 389 } }],
    ...extra,
  },
});
const open = (format) => storage.normalizeMap(storage.readMapFile(JSON.parse(JSON.stringify(legacyFile(format)))).payload);
const near = (a, b) => Math.abs(a - b) < 0.01;
for (const [format, to] of [["a4", "board-2x3"], ["a3", "board-2x3"], ["us-letter", "board-2x3"], ["board-2x3-large", "board-2x3"],
  ["a4-3x2", "board-2x4"], ["a4-4x2", "board-2x4"], ["letter-3x2", "board-2x4"], ["letter-4x2", "board-2x4"]]) {
  check(`a map on the old ${format} format opens as ${to}`, open(format).format === to, open(format).format);
}
const a4 = open("a4");
const s = 731 / 778;
check("an A4 test sheet shrinks evenly to fit the board: the centre stays the centre",
  near(a4.stops[0].x, 550) && near(a4.stops[0].y, 731 / 2), `${a4.stops[0].x}, ${a4.stops[0].y}`);
check("and a corner moves in by the same factor both ways",
  near(a4.stops[1].x, 550 - 550 * s) && near(a4.stops[1].y, 0), `${a4.stops[1].x}, ${a4.stops[1].y}`);
check("bend points move with it", near(a4.routes[0].points[0].x, 550 + 550 * s) && near(a4.routes[0].points[0].y, 0), JSON.stringify(a4.routes[0].points[0]));
check("notes move and shrink with it", near(a4.notes[0].x, 550 - 450 * s) && near(a4.notes[0].y, 100 * s) && near(a4.notes[0].width, 200 * s) && near(a4.notes[0].height, 100 * s), JSON.stringify(a4.notes[0]));
check("background shapes and their labels too", near(a4.background[0].points[0].y, 731) && near(a4.background[0].labelPoint.y, 731 / 2), JSON.stringify(a4.background[0]));
const strip = open("a4-4x2");
check("a narrower strip is not stretched: it keeps its scale and is centred on the taller board",
  near(strip.stops[1].x, 0) && near(strip.stops[1].y, (549 - 389) / 2), `${strip.stops[1].x}, ${strip.stops[1].y}`);
const kept = open("board-2x3");
check("a map already on a board keeps every coordinate", kept.stops[0].x === 550 && kept.stops[0].y === 389 && kept.notes[0].width === 200);
const oldNetwork = storage.normalizeNetworkFile({ format: "a4", stops: [{ id: "s", x: 10, y: 778 }], routes: [] }, { width: 1100, height: 731 });
check("a network file from an old format still lands on the board", near(oldNetwork.stops[0].y, 731), String(oldNetwork.stops[0].y));
check("a migrated map is written back out under a board format", storage.writeMapFile("map", storage.mapPayload(a4), a4).payload.format === "board-2x3");

// ---------------------------------------------------------------- deck rules of a map's own
// A set of rules the suggester follows instead of ours travels with the map. A value that cannot be
// used is dropped rather than handed to the suggester.
const own = { id: "rules-1", label: "Sparse", basedOn: "generic", ticketsPerStop: 0.5, longPerStop: 0, bins: [0.18, 0.33, 0.22, 0.16, 0.11], longRange: null, bonusFrom: null, lengthCap: 0.47, maxPerStop: 7, dupRate: 0.03, periphery: "relative" };
const withRules = storage.normalizeMap({ ...JSON.parse(JSON.stringify(sample)), deckRules: [own], deckRule: "rules-1" });
const rulesBack = storage.normalizeMap(storage.readMapFile(JSON.parse(JSON.stringify(storage.writeMapFile("map", storage.mapPayload(withRules), withRules)))).payload);
check("a map's own deck rules survive a round trip", JSON.stringify(rulesBack.deckRules) === JSON.stringify([own]) && rulesBack.deckRule === "rules-1", JSON.stringify(rulesBack.deckRules));
const broken = storage.normalizeMap({ ...JSON.parse(JSON.stringify(sample)), deckRules: [{ ...own, id: "bad", ticketsPerStop: -2 }, { label: "no id" }, own], deckRule: "gone" });
const keptRules = broken.deckRules || [];
check("a set with a value that cannot be used, or no id, is dropped", keptRules.length === 1 && keptRules[0].id === "rules-1", JSON.stringify(keptRules.map((r) => r.id)));
check("and a choice that names no set falls back to ours", broken.deckRule === undefined, String(broken.deckRule));

// Where an own set wants tickets to end: from the map's average stop, or no preference (null).
const ends = { ...own, id: "ends", longEnds: 0.15, shortEnds: null };
const endsBack = storage.normalizeMap(storage.readMapFile(JSON.parse(JSON.stringify(storage.writeMapFile("map", storage.mapPayload(storage.normalizeMap({ ...JSON.parse(JSON.stringify(sample)), deckRules: [ends] })), sample)))).payload);
check("where an own set ends its tickets survives a round trip", (endsBack.deckRules || [])[0]?.longEnds === 0.15 && (endsBack.deckRules || [])[0]?.shortEnds === null, JSON.stringify((endsBack.deckRules || [])[0]));
const wild = storage.normalizeMap({ ...JSON.parse(JSON.stringify(sample)), deckRules: [{ ...ends, longEnds: 0.9 }] });
check("and an end further than the map allows drops the set", !(wild.deckRules || []).length);

// The rules text: a plain string in the map, optional, kept as written.
const ruled = storage.normalizeMap({ ...JSON.parse(JSON.stringify(sample)), rules: "# Rules\n\nClaim **routes**.\n\n- see [[Westport]]\n" });
const ruledBack = storage.normalizeMap(storage.readMapFile(JSON.parse(JSON.stringify(storage.writeMapFile("map", storage.mapPayload(ruled), ruled)))).payload);
check("the rules text survives a round trip exactly", ruledBack.rules === "# Rules\n\nClaim **routes**.\n\n- see [[Westport]]\n", JSON.stringify(ruledBack.rules));
check("and is not mistaken for a field this build does not know", !(ruledBack.unknown && "rules" in ruledBack.unknown));
check("a map with no rules has none, rather than an empty text", storage.normalizeMap({ ...JSON.parse(JSON.stringify(sample)), rules: undefined }).rules === undefined && storage.normalizeMap({ ...JSON.parse(JSON.stringify(sample)), rules: "  \n " }).rules === undefined);
check("the example map carries rules, and they survive being saved and read back", typeof sample.rules === "string" && sample.rules.length > 100 && storage.normalizeMap(storage.readMapFile(JSON.parse(JSON.stringify(storage.writeMapFile("map", storage.mapPayload(sample), sample)))).payload).rules === sample.rules);
check("and a rules field that is not text is dropped", storage.normalizeMap({ ...JSON.parse(JSON.stringify(sample)), rules: 42 }).rules === undefined);
check("a network file does not carry the rules, which belong to the whole map", !("rules" in storage.networkPayload(ruled)));

console.log("PASS:"); ok.forEach((line) => console.log("  ✓ " + line));
if (bad.length) { console.log("FAIL:"); bad.forEach((line) => console.log("  ✗ " + line)); }
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
