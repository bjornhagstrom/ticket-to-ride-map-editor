// Ids in spreadsheets (docs/CSV.md, "Ids and names"). Written before the code. Names stay in every file so a row
// reads on its own; ids are what ties the files together by machine, and when there is one it decides. So:
// our own export read back keeps every id; two stops with one name are two stops when they have ids; an id
// that disagrees with the name beside it wins, and the import says so; a file without ids (typed by hand, from
// the reference data, or exported by an older version) reads as it always did.
//
//   npm run test:csv-ids
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-csv-ids-"));
execFileSync("npx", ["tsc", "app/csv-import.ts", "app/csv-export.ts", "app/map-data.ts", "app/map-storage.ts",
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

// ---------------------------------------------------------------- what the export writes
{
  const stops = table(exp.stopsCsv(initialMap));
  check("the stop file has an Id column, and the names stay", stops.col("Id") >= 0 && stops.col("Name") >= 0 && stops.rows.every((row, i) => row[stops.col("Id")] === initialMap.stops[i].id && row[stops.col("Name")] === initialMap.stops[i].name));
  const routes = table(exp.routesCsv(initialMap));
  const stopName = new Map(initialMap.stops.map((s) => [s.id, s.name]));
  check("the route file has From id and To id beside From and To", routes.col("From id") >= 0 && routes.col("To id") >= 0 && routes.rows.every((row, i) => row[routes.col("From id")] === initialMap.routes[i].a && row[routes.col("To id")] === initialMap.routes[i].b && row[routes.col("From")] === stopName.get(initialMap.routes[i].a) && row[routes.col("To")] === stopName.get(initialMap.routes[i].b)));
  const decks = initialMap.ticketSets.map((s) => s.id);
  const tickets = table(exp.ticketsCsv(initialMap, decks));
  check("the ticket file has From id and To id beside From and To", tickets.col("From id") >= 0 && tickets.col("To id") >= 0 && tickets.rows.every((row) => stopName.get(row[tickets.col("From id")]) === row[tickets.col("From")] && stopName.get(row[tickets.col("To id")]) === row[tickets.col("To")]));
  const first = table(exp.stopsCsv(initialMap)).header.slice(0, 7);
  check("the columns that were there keep their place, so nothing that reads by position breaks", first.join() === ["Name", "Type", "Routes", "Neighbours", "Tickets", "X", "Y"].join(), first.join());
}

// ---------------------------------------------------------------- our own export, read back
{
  const files = [["stops.csv", exp.stopsCsv(initialMap)], ["routes.csv", exp.routesCsv(initialMap)], ["tickets.csv", exp.ticketsCsv(initialMap, initialMap.ticketSets.map((s) => s.id))]];
  const back = read(files, initialMap);
  check("every stop comes back with the id it had", back.stops.length === initialMap.stops.length && back.stops.every((s, i) => s.id === initialMap.stops[i].id && s.name === initialMap.stops[i].name), back.stops.slice(0, 2).map((s) => s.id).join());
  check("every route joins the same two stops as before", back.routes.length === initialMap.routes.length && back.routes.every((r, i) => r.a === initialMap.routes[i].a && r.b === initialMap.routes[i].b));
  const sameTickets = back.tickets.length === initialMap.tickets.length && back.tickets.every((t) => initialMap.tickets.some((o) => o.a === t.a && o.b === t.b && o.points === t.points));
  check("every ticket names the same two stops as before", sameTickets, `${back.tickets.length} tickets`);
  check("and nothing is warned about", back.warnings.length === 0, back.warnings.join(" | "));
}

// ---------------------------------------------------------------- two stops with one name
{
  const stopsCsv = "Name,Type,X,Y,Id\nSpringfield,Regular,100,100,sf-1\nSpringfield,Regular,500,300,sf-2\nShelbyville,Regular,300,200,sb\n";
  const routesCsv = "From,To,Length,Colour,From id,To id\nSpringfield,Shelbyville,3,Red,sf-1,sb\nSpringfield,Shelbyville,4,Blue,sf-2,sb\n";
  const ticketsCsv = "Deck,From,To,Points,From id,To id\nMain,Springfield,Shelbyville,5,sf-2,sb\n";
  const r = read([["stops.csv", stopsCsv], ["routes.csv", routesCsv], ["tickets.csv", ticketsCsv]]);
  check("two stops that share a name are two stops when they have ids", r.stops.length === 3 && r.stops.filter((s) => s.name === "Springfield").length === 2 && r.stops.map((s) => s.id).includes("sf-1") && r.stops.map((s) => s.id).includes("sf-2"), r.stops.map((s) => s.id).join());
  check("a route goes to the stop its id names, not to the first of that name", r.routes.length === 2 && r.routes[0].a === "sf-1" && r.routes[1].a === "sf-2", JSON.stringify(r.routes.map((x) => x.a)));
  check("and so does a ticket", r.tickets.length === 1 && r.tickets[0].a === "sf-2" && r.tickets[0].b === "sb", JSON.stringify(r.tickets.map((t) => [t.a, t.b])));
  check("a name used by two stops is said to be ambiguous only when a row relies on the name alone", !r.warnings.some((w) => /more than once/.test(w)), r.warnings.join(" | "));
  // Without ids, as before: the first is kept and the import says so.
  const plain = read([["stops.csv", "Name,Type,X,Y\nSpringfield,Regular,100,100\nSpringfield,Regular,500,300\nShelbyville,Regular,300,200\n"]]);
  check("with no ids the second stop of a name is left out, as it always was, and the import says so", plain.stops.length === 2 && plain.warnings.some((w) => /Springfield/.test(w) && /more than once/.test(w)), plain.warnings.join(" | "));
  const byName = read([["stops.csv", stopsCsv], ["routes.csv", "From,To,Length\nSpringfield,Shelbyville,3\n"]]);
  check("a route that names a doubled stop without an id goes to the first one, and the import says it was ambiguous", byName.routes.length === 1 && byName.routes[0].a === "sf-1" && byName.warnings.some((w) => /Springfield/.test(w) && /more than one stop|ambiguous|without an id/i.test(w)), byName.warnings.join(" | "));
}

// ---------------------------------------------------------------- an id and a name that disagree
{
  const stopsCsv = "Name,Id,X,Y\nAlpha,a,100,100\nBeta,b,300,300\nGamma,c,500,100\n";
  const routesCsv = "From,To,Length,From id,To id\nAlpha,Gamma,3,a,b\n";
  const r = read([["stops.csv", stopsCsv], ["routes.csv", routesCsv]]);
  check("when the id and the name beside it name different stops, the id wins", r.routes.length === 1 && r.routes[0].a === "a" && r.routes[0].b === "b", JSON.stringify(r.routes.map((x) => [x.a, x.b])));
  check("and the import says so, with the name that was written and the stop it became", r.warnings.some((w) => /Gamma/.test(w) && /Beta/.test(w) && /id/.test(w)), r.warnings.join(" | "));
  const unknownId = read([["stops.csv", stopsCsv], ["routes.csv", "From,To,Length,From id,To id\nAlpha,Gamma,3,zzz,c\n"]]);
  check("an id that no stop has is ignored and the name is used", unknownId.routes.length === 1 && unknownId.routes[0].a === "a" && unknownId.routes[0].b === "c", JSON.stringify(unknownId.routes.map((x) => [x.a, x.b])));
}

// ---------------------------------------------------------------- ids that cannot be used
{
  const dup = read([["stops.csv", "Name,Id,X,Y\nAlpha,same,100,100\nBeta,same,300,300\nGamma,,500,100\n"]]);
  check("a stop whose id is already taken in the file gets an id of its own, and the import says so", dup.stops.length === 3 && new Set(dup.stops.map((s) => s.id)).size === 3 && dup.stops[0].id === "same" && dup.stops[1].id !== "same" && dup.warnings.some((w) => /id/.test(w) && /Beta/.test(w)), dup.warnings.join(" | "));
  check("a stop with no id gets one of its own", dup.stops[2].id && dup.stops[2].id !== "same");
  const hostile = read([["stops.csv", "Name,Id,X,Y\nOdd,__proto__,100,100\nLong," + "x".repeat(500) + ",200,200\nTab,\"a\tb\",300,300\nFormula,=cmd,400,400\n"]]);
  check("an id such as __proto__ is only an id", hostile.stops[0].id === "__proto__" && ({}).polluted === undefined);
  check("an id that is far too long, or has a control character, is not used", hostile.stops[1].id.length <= 100 && !/[\u0000-\u001f]/.test(hostile.stops[2].id), `${hostile.stops[1].id.length} characters`);
  check("an id that starts like a formula survives a round trip through our own export", (() => { const m = clone(initialMap); m.stops[0].id = "=cmd"; m.routes.forEach((r) => { if (r.a === initialMap.stops[0].id) r.a = "=cmd"; if (r.b === initialMap.stops[0].id) r.b = "=cmd"; }); m.tickets.forEach((t) => { if (t.a === initialMap.stops[0].id) t.a = "=cmd"; if (t.b === initialMap.stops[0].id) t.b = "=cmd"; }); const r = read([["stops.csv", exp.stopsCsv(m)], ["routes.csv", exp.routesCsv(m)]], m); return r.stops[0].id === "=cmd" && r.routes.every((x) => r.stops.some((s) => s.id === x.a) && r.stops.some((s) => s.id === x.b)); })());
  const generated = read([["stops.csv", "Name,Id,X,Y\nAlpha,,100,100\nBeta,s-1-1,300,300\n"]]);
  check("an id made up by the import never collides with one the file gave", new Set(generated.stops.map((s) => s.id)).size === 2);
}

// ---------------------------------------------------------------- tickets alone, into the open map
{
  const m = clone(initialMap);
  const [a, b, c] = m.stops;
  const rows = `Deck,From,To,Points,From id,To id\nNew,${a.name},${b.name},5,${a.id},${b.id}\nNew,Elsewhere,${b.name},5,${c.id},${b.id}\nNew,${a.name},${c.name},5,,\nNew,Nowhere,${c.name},5,ghost,${c.id}\n`;
  const r = read([["tickets.csv", rows]], m);
  check("tickets on their own are matched to the open map by id when there is one", r.tickets.some((t) => t.a === a.id && t.b === b.id), JSON.stringify(r.tickets.map((t) => [t.a, t.b])));
  check("an id that disagrees with its name wins here too, and is said", r.tickets.some((t) => t.a === c.id && t.b === b.id) && r.warnings.some((w) => /Elsewhere/.test(w) && new RegExp(c.name).test(w)), r.warnings.join(" | "));
  check("a row with no ids is matched by name, as before", r.tickets.some((t) => t.a === a.id && t.b === c.id));
  check("four rows, none lost but the one that names nothing the map has", r.tickets.length === 3 && r.dropped === 1, `${r.tickets.length} read, ${r.dropped} left out`);
}

// ---------------------------------------------------------------- files from before: no ids at all
{
  const old = read([["stops.csv", "Name,Type,Routes,Neighbours,Tickets,X,Y\nAlpha,Regular,1,1,0,100,100\nBeta,Regular,1,1,0,300,300\n"], ["routes.csv", "From,To,Length,Colour,Type,Wagon style,Locomotives,Double route\nAlpha,Beta,3,Red,Railway,,0,\n"], ["tickets.csv", "Deck,From,To,Points,Shortest path,Length,Long deck\nMain,Alpha,Beta,3,3,short,\n"]]);
  check("a file from before ids reads as it did: stops, route and ticket, by name", old.stops.length === 2 && old.routes.length === 1 && old.tickets.length === 1 && old.warnings.length === 0, old.warnings.join(" | "));
  check("and its stops get ids of their own", old.stops.every((s) => /^s-/.test(s.id)));
}

// ---------------------------------------------------------------- the build that was released before ids (0.4.1)
// Real files, both ways: what 0.4.1 exports must read here as it did, and what is exported here must still
// read in 0.4.1 (its import reads by header, so the new columns are passed over).
{
  const old = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-csv-ids-old-"));
  let built = false;
  try {
    execFileSync("sh", ["-c", `git archive 18b5763 app | tar -x -C ${old}`], { cwd: root, stdio: "pipe" });
    execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/csv-import.ts", "app/csv-export.ts", "app/map-data.ts", "app/map-storage.ts", "--outDir", path.join(old, "out"), "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: old, stdio: "pipe" });
    built = true;
  } catch { console.log("The 0.4.1 build is not at hand (git archive 18b5763): the checks against it are skipped."); }
  if (built) {
    const oldExp = require(path.join(old, "out", "csv-export.js"));
    const oldImp = require(path.join(old, "out", "csv-import.js"));
    const oldData = require(path.join(old, "out", "map-data.js")).initialMap;
    const header = (text) => imp.parseCsv(text)[0];
    check("an export of 0.4.1 has no id columns, which is the case this build must still read", !header(oldExp.stopsCsv(oldData)).includes("Id") && !header(oldExp.routesCsv(oldData)).includes("From id"));
    const files = [["stops.csv", oldExp.stopsCsv(oldData)], ["routes.csv", oldExp.routesCsv(oldData)], ["tickets.csv", oldExp.ticketsCsv(oldData, oldData.ticketSets.map((s) => s.id))]];
    const here = read(files, initialMap);
    check("it reads here as it did: every stop, route and ticket, by name, with nothing warned", here.stops.length === oldData.stops.length && here.routes.length === oldData.routes.length && here.tickets.length === oldData.tickets.length && here.warnings.length === 0, `${here.stops.length}/${oldData.stops.length} stops, ${here.routes.length}/${oldData.routes.length} routes, ${here.tickets.length}/${oldData.tickets.length} tickets, ${here.warnings.join(" | ")}`);
    // And the other way: what this build exports, read by 0.4.1's own importer.
    const mine = [["stops.csv", exp.stopsCsv(initialMap)], ["routes.csv", exp.routesCsv(initialMap)], ["tickets.csv", exp.ticketsCsv(initialMap, initialMap.ticketSets.map((s) => s.id))]];
    const there = oldImp.readCsvImport(mine.map(([name, text]) => ({ name, text })), JSON.parse(JSON.stringify(oldData)));
    check("and what this build exports still reads in 0.4.1: the same stops, routes and tickets", there.stops.length === initialMap.stops.length && there.routes.length === initialMap.routes.length && there.tickets.length === initialMap.tickets.length, `${there.stops.length}/${initialMap.stops.length} stops, ${there.routes.length}/${initialMap.routes.length} routes, ${there.tickets.length}/${initialMap.tickets.length} tickets, ${there.warnings.join(" | ")}`);
  }
  fs.rmSync(old, { recursive: true, force: true });
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
