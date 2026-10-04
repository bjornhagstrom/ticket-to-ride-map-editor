// How a network holds together: dead ends, routes whose loss cuts the map in two, and corners reached
// only through one or two stops. Written before networkShape existed.
//
//   npm run test:network-shape
//
// The official maps are "tense but connected" (docs/PROPOSAL-UNEVEN-MAPS.md): corners are common and
// deliberate, a route with one lane that cuts the map in two never occurs. The editor describes the
// first and warns about the second, so it has to tell them apart exactly. Checked on invented maps,
// and on Europe and the USA when the private reference data is beside this repository.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-shape-"));
execFileSync("npx", ["tsc", "app/map-analysis.ts", "app/map-data.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const { networkShape, SHAPE_OFFICIAL } = require(path.join(out, "map-analysis.js"));
const { emptyMap } = require(path.join(out, "map-data.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const names = (stops) => stops.map((s) => s.name).sort().join(",");

const build = (stopNames, edges) => ({
  ...JSON.parse(JSON.stringify(emptyMap)),
  stops: stopNames.map((n, i) => ({ id: n, name: n, type: "city", x: 100 + i * 10, y: 100 })),
  routes: edges.map(([a, b], i) => ({ id: `r${i}`, a, b, length: 2, type: "city", color: "neutral" })),
});

// A ring of eight, which holds together however you cut it.
const ring = ["A", "B", "C", "D", "E", "F", "G", "H"];
const ringEdges = ring.map((s, i) => [s, ring[(i + 1) % ring.length]]).concat([["A", "E"], ["C", "G"]]);
{
  const shape = networkShape(build(ring, ringEdges));
  check("a ring with cross routes has no dead end, nothing that cuts it, and no corner", shape.unconnected.length === 0 && shape.deadEnds.length === 0 && shape.bridges.length === 0 && shape.corners.length === 0, JSON.stringify({ d: shape.deadEnds.length, b: shape.bridges.length, c: shape.corners.length }));
}
// The ring plus a cape on one route, a stop with no route at all, and a corner of two behind two gates.
{
  const stops = [...ring, "Cape", "Lonely", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"];
  const extra = [["P", "Q"], ["Q", "R"], ["R", "S"], ["S", "T"], ["T", "U"], ["U", "V"], ["V", "W"], ["W", "X"], ["X", "Y"], ["Y", "Z"], ["Z", "P"], ["P", "A"], ["T", "E"], ["X", "G"]];
  const map = build(stops, [...ringEdges, ...extra, ["B", "Cape"]]);
  let shape = networkShape(map);
  check("a stop with no route is listed as unconnected", names(shape.unconnected) === "Lonely", names(shape.unconnected));
  check("a stop on one route is a dead end", names(shape.deadEnds) === "Cape", names(shape.deadEnds));
  check("its route cuts the map in two, and has one lane", shape.bridges.length === 1 && shape.bridges[0].lanes === 1 && [shape.bridges[0].a.name, shape.bridges[0].b.name].sort().join() === "B,Cape", JSON.stringify(shape.bridges.map((b) => [b.a.name, b.b.name, b.lanes])));
  map.routes.push({ id: "r-second", a: "B", b: "Cape", length: 2, type: "city", color: "red" });
  shape = networkShape(map);
  check("a second lane makes it a double route, still the only way in", shape.bridges.length === 1 && shape.bridges[0].lanes === 2 && shape.bridges[0].routeIds.length === 2);
}
// A corner: three stops reached only through two gates on the ring.
{
  const big = [...ring, "I", "J", "K", "L", "M", "N", "O", "P2", "Q2", "R2"];
  const bigEdges = [...ringEdges, ["I", "J"], ["J", "K"], ["K", "L"], ["L", "M"], ["M", "N"], ["N", "O"], ["O", "P2"], ["P2", "Q2"], ["Q2", "R2"], ["R2", "I"], ["I", "A"], ["M", "E"], ["O", "C"]];
  const map = build([...big, "Nook1", "Nook2", "Nook3"], [...bigEdges, ["Nook1", "Nook2"], ["Nook2", "Nook3"], ["Nook1", "Nook3"], ["Nook1", "F"], ["Nook3", "H"]]);
  const shape = networkShape(map);
  const corner = shape.corners.find((c) => names(c.stops) === "Nook1,Nook2,Nook3");
  check("three stops reached only through two others are a corner, with those two as its gates", Boolean(corner) && names(corner.gates) === "F,H", JSON.stringify(shape.corners.map((c) => [names(c.stops), names(c.gates)])));
  check("and the corner knows the routes into it", corner && corner.routeIds.length === 2);
  check("nothing in it is a dead end or a route that cuts the map", shape.deadEnds.length === 0 && shape.bridges.length === 0);
}
// What is not a corner: a dead end with the stop it hangs from, and a line of stops between two gates.
{
  const big = [...ring, "I", "J", "K", "L", "M", "N", "O", "P2", "Q2", "R2"];
  const bigEdges = [...ringEdges, ["I", "J"], ["J", "K"], ["K", "L"], ["L", "M"], ["M", "N"], ["N", "O"], ["O", "P2"], ["P2", "Q2"], ["Q2", "R2"], ["R2", "I"], ["I", "A"], ["M", "E"], ["O", "C"]];
  const map = build([...big, "Hang", "Tip", "Line1", "Line2"], [...bigEdges, ["Hang", "B"], ["Hang", "D"], ["Hang", "Tip"], ["Line1", "F"], ["Line1", "Line2"], ["Line2", "H"]]);
  const shape = networkShape(map);
  check("a dead end and the stop it hangs from are not a corner as well", !shape.corners.some((c) => c.stops.some((s) => s.name === "Tip")), JSON.stringify(shape.corners.map((c) => names(c.stops))));
  check("a line of stops between two gates is not a corner", !shape.corners.some((c) => c.stops.some((s) => s.name === "Line1")), JSON.stringify(shape.corners.map((c) => names(c.stops))));
}
check("the official figures are there to compare with", SHAPE_OFFICIAL && SHAPE_OFFICIAL.maps === 8 && SHAPE_OFFICIAL.singleLaneBridges === 0);

// ---------------------------------------------------------------- the official maps
const referencePath = process.env.TTR_REFERENCE_DATA || path.join(root, "..", "ttr-reference-data", "ttr-reference-maps.json");
if (!fs.existsSync(referencePath)) {
  console.log(`Reference data not found at ${referencePath}: the checks on the official maps are skipped.`);
} else {
  const reference = JSON.parse(fs.readFileSync(referencePath, "utf8"));
  const asMap = (source) => {
    const dropped = new Set(source.stops.filter((s) => s.deadEnd || s.kind === "country" || s.kind === "country-group").map((s) => s.id));
    return { ...JSON.parse(JSON.stringify(emptyMap)),
      stops: source.stops.filter((s) => !dropped.has(s.id)).map((s, i) => ({ id: s.id, name: s.name, type: s.kind === "waypoint" ? "junction" : "city", x: s.x ?? i, y: s.y ?? i })),
      routes: source.routes.filter((r) => !dropped.has(r.a) && !dropped.has(r.b)).map((r, i) => ({ id: `r${i}`, a: r.a, b: r.b, length: r.length, type: "city", color: r.color ?? "neutral" })) };
  };
  const europe = networkShape(asMap(reference.maps.find((m) => m.id === "europe")));
  check("Europe: Edinburgh is its one dead end", names(europe.deadEnds) === "Edinburgh", names(europe.deadEnds));
  check("Europe: Edinburgh–London is the one route that cuts the map in two, and it is a double route", europe.bridges.length === 1 && europe.bridges[0].lanes === 2, JSON.stringify(europe.bridges.map((b) => [b.a.name, b.b.name, b.lanes])));
  const iberia = europe.corners.find((c) => ["Lisboa", "Cadiz", "Madrid"].every((n) => c.stops.some((s) => s.name === n)));
  check("Europe: Iberia is a corner, reached through two gates", Boolean(iberia) && iberia.gates.length === 2, iberia ? `${names(iberia.stops)} through ${names(iberia.gates)}` : JSON.stringify(europe.corners.map((c) => names(c.stops))));
  // The figures the editor quotes, measured again on the eight calibration maps.
  const calibration = reference.maps.filter((m) => m.useForCalibration).map((m) => networkShape(asMap(m)));
  const measured = {
    maps: calibration.length,
    mapsWithDeadEnds: calibration.filter((s) => s.deadEnds.length).length,
    mapsWithBridges: calibration.filter((s) => s.bridges.length).length,
    singleLaneBridges: calibration.reduce((n, s) => n + s.bridges.filter((b) => b.lanes === 1).length, 0),
    mapsWithCorners: calibration.filter((s) => s.corners.length).length,
    cornersPerMap: [Math.min(...calibration.map((s) => s.corners.length)), Math.max(...calibration.map((s) => s.corners.length))],
  };
  check("the official figures the editor quotes are what the calibration maps measure", JSON.stringify(measured) === JSON.stringify(SHAPE_OFFICIAL), JSON.stringify(measured));
  const usa = networkShape(asMap(reference.maps.find((m) => m.id === "usa")));
  check("USA: no dead end, nothing that cuts it, no corner", usa.deadEnds.length === 0 && usa.bridges.length === 0 && usa.corners.length === 0);
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
