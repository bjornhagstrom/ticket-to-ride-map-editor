// The version of the editor in the spreadsheet files (docs/CSV.md, "Editor version"). Written before the code. The stop,
// route and ticket files end in a column `Editor` with the version of the editor that wrote them, on every row, so a row
// that is sorted or copied elsewhere still carries it. A file from a newer editor than this one is said so when it is
// read; the table of distances (a matrix) and the templates (forms to fill in) carry none. An older build reads by
// header and passes over the column.
//
//   npm run test:csv-editor-version
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-csv-editor-version-"));
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/csv-import.ts", "app/csv-export.ts", "app/map-data.ts", "app/map-storage.ts", "app/version.ts",
  "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const imp = require(path.join(out, "csv-import.js"));
const exp = require(path.join(out, "csv-export.js"));
const { APP_VERSION } = require(path.join(out, "version.js"));
const { initialMap, emptyMap } = require(path.join(out, "map-data.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const table = (text) => { const rows = imp.parseCsv(text); return { header: rows[0], rows: rows.slice(1) }; };
const read = (files, data = emptyMap) => imp.readCsvImport(files.map(([name, text]) => ({ name, text })), clone(data));
const newer = /newer version of the editor/;

// ---------------------------------------------------------------- what the export writes
const sets = initialMap.ticketSets.map((s) => s.id);
const files = { "stops.csv": exp.stopsCsv(initialMap), "routes.csv": exp.routesCsv(initialMap), "tickets.csv": exp.ticketsCsv(initialMap, sets) };
for (const [name, text] of Object.entries(files)) {
  const t = table(text);
  check(`${name} ends in an Editor column`, t.header[t.header.length - 1] === "Editor", t.header.join(","));
  check(`and every row of ${name} says this build's version`, t.rows.length > 0 && t.rows.every((r) => r[r.length - 1] === APP_VERSION), `${t.rows.length} rows`);
}
check("the table of distances is a matrix and has no Editor column", !table(exp.distancesCsv(initialMap)).header.includes("Editor"));
check("the templates are forms to fill in and have none", !["stops", "routes", "tickets"].some((k) => exp.csvTemplate(k).includes("Editor")));

// ---------------------------------------------------------------- what the import does with it
const withVersion = (text, version) => { const rows = imp.parseCsv(text).map((r, i) => { const x = [...r]; if (i > 0) x[x.length - 1] = version; return x; }); return exp.toCsv(rows); };
const stops = files["stops.csv"], routes = files["routes.csv"], tickets = files["tickets.csv"];
const same = read([["stops.csv", stops], ["routes.csv", routes], ["tickets.csv", tickets]]);
check("files from this version say nothing about versions", !same.warnings.some((w) => newer.test(w)), same.warnings.join(" | "));
check("and read as before: every stop, route and ticket", same.stops.length === initialMap.stops.length && same.routes.length === initialMap.routes.length && same.tickets.length === initialMap.tickets.length);
const ahead = read([["stops.csv", withVersion(stops, "99.1.0")], ["routes.csv", routes], ["tickets.csv", tickets]]);
check("a stop file from a newer editor says so, with both versions, and is still read", ahead.warnings.some((w) => newer.test(w) && w.includes("99.1.0") && w.includes(APP_VERSION)) && ahead.stops.length === initialMap.stops.length, ahead.warnings.join(" | "));
const several = read([["stops.csv", withVersion(stops, "99.1.0")], ["routes.csv", withVersion(routes, "99.2.0")], ["tickets.csv", withVersion(tickets, "99.1.0")]]);
check("three files from newer editors give one note, not three", several.warnings.filter((w) => newer.test(w)).length === 1, several.warnings.join(" | "));
check("and it names the newest version", several.warnings.some((w) => w.includes("99.2.0")), several.warnings.join(" | "));
const older = read([["stops.csv", withVersion(stops, "0.4.1")], ["routes.csv", withVersion(routes, "")], ["tickets.csv", withVersion(tickets, "next")]]);
check("an older version, an empty cell and a cell that is no version say nothing", !older.warnings.some((w) => newer.test(w)), older.warnings.join(" | "));
const none = (text) => exp.toCsv(imp.parseCsv(text).map((r) => r.slice(0, -1)));
const before = read([["stops.csv", none(stops)], ["routes.csv", none(routes)], ["tickets.csv", none(tickets)]]);
check("files with no Editor column (every file before 1.3.0) read as before, saying nothing", !before.warnings.some((w) => newer.test(w)) && before.stops.length === initialMap.stops.length && before.routes.length === initialMap.routes.length, before.warnings.join(" | "));
const mixed = exp.toCsv(imp.parseCsv(stops).map((r, i) => { const x = [...r]; if (i === 3) x[x.length - 1] = "99.0.0"; return x; }));
check("one row from a newer editor in a file is enough: rows may have been pasted together", read([["stops.csv", mixed]]).warnings.some((w) => newer.test(w)));

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
