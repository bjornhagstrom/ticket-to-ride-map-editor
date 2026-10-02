// What reading a spreadsheet back must do. Written before the import was built.
//
//   npm run test:csv-import
//
// Stops, routes and tickets come in as CSV: our own exports, the reference data's exports, or a
// list somebody typed into a spreadsheet. The rules: the kind of file is told from its header; names
// tie the files together; positions are kept when they fit the board, fitted to it when they do not,
// and worked out when there are none; anything that cannot be used is left out and said so.
// The official maps, when the private reference data is beside this repository, are the hard cases:
// Europe's lonely end stations, USA without a single position, Switzerland's countries.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-csv-import-"));
execFileSync("npx", ["tsc", "app/csv-import.ts", "app/csv-export.ts", "app/map-data.ts", "app/map-storage.ts",
  "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"],
  { cwd: root, stdio: "inherit" });
const imp = require(path.join(out, "csv-import.js"));
const exp = require(path.join(out, "csv-export.js"));
const { initialMap, emptyMap, mapFormats } = require(path.join(out, "map-data.js"));
const { buildAdjacency, shortestPath } = require(path.join(out, "map-analysis.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };

const board = mapFormats["board-2x3"];
const blank = JSON.parse(JSON.stringify(emptyMap));
const inBoard = (stop) => stop.x >= 0 && stop.x <= board.width && stop.y >= 0 && stop.y <= board.height;
const closest = (stops) => { let best = Infinity; for (let i = 0; i < stops.length; i++) for (let j = i + 1; j < stops.length; j++) best = Math.min(best, Math.hypot(stops[i].x - stops[j].x, stops[i].y - stops[j].y)); return best; };
const byName = (result, name) => result.stops.find((stop) => stop.name === name);
const neighbours = (result, name) => { const id = byName(result, name).id; return new Set(result.routes.filter((r) => r.a === id || r.b === id).map((r) => (r.a === id ? r.b : r.a))); };

// ---------------------------------------------------------------- reading the text
{
  const rows = imp.parseCsv('﻿Name;X;Y\r\n"Semi;colon";1;2\nPlain;3;4\n');
  check("a semicolon file, as Swedish Excel saves it, is read", rows.length === 3 && rows[1][0] === "Semi;colon" && rows[2][2] === "4", JSON.stringify(rows));
  const tabbed = imp.parseCsv("Name\tX\tY\nA\t1\t2\n");
  check("so is a tab-separated one", tabbed[1].join("|") === "A|1|2", JSON.stringify(tabbed));
  const quoted = imp.parseCsv('a,b\r\n"Line\nbreak","Say ""hi"""\r\n');
  check("quotes, doubled quotes and line breaks inside quotes survive", quoted[1][0] === "Line\nbreak" && quoted[1][1] === 'Say "hi"', JSON.stringify(quoted));
  check("empty lines at the end are not rows", imp.parseCsv("a,b\n1,2\n\n\n").length === 2);
  const defused = imp.parseCsv(exp.toCsv([["Name"], ["=SUM(A1)"], ["-x"]]));
  check("a cell our export defused with an apostrophe reads back as it was written", defused[1][0] === "=SUM(A1)" && defused[2][0] === "-x", JSON.stringify(defused));
}

// ---------------------------------------------------------------- telling the files apart
{
  const kind = (text) => imp.csvFileKind(imp.parseCsv(text));
  check("our stop export is a stop file", kind(exp.stopsCsv(initialMap)) === "stops");
  check("our route export is a route file", kind(exp.routesCsv(initialMap)) === "routes");
  check("our ticket export is a ticket file", kind(exp.ticketsCsv(initialMap, initialMap.ticketSets.map((s) => s.id))) === "tickets");
  check("our distance table is recognised, to be turned away", kind(exp.distancesCsv(initialMap)) === "distances");
  check("the reference data's headers are known too", kind("id,name,kind,x,y\n") === "stops" && kind("a,b,length,color,kind,tunnel,ferryLocomotives\n") === "routes" && kind("a,b,points,long\n") === "tickets");
  check("headers in any case, with a stray space", kind(" FROM ,to,LENGTH\n") === "routes" && kind("name , x, Y\n") === "stops");
  check("a file that is none of them is unknown", kind("foo,bar\n1,2\n") === "unknown");
  const refused = imp.readCsvImport([{ name: "d.csv", text: exp.distancesCsv(initialMap) }], blank);
  check("a distance table alone imports nothing, and says why", refused.stops.length === 0 && refused.routes.length === 0 && refused.tickets.length === 0 && refused.warnings.some((w) => /distance/i.test(w)), refused.warnings.join(" | "));
}

// ---------------------------------------------------------------- our own files, round trip
{
  const map = initialMap;
  const files = [
    { name: "stops.csv", text: exp.stopsCsv(map) },
    { name: "routes.csv", text: exp.routesCsv(map) },
    { name: "tickets.csv", text: exp.ticketsCsv(map, map.ticketSets.map((s) => s.id)) },
  ];
  // Back into a map with the same styles, as when a person exports, edits in a spreadsheet and imports.
  const back = imp.readCsvImport(files, map);
  const elsewhere = imp.readCsvImport(files, blank);
  check("into a map without the example's own route type, that route becomes a railway, and the import says so", elsewhere.routes.length === map.routes.length && elsewhere.warnings.some((w) => /Restricted/.test(w)), elsewhere.warnings.join(" | "));
  check("the example map comes back with every stop and route", back.stops.length === map.stops.length && back.routes.length === map.routes.length, `${back.stops.length} stops, ${back.routes.length} routes`);
  check("every stop where it was, to the rounding", map.stops.every((s) => { const b = byName(back, s.name); return b && Math.abs(b.x - s.x) <= .5 && Math.abs(b.y - s.y) <= .5; }));
  check("nothing was scaled or worked out", !back.scaled && back.placed.length === 0, JSON.stringify({ scaled: back.scaled, placed: back.placed }));
  check("a junction is a junction again", map.stops.every((s) => byName(back, s.name).type === s.type), map.stops.map((s) => `${s.type}/${byName(back, s.name).type}`).join(","));
  const sig = (data, r) => { const n = (id) => data.stops.find((s) => s.id === id).name; return [[n(r.a), n(r.b)].sort().join("~"), r.length, r.color, r.type, r.wagonStyle || "", (r.locomotiveSlots || []).length].join("|"); };
  const want = map.routes.map((r) => sig(map, r)).sort(), got = back.routes.map((r) => sig(back, r)).sort();
  check("every route with its length, colour, type, wagon style and locomotives, double routes as two", JSON.stringify(want) === JSON.stringify(got), want.filter((w, i) => w !== got[i]).slice(0, 3).join(" ; ") + " vs " + got.filter((g, i) => g !== want[i]).slice(0, 3).join(" ; "));
  check("every ticket, in a deck named after its own", back.tickets.length === map.tickets.length && back.sets.length === map.ticketSets.length && back.sets.every((s) => map.ticketSets.some((m) => s.label.startsWith(m.label))), back.sets.map((s) => s.label).join(" | "));
  const tsig = (data, t) => { const n = (id) => data.stops.find((s) => s.id === id).name; return `${[n(t.a), n(t.b)].sort().join("~")}|${t.points}|${t.long ? "L" : ""}`; };
  check("each with its stops, points and long flag", JSON.stringify(map.tickets.map((t) => tsig(map, t)).sort()) === JSON.stringify(back.tickets.map((t) => tsig(back, t)).sort()));
  check("and no warnings", back.warnings.length === 0, back.warnings.join(" | "));
  const all = new Set([...back.stops.map((s) => s.id), ...back.routes.map((r) => r.id), ...back.tickets.map((t) => t.id)]);
  check("every id is new and unique", all.size === back.stops.length + back.routes.length + back.tickets.length);
}

// ---------------------------------------------------------------- positions
{
  // Pixels from a scanned map: far outside the board. Fitted to it, the shape kept.
  const big = imp.readCsvImport([{ name: "s.csv", text: "Name,X,Y\nWest,0,1000\nEast,4000,1000\nNorth,2000,0\nSouth,2000,2000\n" }], blank);
  check("positions far outside the board are fitted to it, and the import says so", big.scaled && big.stops.every(inBoard), JSON.stringify(big.stops.map((s) => [s.x, s.y])));
  const w = byName(big, "West"), e = byName(big, "East"), n = byName(big, "North"), s = byName(big, "South");
  check("with the shape kept: twice as wide as tall stays so", Math.abs((e.x - w.x) / (s.y - n.y) - 2) < .01, `${e.x - w.x} by ${s.y - n.y}`);
  const geo = imp.readCsvImport([{ name: "s.csv", text: "Name,Lat,Lon\nMalmö,55.60,13.00\nYstad,55.43,13.82\nKristianstad,56.03,14.16\nHelsingborg,56.05,12.69\n" }], blank);
  check("latitude and longitude are read as a map: north up, east right", geo.stops.length === 4 && geo.stops.every(inBoard) && byName(geo, "Kristianstad").y < byName(geo, "Ystad").y && byName(geo, "Helsingborg").x < byName(geo, "Ystad").x, JSON.stringify(geo.stops.map((x) => [x.name, x.x, x.y])));

  // Routes alone, as a fan map's list would be: the stops are made from the names and laid out.
  const list = "From,To,Length\nA,B,3\nB,C,2\nC,D,4\nD,A,2\nA,C,5\nD,E,1\n";
  const routesOnly = imp.readCsvImport([{ name: "r.csv", text: list }], blank);
  check("a route list alone makes the stops from its names", routesOnly.stops.map((x) => x.name).sort().join("") === "ABCDE" && routesOnly.routes.length === 6);
  check("and lays them out on the board, apart, and says which", routesOnly.stops.every(inBoard) && closest(routesOnly.stops) >= 40 && routesOnly.placed.length === 5, `closest ${closest(routesOnly.stops).toFixed(0)}, placed ${routesOnly.placed.length}`);
  const again = imp.readCsvImport([{ name: "r.csv", text: list }], blank);
  check("the same file gives the same layout every time", JSON.stringify(again.stops.map((x) => [x.x, x.y])) === JSON.stringify(routesOnly.stops.map((x) => [x.x, x.y])));

  // One stop without a position among stops that have one goes between its neighbours.
  const partial = imp.readCsvImport([
    { name: "s.csv", text: "Name,X,Y\nLeft,200,300\nRight,600,300\nMiddle,,\n" },
    { name: "r.csv", text: "From,To,Length\nLeft,Middle,2\nMiddle,Right,2\n" },
  ], blank);
  const mid = byName(partial, "Middle");
  check("a stop without a position goes between its neighbours", mid && mid.x > 200 && mid.x < 600 && Math.abs(mid.y - 300) < 80 && partial.placed.join() === "Middle", JSON.stringify(mid));
}

// ---------------------------------------------------------------- what cannot be used
{
  const result = imp.readCsvImport([
    { name: "s.csv", text: "Name,X,Y\nAlpha,100,100\nBeta,300,100\nAlpha,500,500\n" },
    { name: "r.csv", text: "From,To,Length,Colour\nAlpha,Beta,2,Pink\nAlpha,Gamma,3,Red\nBeta,Alpha,0,Red\nAlpha,Beta,x,Red\n" },
  ], blank);
  check("a stop named twice is kept once, and said so", result.stops.filter((x) => x.name === "Alpha").length === 1 && result.warnings.some((w) => /Alpha/.test(w) && /twice|more than once/i.test(w)), result.warnings.join(" | "));
  check("a route to a stop the stop file does not have is left out, and said so", result.routes.length === 1 && result.warnings.some((w) => /Gamma/.test(w)), result.warnings.join(" | "));
  check("a route without a usable length is left out, and said so", result.warnings.some((w) => /length/i.test(w)));
  check("a colour the editor does not have becomes grey, and said so", result.routes[0].color === "neutral" && result.warnings.some((w) => /Pink/i.test(w)));
}

// ---------------------------------------------------------------- tickets for the map already open
{
  const map = initialMap;
  const tickets = exp.ticketsCsv(map, [map.ticketSets[0].id]) + "Main deck,Nowhere,Westport,5,,,\r\n";
  const result = imp.readCsvImport([{ name: "t.csv", text: tickets }], map);
  check("tickets alone are matched to the map's stops by name", result.stops.length === 0 && result.tickets.length === map.tickets.filter((t) => (t.set || map.ticketSets[0].id) === map.ticketSets[0].id).length && result.tickets.every((t) => map.stops.some((s) => s.id === t.a) && map.stops.some((s) => s.id === t.b)), `${result.tickets.length}`);
  check("and one naming a stop the map does not have is dropped, and counted", result.dropped === 1 && result.warnings.some((w) => /1 ticket/.test(w)), `${result.dropped} | ${result.warnings.join(" | ")}`);
  check("they arrive as a new deck, never into one that is there", result.sets.length === 1 && !map.ticketSets.some((s) => s.id === result.sets[0].id));
  check("the import says it is tickets only", result.network === false);
}

// ---------------------------------------------------------------- the official maps, when the private data is here
const reference = process.env.TTR_REFERENCE_DATA ? path.join(path.dirname(process.env.TTR_REFERENCE_DATA), "export") : path.join(root, "..", "ttr-reference-data", "export");
if (!fs.existsSync(path.join(reference, "europe", "routes.csv"))) {
  console.log(`Reference exports not found at ${reference}: the checks on the official maps are skipped.`);
} else {
  const read = (map, kinds = ["stops", "routes", "tickets"]) => imp.readCsvImport(kinds.map((k) => ({ name: `${k}.csv`, text: fs.readFileSync(path.join(reference, map, `${k}.csv`), "utf8") })), blank);
  const rows = (map, kind) => imp.parseCsv(fs.readFileSync(path.join(reference, map, `${kind}.csv`), "utf8")).length - 1;

  const europe = read("europe");
  const refStops = imp.parseCsv(fs.readFileSync(path.join(reference, "europe", "stops.csv"), "utf8")).slice(1);
  check("Europe: every stop, route and ticket", europe.stops.length === rows("europe", "stops") && europe.routes.length === rows("europe", "routes") && europe.tickets.length === rows("europe", "tickets"), `${europe.stops.length} stops, ${europe.routes.length} routes, ${europe.tickets.length} tickets`);
  check("Europe: on the board as drawn, nothing moved or worked out", !europe.scaled && europe.placed.length === 0 && refStops.every((r) => byName(europe, r[1]) && byName(europe, r[1]).x === Number(r[7]) && byName(europe, r[1]).y === Number(r[8])));
  // The end stations at the edge (Edinburgh behind its double route to London, Cadiz and Lisboa in
  // their corner) are where a careless import loses a route; every stop keeps all its neighbours.
  const refPairs = imp.parseCsv(fs.readFileSync(path.join(reference, "europe", "routes.csv"), "utf8")).slice(1);
  const refNeighbours = (name) => new Set(refPairs.filter((r) => r[0] === name || r[1] === name).map((r) => (r[0] === name ? r[1] : r[0]))).size;
  check("Europe: every stop keeps every neighbour, the lonely end stations too", europe.stops.every((s) => neighbours(europe, s.name).size === refNeighbours(s.name)) && neighbours(europe, "Edinburgh").size === 1 && neighbours(europe, "Cadiz").size === 2, ["Edinburgh", "Cadiz", "Lisboa"].map((n) => `${n} ${neighbours(europe, n).size}/${refNeighbours(n)}`).join(", "));
  check("Europe: Edinburgh–London is still a double route", europe.routes.filter((r) => [r.a, r.b].sort().join() === [byName(europe, "Edinburgh").id, byName(europe, "London").id].sort().join()).length === 2);
  const refRoutes = imp.parseCsv(fs.readFileSync(path.join(reference, "europe", "routes.csv"), "utf8")).slice(1);
  check("Europe: every tunnel, and every ferry locomotive", europe.routes.filter((r) => r.wagonStyle === "tunnel").length === refRoutes.filter((r) => r[5] === "True").length && europe.routes.reduce((s, r) => s + (r.locomotiveSlots || []).length, 0) === refRoutes.reduce((s, r) => s + Number(r[6] || 0), 0));
  check("Europe: no warnings", europe.warnings.length === 0, europe.warnings.join(" | "));
  const adjacency = buildAdjacency({ ...blank, stops: europe.stops, routes: europe.routes });
  const exact = europe.tickets.filter((t) => shortestPath(adjacency, t.a, t.b)?.distance === t.points).length;
  check("Europe: the tickets are worth their shortest path on the imported board, as on the real one", exact >= europe.tickets.length - 3, `${exact} of ${europe.tickets.length}`);

  const usa = read("usa", ["stops", "routes"]);
  check("USA, without one position: every stop laid out on the board, apart", usa.stops.length === rows("usa", "stops") && usa.placed.length === usa.stops.length && usa.stops.every(inBoard) && closest(usa.stops) >= 25, `${usa.placed.length} placed, closest ${closest(usa.stops).toFixed(0)}`);
  const ny = byName(usa, "New York"), la = byName(usa, "Los Angeles");
  check("USA: the layout follows the routes: New York and Los Angeles end up far apart", ny && la && Math.hypot(ny.x - la.x, ny.y - la.y) > board.width / 3, ny && la ? `${Math.hypot(ny.x - la.x, ny.y - la.y).toFixed(0)}` : "missing");

  const swiss = read("switzerland", ["stops", "routes"]);
  check("Switzerland: the countries, with no place and no route, are kept as stops and said so", swiss.stops.length === rows("switzerland", "stops") && swiss.placed.length === 4 && swiss.stops.every(inBoard) && swiss.warnings.some((w) => /4 stops/.test(w)), `${swiss.placed.join(", ")} | ${swiss.warnings.join(" | ")}`);

  const lights = read("northernlights", ["stops", "routes"]);
  const waypoints = imp.parseCsv(fs.readFileSync(path.join(reference, "northernlights", "stops.csv"), "utf8")).filter((r) => r[2] === "waypoint").length;
  check("Northern Lights: a waypoint arrives as a junction", waypoints > 0 && lights.stops.filter((s) => s.type === "junction").length === waypoints, `${waypoints} waypoints`);
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
