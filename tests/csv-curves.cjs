// Curves in the spreadsheet export (docs/CSV.md, "Bends and curves"). Written before the code. A route's bends
// (`points`, in board units, from its `From` stop to its `To` stop) and whether it is straightened (`curved: false`)
// go out in two columns after the others, `Bends` and `Curved`, and come back in when the stops are read as they
// were written. An older build reads by header and passes over them.
//
//   npm run test:csv-curves
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-csv-curves-"));
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/csv-import.ts", "app/csv-export.ts", "app/map-data.ts", "app/map-storage.ts",
  "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const imp = require(path.join(out, "csv-import.js"));
const exp = require(path.join(out, "csv-export.js"));
const { initialMap, emptyMap } = require(path.join(out, "map-data.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const table = (text) => { const rows = imp.parseCsv(text); return { header: rows[0], rows: rows.slice(1), col: (name) => rows[0].indexOf(name) }; };
const read = (files, data = emptyMap) => imp.readCsvImport(files.map(([name, text]) => ({ name, text })), clone(data));

// A map with three curved routes: two bends, one bend, and a straightened one; a double route among them.
const map = clone(initialMap);
const [r0, r1, r2, r3] = map.routes;
delete r3.points; delete r3.curved;
r0.points = [{ x: 412.4, y: 305.6 }, { x: 450, y: 330 }]; delete r0.curved;
r1.points = [{ x: 600, y: 200 }]; delete r1.curved;
r2.points = [{ x: 300, y: 300 }, { x: 320, y: 360 }]; r2.curved = false;
const lanes = map.routes.filter((r) => (r.a === r0.a && r.b === r0.b) || (r.a === r0.b && r.b === r0.a));
for (const lane of lanes) { lane.points = clone(r0.points); delete lane.curved; }

// ---------------------------------------------------------------- what the export writes
{
  const routes = table(exp.routesCsv(map));
  const last = routes.header.slice(-4);
  check("the route file has Bends and Curved, after the columns that were there, which keep their places", last.join() === ["From id", "To id", "Bends", "Curved"].join() && routes.header.slice(0, 8).join() === ["From", "To", "Length", "Colour", "Type", "Wagon style", "Locomotives", "Double route"].join(), routes.header.join());
  const row = (id) => routes.rows[map.routes.findIndex((r) => r.id === id)];
  check("a route's bends are written as x:y pairs from its From stop to its To stop, in board units", row(r0.id)[routes.col("Bends")] === "412:306 450:330", String(row(r0.id)[routes.col("Bends")]));
  check("one bend is one pair", row(r1.id)[routes.col("Bends")] === "600:200");
  check("a straightened route says so, and a curved one says nothing", row(r2.id)[routes.col("Curved")] === "no" && row(r0.id)[routes.col("Curved")] === "" && row(r1.id)[routes.col("Curved")] === "");
  check("a route with no bends has an empty cell", routes.rows[map.routes.findIndex((r) => r.id === r3.id)][routes.col("Bends")] === "");
  check("nothing in the new cells needs quoting or can be read as a formula", routes.rows.every((r) => !/[",;=+@]/.test(r[routes.col("Bends")]) && !/^-/.test(r[routes.col("Bends")])));
}

// ---------------------------------------------------------------- read back
{
  const files = [["stops.csv", exp.stopsCsv(map)], ["routes.csv", exp.routesCsv(map)]];
  const back = read(files, map);
  const same = (r) => back.routes.find((x) => x.a === r.a && x.b === r.b && JSON.stringify(x.points ?? []) === JSON.stringify((r.points ?? []).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))));
  check("every bend comes back, to the whole unit", map.routes.every((r) => same(r)), `${back.routes.length} routes`);
  check("a straightened route comes back straightened, and the others as curved as they were", back.routes.find((x) => x.a === r2.a && x.b === r2.b).curved === false && back.routes.filter((x) => x.curved === false).length === map.routes.filter((r) => r.curved === false).length);
  check("and nothing is warned about", back.warnings.length === 0, back.warnings.join(" | "));
  check("both lanes of a double route keep the shape", lanes.length >= 2 && back.routes.filter((x) => x.a === r0.a && x.b === r0.b).every((x) => (x.points ?? []).length === 2));
}

// ---------------------------------------------------------------- when the stops were moved, the bends are not kept
{
  const wide = clone(map); wide.stops.forEach((s) => { s.x *= 5; s.y *= 5; });
  wide.routes.forEach((r) => { if (r.points) r.points = r.points.map((p) => ({ x: p.x * 5, y: p.y * 5 })); });
  const scaled = read([["stops.csv", exp.stopsCsv(wide)], ["routes.csv", exp.routesCsv(wide)]], map);
  check("stops that had to be fitted to the board take their bends' meaning with them: the bends are left out, and it says so", scaled.scaled === true && scaled.routes.every((r) => !r.points) && scaled.warnings.some((w) => /bend/i.test(w)), scaled.warnings.join(" | "));
  const noStops = read([["routes.csv", exp.routesCsv(map)]], emptyMap);
  check("routes alone over an empty map lay the stops out, so the bends mean nothing there and are left out, said", noStops.routes.every((r) => !r.points) && noStops.warnings.some((w) => /bend/i.test(w)), noStops.warnings.join(" | "));
  const over = read([["routes.csv", exp.routesCsv(map)]], map);
  check("routes alone over the map that has the stops keep their places, so the bends are kept", over.routes.some((r) => r.points && r.points.length === 2) && !over.warnings.some((w) => /bend/i.test(w)), over.warnings.join(" | "));
}

// ---------------------------------------------------------------- a cell that cannot be read, and hostile ones
{
  const stops = "Name,X,Y\nA,100,100\nB,500,300\n";
  const odd = read([["stops.csv", stops], ["routes.csv", "From,To,Length,Bends,Curved\nA,B,3,abc,\nA,B,4,200:150 nonsense,\nA,B,2,300:200,maybe\n"]]);
  check("a Bends cell that cannot be read leaves the route without bends, counted, and the route is still read", odd.routes.length === 3 && odd.routes[0].points === undefined && odd.routes[1].points === undefined && odd.warnings.some((w) => /2 routes/.test(w) && /bend/i.test(w)), odd.warnings.join(" | "));
  check("a bend that can be read is kept; a Curved cell that is not yes or no changes nothing", odd.routes[2].points && odd.routes[2].points.length === 1 && odd.routes[2].curved === undefined);
  const many = read([["stops.csv", stops], ["routes.csv", "From,To,Length,Bends\nA,B,3," + Array.from({ length: 500 }, (_, i) => `${100 + i}:${100 + i % 50}`).join(" ") + "\n"]]);
  check("a thousand bends is not a route: a cell holds at most 100", many.routes[0].points === undefined || many.routes[0].points.length <= 100, `${many.routes[0].points ? many.routes[0].points.length : 0} kept`);
  const wild = read([["stops.csv", stops], ["routes.csv", "From,To,Length,Bends\nA,B,3,1e999:5 -5:NaN 99999999:1\n"]]);
  check("numbers that are not numbers, or far off the board, are not bends", wild.routes[0].points === undefined, JSON.stringify(wild.routes[0].points));
}

// ---------------------------------------------------------------- files from before: no such columns
{
  const old = read([["stops.csv", "Name,Type,Routes,Neighbours,Tickets,X,Y\nAlpha,Regular,1,1,0,100,100\nBeta,Regular,1,1,0,300,300\n"], ["routes.csv", "From,To,Length,Colour,Type,Wagon style,Locomotives,Double route\nAlpha,Beta,3,Red,Railway,,0,\n"]]);
  check("a route file without the columns reads as it did: the route, no bends, nothing said", old.routes.length === 1 && old.routes[0].points === undefined && old.warnings.length === 0, old.warnings.join(" | "));
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
