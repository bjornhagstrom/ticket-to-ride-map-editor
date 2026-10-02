// What a spreadsheet export must hold. Written before the export was built.
//
//   npm run test:csv
//
// A CSV file is for reading the map in a spreadsheet, or in someone else's tool: the tickets, the
// routes, the stops, and the shortest distance between every two stops. It is never read back by the
// editor, so the JSON files stay the only way to move a map. The rules: one header row, then one
// row per thing; RFC 4180 quoting; a BOM so a spreadsheet reads å, ä and ö right; names, not ids.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-csv-"));
execFileSync("npx", ["tsc", "app/csv-export.ts", "app/map-data.ts",
  "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"],
  { cwd: root, stdio: "inherit" });
const csv = require(path.join(out, "csv-export.js"));
const { initialMap } = require(path.join(out, "map-data.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };

// A small reader, strict about the parts we promise: quotes, doubled quotes, commas and line breaks
// inside quotes, CRLF between rows.
function parse(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const table = (text) => { const [header, ...rows] = parse(text.replace(/^﻿/, "")); return { header, rows, col: (name) => header.indexOf(name) }; };

// ---------------------------------------------------------------- the format
{
  const text = csv.toCsv([["Name", "Note"], ["Plain", 3], ["Comma, here", 'Say "hi"'], ["Line\nbreak", ""]]);
  check("a file starts with a BOM, so a spreadsheet reads å, ä and ö", text.startsWith("﻿"));
  check("rows end in CRLF, the last one too", text.endsWith("\r\n") && text.split("\r\n").length === 5, JSON.stringify(text));
  check("a cell with a comma, a quote or a line break is quoted, quotes doubled", text.includes('"Comma, here","Say ""hi"""') && text.includes('"Line\nbreak"'), JSON.stringify(text));
  check("a plain cell is not quoted, and a number is written as it is", text.includes("\r\nPlain,3\r\n"));
  const back = parse(text.slice(1));
  check("and it reads back cell for cell", JSON.stringify(back) === JSON.stringify([["Name", "Note"], ["Plain", "3"], ["Comma, here", 'Say "hi"'], ["Line\nbreak", ""]]), JSON.stringify(back));
  const risky = csv.toCsv([["=SUM(A1)", "+1", "-x", "@me", -4, "Malmö"]]);
  check("text that a spreadsheet would run as a formula is defused with a leading apostrophe", risky.includes("'=SUM(A1),'+1,'-x,'@me,-4,Malmö"), JSON.stringify(risky));
}

// ---------------------------------------------------------------- a map built for the test
// Four stops in a line and a junction: A -2- B -3- J -1- C, a double route A–B, and a lonely D.
const map = {
  ...JSON.parse(JSON.stringify(initialMap)),
  name: "Test, map",
  stops: [
    { id: "a", name: "Älmhult", type: "city", x: 100, y: 100 },
    { id: "b", name: "Bro, södra", type: "city", x: 200, y: 100 },
    { id: "j", name: "Junction 1", type: "junction", x: 300, y: 100 },
    { id: "c", name: "Cirkus", type: "city", x: 400, y: 100 },
    { id: "d", name: "Dal", type: "city", x: 500, y: 300 },
  ],
  routes: [
    { id: "r1", a: "a", b: "b", length: 2, type: "city", color: "red" },
    { id: "r2", a: "a", b: "b", length: 2, type: "city", color: "blue", locomotiveSlots: [0] },
    { id: "r3", a: "b", b: "j", length: 3, type: "city", color: "neutral" },
    { id: "r4", a: "j", b: "c", length: 1, type: "city", color: "green" },
  ],
  ticketSets: [{ id: "main", label: "Main deck" }, { id: "alt", label: "Second, try" }],
  tickets: [
    { id: "t1", a: "a", b: "c", points: 6 },
    { id: "t2", a: "b", b: "c", points: 4, set: "alt", long: true },
    { id: "t3", a: "a", b: "d", points: 9, set: "alt" },
  ],
};

// ---------------------------------------------------------------- tickets
{
  const all = table(csv.ticketsCsv(map, ["main", "alt"]));
  check("the ticket file has the columns a person needs", ["Deck", "From", "To", "Points", "Shortest path", "Length", "Long deck"].every((name) => all.header.includes(name)), all.header.join(" | "));
  check("one row per ticket, across the decks asked for", all.rows.length === 3, String(all.rows.length));
  const row = (from, to) => all.rows.find((r) => r[all.col("From")] === from && r[all.col("To")] === to);
  const t1 = row("Älmhult", "Cirkus");
  check("a ticket names its stops and its deck, not their ids", Boolean(t1) && t1[all.col("Deck")] === "Main deck", JSON.stringify(all.rows));
  check("its points, and the shortest path in wagon spaces through the junction", t1 && t1[all.col("Points")] === "6" && t1[all.col("Shortest path")] === "6", JSON.stringify(t1));
  const t2 = row("Bro, södra", "Cirkus");
  check("a ticket from the long deck says so", t2 && t2[all.col("Long deck")] === "yes" && t1[all.col("Long deck")] === "", JSON.stringify(t2));
  check("a name with a comma survives as one cell", t2 && t2.length === all.header.length);
  const t3 = row("Älmhult", "Dal");
  check("a ticket nobody can complete has an empty shortest path, and no length", t3 && t3[all.col("Shortest path")] === "" && t3[all.col("Length")] === "", JSON.stringify(t3));
  check("the length is one of short, medium and long", all.rows.filter((r) => r[all.col("Shortest path")] !== "").every((r) => ["short", "medium", "long"].includes(r[all.col("Length")])), all.rows.map((r) => r[all.col("Length")]).join(","));
  const one = table(csv.ticketsCsv(map, ["alt"]));
  check("asked for one deck, it holds that deck only", one.rows.length === 2 && one.rows.every((r) => r[one.col("Deck")] === "Second, try"), JSON.stringify(one.rows));
}

// ---------------------------------------------------------------- routes
{
  const routes = table(csv.routesCsv(map));
  check("the route file has a row per route, both lines of a double route included", routes.rows.length === 4, String(routes.rows.length));
  check("and the columns a person needs", ["From", "To", "Length", "Colour", "Type", "Locomotives", "Double route"].every((name) => routes.header.includes(name)), routes.header.join(" | "));
  const red = routes.rows.find((r) => r[routes.col("Colour")] === "Red");
  check("a route names its stops, its colour by name, its length", red && red[routes.col("From")] === "Älmhult" && red[routes.col("To")] === "Bro, södra" && red[routes.col("Length")] === "2", JSON.stringify(red));
  const blue = routes.rows.find((r) => r[routes.col("Colour")] === "Blue");
  check("locomotive spaces are counted", blue && blue[routes.col("Locomotives")] === "1" && red[routes.col("Locomotives")] === "0", JSON.stringify(blue));
  check("both lines of the double route say they are one", red[routes.col("Double route")] === "yes" && blue[routes.col("Double route")] === "yes" && routes.rows.filter((r) => r[routes.col("Double route")] === "yes").length === 2);
  check("the type is the route type's name, not its id", routes.rows.every((r) => r[routes.col("Type")] === "Railway"), routes.rows.map((r) => r[routes.col("Type")]).join(","));
}

// ---------------------------------------------------------------- stops
{
  const stops = table(csv.stopsCsv(map));
  check("the stop file has a row per stop, junctions included", stops.rows.length === 5, String(stops.rows.length));
  check("and the columns a person needs", ["Name", "Type", "Routes", "Neighbours", "Tickets", "X", "Y"].every((name) => stops.header.includes(name)), stops.header.join(" | "));
  const b = stops.rows.find((r) => r[stops.col("Name")] === "Bro, södra");
  check("a stop counts its routes, each line of a double route on its own, and its neighbours once", b && b[stops.col("Routes")] === "3" && b[stops.col("Neighbours")] === "2", JSON.stringify(b));
  check("and the tickets in every deck that name it", b && b[stops.col("Tickets")] === "1", JSON.stringify(b));
  const j = stops.rows.find((r) => r[stops.col("Name")] === "Junction 1");
  check("the type is the stop type's name, so a junction reads as one", j && j[stops.col("Type")] === "Junction" && b[stops.col("Type")] === "Regular", JSON.stringify(j));
}

// ---------------------------------------------------------------- distances
{
  const d = parse(csv.distancesCsv(map).slice(1));
  const names = d[0].slice(1);
  check("the distance table has a stop in each row and column, with no junction", JSON.stringify(names) === JSON.stringify(["Älmhult", "Bro, södra", "Cirkus", "Dal"]) && d.length === 5, JSON.stringify(d[0]));
  check("rows and columns are in the same order", d.slice(1).map((r) => r[0]).join("|") === names.join("|"));
  const at = (x, y) => d[1 + names.indexOf(x)][1 + names.indexOf(y)];
  check("a cell is the shortest path in wagon spaces, through junctions", at("Älmhult", "Cirkus") === "6" && at("Bro, södra", "Cirkus") === "4", `${at("Älmhult", "Cirkus")} ${at("Bro, södra", "Cirkus")}`);
  check("the table is symmetric, with 0 on the diagonal", names.every((x) => at(x, x) === "0" && names.every((y) => at(x, y) === at(y, x))));
  check("a pair that cannot be joined is left empty", at("Älmhult", "Dal") === "");
}

// ---------------------------------------------------------------- the example map
{
  const example = initialMap;
  const tickets = table(csv.ticketsCsv(example, example.ticketSets.map((s) => s.id)));
  check("the example map's tickets all come out", tickets.rows.length === example.tickets.length, `${tickets.rows.length} of ${example.tickets.length}`);
  check("every example ticket can be completed", tickets.rows.every((r) => r[tickets.col("Shortest path")] !== ""));
  check("its routes all come out", table(csv.routesCsv(example)).rows.length === example.routes.length);
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
