// Turning a board moves the names that end up on a route (docs/DECISIONS.md, "Names after a turn"). Written before the code.
// A name left to place itself is placed again after the board turns, and some then sit on a route. Turning now does what the
// button "Move names clear" does, in the same step: a name that is already clear stays where it is, a locked name stays, and
// whatever cannot be placed is said. Laying the board down again does the same.
//
//   npm run test:turn-names
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-turn-names-"));
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/map-analysis.ts", "app/map-data.ts", "app/map-storage.ts", "app/board.ts",
  "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const A = require(path.join(out, "map-analysis.js"));
const { rotateMap } = require(path.join(out, "board.js"));
const storage = require(path.join(out, "map-storage.js"));
const { initialMap, problemMap } = require(path.join(out, "map-data.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const covered = (data) => { const samples = A.routeSamplePoints(data); return A.labelledStops(data).filter((stop) => A.labelCovers(data, stop, samples)).map((stop) => stop.id); };
const angles = (data) => Object.fromEntries(data.stops.map((s) => [s.id, s.labelAngle]));
const tidied = (map) => { const m = clone(map); const { placed } = A.autoPlaceLabels(m); for (const s of m.stops) if (placed.has(s.id)) s.labelAngle = placed.get(s.id); return m; };

for (const [name, source] of [["the example map", initialMap], ["the map with problems", problemMap]]) {
  const start = tidied(storage.normalizeMap(clone(source)));
  const plain = rotateMap(clone(start), "portrait");
  const before = covered(plain);
  const turned = A.turnAndTidy(clone(start), "portrait");
  check(`${name}: turning it by itself leaves names on routes, which is what this is for`, before.length > 0 || name !== "the example map", `${before.length} names`);
  check(`${name}: turning it with the names tidied leaves fewer on a route than turning alone, and none that could be placed`, covered(turned.data).length <= Math.max(0, before.length - turned.moved) && covered(turned.data).length <= turned.unresolved.length + 0, `${before.length} after a plain turn, ${covered(turned.data).length} after (${turned.moved} moved, ${turned.unresolved.length} not placeable)`);
  check(`${name}: the board turned as it does without it: same orientation, same stops in the same places`, turned.data.orientation === "portrait" && turned.data.stops.every((s, i) => s.x === plain.stops[i].x && s.y === plain.stops[i].y));
  check(`${name}: a name that was clear after the turn is where the turn put it`, plain.stops.every((s) => before.includes(s.id) || turned.data.stops.find((t) => t.id === s.id).labelAngle === s.labelAngle));
  const back = A.turnAndTidy(clone(turned.data), "landscape");
  check(`${name}: laying it down again tidies too, and the map lies`, back.data.orientation === undefined && covered(back.data).length <= covered(rotateMap(clone(turned.data), "landscape")).length);
}

// A locked name stays where it is, whatever it covers.
{
  const start = tidied(storage.normalizeMap(clone(initialMap)));
  const plain = rotateMap(clone(start), "portrait");
  const samples = A.routeSamplePoints(plain);
  const victim = A.labelledStops(plain).find((stop) => A.labelCovers(plain, stop, samples));
  if (victim) {
    const lockedStart = clone(start); lockedStart.stops.find((s) => s.id === victim.id).labelLocked = true;
    const turned = A.turnAndTidy(lockedStart, "portrait");
    const plainLocked = rotateMap(clone(lockedStart), "portrait");
    check("a locked name is not moved by the turn's tidying", turned.data.stops.find((s) => s.id === victim.id).labelAngle === plainLocked.stops.find((s) => s.id === victim.id).labelAngle);
  } else check("a locked name is not moved by the turn's tidying (no name on a route to test with)", true);
}

// Turning to the way the board already lies changes nothing, and says nothing.
{
  const start = tidied(storage.normalizeMap(clone(initialMap)));
  const same = A.turnAndTidy(clone(start), "landscape");
  check("turning to the way it already lies changes nothing", JSON.stringify(same.data) === JSON.stringify(start) && same.moved === 0 && same.unresolved.length === 0);
}
// A map with no stops turns without trouble.
{
  const empty = storage.normalizeMap(clone(initialMap)); empty.stops = []; empty.routes = []; empty.tickets = [];
  const turned = A.turnAndTidy(empty, "portrait");
  check("an empty map turns, and has nothing to tidy", turned.data.orientation === "portrait" && turned.moved === 0);
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
