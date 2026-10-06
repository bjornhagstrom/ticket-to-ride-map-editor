// Damaged and wrong files: what reading them must never do, and what it does instead. Written before
// repairMap existed.
//
//   npm run test:corrupt-files
//
// A map file passes through people's hands, spreadsheets and other tools before it comes back, and the
// map kept in the browser can be cut short. Reading one must never crash the editor or quietly take
// away what is still good: a file that is not a map at all is refused with a reason; a map with damaged
// parts opens with what can be used, and says what was left out and why. Anything a later build added
// to an otherwise sound stop, route or ticket is kept (docs/FILE-FORMAT.md, rule 3).
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-corrupt-"));
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/map-storage.ts", "app/map-data.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const storage = require(path.join(out, "map-storage.js"));
const { initialMap } = require(path.join(out, "map-data.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const attempt = (fn) => { try { return { value: fn() }; } catch (error) { return { error }; } };
const stop = (id, x = 100, y = 100, extra = {}) => ({ id, name: id.toUpperCase(), type: "city", x, y, ...extra });
const route = (id, a, b, length = 2, extra = {}) => ({ id, a, b, length, type: "city", color: "red", ...extra });

// ---------------------------------------------------------------- not a map at all
for (const [label, raw] of [["nothing", null], ["a number", 42], ["a text", "hello"], ["a list", [1, 2, 3]], ["true", true]]) {
  const read = attempt(() => storage.readMapFile(raw));
  check(`a file holding ${label} is refused, with a reason a person can read`, Boolean(read.error) && /map file|not a map|could not/i.test(String(read.error.message)), read.error ? read.error.message : "accepted");
}
for (const [label, raw] of [["an object with none of a map's parts", { hello: "world", name: "package" }], ["an envelope with nothing in it", { format: "ticket-to-ride-map", version: 3, kind: "map" }], ["an empty object", {}]]) {
  const read = attempt(() => storage.readMapFile(raw));
  check(`${label} is refused, so it cannot take the place of the open map`, Boolean(read.error) && /not a map/i.test(String(read.error.message)), read.error ? read.error.message : "accepted");
}
const badPayload = attempt(() => storage.readMapFile({ format: "ticket-to-ride-map", version: 3, kind: "map", payload: "not an object" }));
check("an envelope whose content is not a map is refused, not opened empty", Boolean(badPayload.error), badPayload.error ? badPayload.error.message : "accepted");

// ---------------------------------------------------------------- a sound map is untouched
{
  const sound = storage.repairMap(clone(initialMap));
  check("the example map needs no repair", sound.repairs.length === 0, sound.repairs.join(" | "));
  check("and comes out as normalizeMap gives it", JSON.stringify(sound.map) === JSON.stringify(storage.normalizeMap(clone(initialMap))));
}

// ---------------------------------------------------------------- damaged parts
{
  const raw = {
    name: "Damaged",
    stops: [stop("a"), null, "b", {}, stop("c", "300", "120"), stop("d", "east", 10), stop("a", 500, 500), stop("e", 700, 200, { futureField: { kept: true } }), stop("f", Infinity, 4)],
    routes: [route("r1", "a", "c"), null, route("r2", "a", "nowhere"), route("r3", "c", "c"), route("r4", "a", "e", "3"), route("r5", "c", "e", 0), route("r6", "a", "e", 2.6, { points: "bent", locomotiveSlots: [0, "x", 9, 1] }), route("r7", "e", "a", 2, { laneNote: "kept" })],
    tickets: [{ id: "t1", a: "a", b: "e", points: 5 }, { id: "t2", a: "a", b: "ghost", points: 3 }, null, { id: "t3", a: "c", b: "e", points: "many" }, { id: "t4", a: "c", b: "a", points: 4, set: "lost-deck" }],
    ticketSets: [{ id: "main", label: "Main deck" }, null, { label: "no id" }, { id: "main", label: "Twice" }],
    notes: [{ id: "n1", x: 10, y: 10, width: 100, height: 50, text: "fine" }, { id: "n2", x: "here" }, null, { id: "n3", x: 1, y: 1, width: 40, height: 20, text: 7 }],
    background: [{ id: "b1", type: "area", label: "Sea", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], fill: "#00f", stroke: "#00f", opacity: 1, strokeWidth: 1 }, { id: "b2", type: "area", points: "none" }, null, { id: "b3", type: "line", label: "", points: [{ x: 0, y: 0 }, { x: "?", y: 1 }, { x: 5, y: 5 }], fill: "", stroke: "#000", opacity: 1, strokeWidth: 1 }],
  };
  const { map, repairs } = storage.repairMap(clone(raw));
  const ids = (list) => list.map((item) => item.id).join(",");
  check("stops that are not stops, or have no place on the map, are left out; the rest are kept", ids(map.stops) === "a,c,e", ids(map.stops));
  check("a place written as text that is a number is read as that number", map.stops.find((s) => s.id === "c").x === 300 && map.stops.find((s) => s.id === "c").y === 120);
  check("a second stop with an id already used is left out, not allowed to take the first one's place", map.stops.filter((s) => s.id === "a").length === 1 && map.stops.find((s) => s.id === "a").x === 100);
  check("what a later build added to a sound stop is kept", map.stops.find((s) => s.id === "e").futureField?.kept === true);
  check("routes to a stop the map does not have, or from a stop to itself, are left out", !map.routes.some((r) => ["r2", "r3"].includes(r.id)) && map.routes.length === 5, ids(map.routes));
  check("a length written as text is read; a length below 1 becomes 1; a broken one is rounded", map.routes.find((r) => r.id === "r4").length === 3 && map.routes.find((r) => r.id === "r5").length === 1 && map.routes.find((r) => r.id === "r6").length === 3);
  check("bends that are not a list of points are dropped, and locomotive spaces that are not on the route", map.routes.find((r) => r.id === "r6").points === undefined && JSON.stringify(map.routes.find((r) => r.id === "r6").locomotiveSlots) === "[0,1]", JSON.stringify(map.routes.find((r) => r.id === "r6")));
  check("what a later build added to a sound route is kept", map.routes.find((r) => r.id === "r7").laneNote === "kept");
  check("tickets to a stop the map does not have are left out", ids(map.tickets) === "t1,t3,t4", ids(map.tickets));
  check("a ticket's points that are not a number become 1, to be set again", map.tickets.find((t) => t.id === "t3").points === 1);
  check("a ticket in a deck that does not exist moves to the first deck", (map.tickets.find((t) => t.id === "t4").set ?? map.ticketSets[0].id) === map.ticketSets[0].id && map.ticketSets.some((s) => s.id === (map.tickets.find((t) => t.id === "t4").set ?? map.ticketSets[0].id)));
  check("decks with no id, or an id already used, are left out", ids(map.ticketSets) === "main", ids(map.ticketSets));
  check("notes with no place or size are left out; text that is not text becomes empty", ids(map.notes) === "n1,n3" && map.notes.find((n) => n.id === "n3").text === "", ids(map.notes));
  check("background shapes with too few usable points are left out, and points that are not points are dropped", ids(map.background) === "b1,b3" && map.background.find((b) => b.id === "b3").points.length === 2, ids(map.background));
  check("every repair is said, in words, counted", repairs.length >= 6 && repairs.every((r) => typeof r === "string" && r.length > 10 && !/undefined|NaN|\[object/.test(r)), repairs.join(" | "));
  check("the stops left out are counted in what it says", repairs.some((r) => /6 stops?/.test(r)), repairs.join(" | "));
  check("and the routes", repairs.some((r) => /3 routes/.test(r)), repairs.join(" | "));
  check("normalizeMap gives the same repaired map", JSON.stringify(storage.normalizeMap(clone(raw))) === JSON.stringify(map));
}

// ---------------------------------------------------------------- wrong types at the top
{
  const { map } = storage.repairMap({ name: 12, stops: "many", routes: { a: 1 }, tickets: 5, notes: "x", background: true, ticketSets: "x", wagonsPerPlayer: "lots", players: "all" });
  check("a top-level field of the wrong type is read as empty, not as a crash", Array.isArray(map.stops) && map.stops.length === 0 && map.routes.length === 0 && map.tickets.length === 0 && map.notes.length === 0 && map.background.length === 0 && map.ticketSets.length === 1);
  check("a name that is not text becomes a name", typeof map.name === "string" && map.name.length > 0, String(map.name));
  const tension = storage.repairMap({ stops: [], deckTension: "furious" }).map;
  check("a deck tension that is neither a number nor one of the three words is left out", tension.deckTension === undefined, String(tension.deckTension));
  check("one outside 0 to 100 is brought to the nearest end", storage.repairMap({ stops: [], deckTension: 400 }).map.deckTension === 100 && storage.repairMap({ stops: [], deckTension: -20 }).map.deckTension === 0);
  check("settings that are not numbers take the defaults", Number.isInteger(map.wagonsPerPlayer) && map.wagonsPerPlayer > 0);
}

// ---------------------------------------------------------------- a legacy format with damage in it
{
  const legacy = attempt(() => storage.repairMap({ format: "a4", stops: [null, stop("a")], notes: [null], background: [{ id: "b", points: null }], routes: [{ id: "r", a: "a", b: "a", points: null }] }));
  check("an old-format map with damage in it opens, moved onto its board", Boolean(legacy.value) && legacy.value.map.format === "board-2x3" && legacy.value.map.stops.length === 1, legacy.error ? legacy.error.message : "");
}

// ---------------------------------------------------------------- nothing leaks out of a file
{
  const hostile = JSON.parse('{"name":"x","stops":[],"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted2":true}}}');
  const read = attempt(() => storage.repairMap(hostile));
  const write = read.value ? attempt(() => JSON.stringify(storage.writeMapFile("map", storage.mapPayload(read.value.map), read.value.map))) : { error: new Error("not read") };
  check("a file cannot reach the editor's own objects through __proto__ or constructor", ({}).polluted === undefined && ({}).polluted2 === undefined && Boolean(read.value) && Boolean(write.value));
}

// ---------------------------------------------------------------- big, and still quick
{
  const many = { stops: Array.from({ length: 3000 }, (_, i) => stop(`s${i}`, i % 1100, (i * 7) % 700)), routes: Array.from({ length: 3000 }, (_, i) => route(`r${i}`, `s${i}`, `s${(i + 1) % 3000}`)) };
  const started = Date.now();
  const { map } = storage.repairMap(many);
  check("a map of 3000 stops and 3000 routes is read in well under a second", Date.now() - started < 1000 && map.stops.length === 3000 && map.routes.length === 3000, `${Date.now() - started} ms`);
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
