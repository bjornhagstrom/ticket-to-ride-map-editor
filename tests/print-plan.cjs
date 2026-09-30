// How a board is cut into printed sheets. Written before app/print-plan.ts existed.
//
//   npm run test:print-plan
//
// The board's shape is a property of the map; how it is printed is a choice made per run. These
// checks pin down what each choice produces: how many sheets, which way up, at what scale. The
// figures are worked out by hand from the paper sizes, a 10 mm printer margin on every side and an
// 8 mm caption line, so a change to any of those shows up here as a changed count.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-print-plan-"));
execFileSync("npx", ["tsc", "app/print-plan.ts", "app/map-data.ts",
  "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"],
  { cwd: root, stdio: "inherit" });
const { printPlan, printChoices, papers, splits } = require(path.join(out, "print-plan.js"));
const { mapFormats } = require(path.join(out, "map-data.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const pct = (plan) => Math.round(plan.scale * 100);

// ---------------------------------------------------------------- the board is only its shape
check("a map is one of two board shapes", JSON.stringify(Object.keys(mapFormats).sort()) === JSON.stringify(["board-2x3", "board-2x4"]), Object.keys(mapFormats).join(", "));
check("the standard board is 790 × 525 mm in 3 × 2 panels", mapFormats["board-2x3"].widthMm === 790 && mapFormats["board-2x3"].heightMm === 525 && mapFormats["board-2x3"].columns === 3 && mapFormats["board-2x3"].rows === 2);
check("the extended board is 1053 × 526 mm in 4 × 2 panels", mapFormats["board-2x4"].widthMm === 1053 && mapFormats["board-2x4"].heightMm === 526 && mapFormats["board-2x4"].columns === 4 && mapFormats["board-2x4"].rows === 2);

// ---------------------------------------------------------------- the choices a print run offers
check("three ways to split", JSON.stringify(splits.map((s) => s.id)) === JSON.stringify(["sheet", "panel", "full"]), splits.map((s) => s.id).join(", "));
check("four papers", JSON.stringify(papers.map((p) => p.id)) === JSON.stringify(["a4", "a3", "letter", "tabloid"]), papers.map((p) => p.id).join(", "));
const tabloid = papers.find((p) => p.id === "tabloid");
check("Tabloid is 11 × 17 in", tabloid.widthMm === 279.4 && tabloid.heightMm === 431.8, `${tabloid.widthMm} × ${tabloid.heightMm}`);
check("the standard board can print at Anniversary size", printChoices("board-2x3").sizes.map((s) => s.id).join() === "standard,anniversary", printChoices("board-2x3").sizes.map((s) => s.id).join());
check("the extended board has no Anniversary size", printChoices("board-2x4").sizes.map((s) => s.id).join() === "standard", printChoices("board-2x4").sizes.map((s) => s.id).join());

// ---------------------------------------------------------------- one sheet
const sheetA4 = printPlan("board-2x3", { split: "sheet", paper: "a4" });
check("one sheet is one page", sheetA4.pages.length === 1, String(sheetA4.pages.length));
check("a 2×3 board on one A4 lies landscape", sheetA4.orientation === "landscape" && sheetA4.pageMm.width === 297 && sheetA4.pageMm.height === 210, `${sheetA4.orientation} ${sheetA4.pageMm.width} × ${sheetA4.pageMm.height}`);
check("at 35 % on A4", pct(sheetA4) === 35, `${pct(sheetA4)} %`);
check("at 51 % on A3", pct(printPlan("board-2x3", { split: "sheet", paper: "a3" })) === 51, `${pct(printPlan("board-2x3", { split: "sheet", paper: "a3" }))} %`);
const sheetTabloid = printPlan("board-2x3", { split: "sheet", paper: "tabloid" });
check("Tabloid is declared landscape in millimetres", sheetTabloid.pageMm.width === 431.8 && sheetTabloid.pageMm.height === 279.4, `${sheetTabloid.pageMm.width} × ${sheetTabloid.pageMm.height}`);

// ---------------------------------------------------------------- one sheet per panel
for (const paper of ["a4", "a3", "letter", "tabloid"]) {
  check(`2×3 per panel on ${paper} is 6 pages`, printPlan("board-2x3", { split: "panel", paper }).pages.length === 6);
  check(`2×4 per panel on ${paper} is 8 pages`, printPlan("board-2x4", { split: "panel", paper }).pages.length === 8);
}
check("a 2×3 panel on A4 prints at 72 %", pct(printPlan("board-2x3", { split: "panel", paper: "a4" })) === 72, `${pct(printPlan("board-2x3", { split: "panel", paper: "a4" }))} %`);
check("a panel is never enlarged: A3 holds one at 100 %", pct(printPlan("board-2x3", { split: "panel", paper: "a3" })) === 100, `${pct(printPlan("board-2x3", { split: "panel", paper: "a3" }))} %`);

// ---------------------------------------------------------------- full size
const full = (format, paper, size = "standard") => printPlan(format, { split: "full", paper, size });
check("full size is always 100 %", ["a4", "a3", "letter", "tabloid"].every((paper) => pct(full("board-2x3", paper)) === 100));
check("a standard board is 9 sheets of A4", full("board-2x3", "a4").pages.length === 9, String(full("board-2x3", "a4").pages.length));
check("but 12 of US Letter, which is shorter", full("board-2x3", "letter").pages.length === 12, String(full("board-2x3", "letter").pages.length));
check("4 of A3", full("board-2x3", "a3").pages.length === 4, String(full("board-2x3", "a3").pages.length));
check("6 of Tabloid", full("board-2x3", "tabloid").pages.length === 6, String(full("board-2x3", "tabloid").pages.length));
check("an Anniversary board is 16 sheets of A4", full("board-2x3", "a4", "anniversary").pages.length === 16, String(full("board-2x3", "a4", "anniversary").pages.length));
check("and adds up to 972 × 648 mm", full("board-2x3", "a4", "anniversary").boardMm.width === 972 && full("board-2x3", "a4", "anniversary").boardMm.height === 648);
check("an extended board is 12 sheets of A4", full("board-2x4", "a4").pages.length === 12, String(full("board-2x4", "a4").pages.length));
check("asking a 2×4 for Anniversary gives its standard size", full("board-2x4", "a4", "anniversary").boardMm.width === 1053);

// Every tile fits inside what the printer can reach, and together the tiles cover the board once.
for (const [format, paper, size] of [["board-2x3", "a4"], ["board-2x3", "letter"], ["board-2x3", "a4", "anniversary"], ["board-2x4", "tabloid"]]) {
  const plan = full(format, paper, size);
  const area = plan.pages.reduce((sum, page) => sum + page.tile.width * page.tile.height, 0);
  const fits = plan.pages.every((page) => page.contentMm.width <= plan.pageMm.width - 20 + 1e-6 && page.contentMm.height <= plan.pageMm.height - 28 + 1e-6);
  check(`${format} on ${paper}${size ? " " + size : ""}: every tile fits the printable area`, fits);
  check(`${format} on ${paper}${size ? " " + size : ""}: the tiles cover the board exactly once`, Math.abs(area - 1) < 1e-9, String(area));
}

// ---------------------------------------------------------------- the comparison table is the plan
const table = printChoices("board-2x3").table;
check("the table has a row per paper", table.length === 4, String(table.length));
check("and a column per way to print, Anniversary included on 2×3", table.every((row) => row.cells.length === 4));
check("the extended board's table has no Anniversary column", printChoices("board-2x4").table.every((row) => row.cells.length === 3));
check("every cell says what printPlan says", printChoices("board-2x3").table.every((row) => row.cells.every((cell) => cell.pages === printPlan("board-2x3", cell.choice).pages.length && cell.scale === printPlan("board-2x3", cell.choice).scale)));

console.log(ok.map((line) => `  ✓ ${line}`).join("\n"));
if (bad.length) console.log(bad.map((line) => `  ✗ ${line}`).join("\n"));
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
