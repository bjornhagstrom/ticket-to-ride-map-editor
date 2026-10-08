// How a board is cut into printed sheets. Written before app/print-plan.ts existed.
//
//   npm run test:print-plan
//
// The board's shape is a property of the map; how it is printed is a choice made per run. These
// checks pin down what each choice produces: how many sheets, which way up, at what scale. The
// figures are worked out by hand from the paper sizes, a 10 mm printer margin on every side and an
// 8 mm caption line, so a change to any of those shows up here as a changed count. The working is
// written out in docs/PRINTING.md.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-print-plan-"));
execFileSync("npx", ["tsc", "app/print-plan.ts", "app/map-data.ts",
  "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"],
  { cwd: root, stdio: "inherit" });
const { printPlan, printChoices, printChoiceFor, papers, splits, cardSize } = require(path.join(out, "print-plan.js"));
const { mapFormats } = require(path.join(out, "map-data.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const pct = (plan) => Math.round(plan.scale * 100);

// ---------------------------------------------------------------- the board is only its shape
check("the two boards the editor began with keep their names and sizes (other boards are in tests/custom-board.cjs)", JSON.stringify(Object.keys(mapFormats).sort()) === JSON.stringify(["board-2x3", "board-2x4"]), Object.keys(mapFormats).join(", "));
check("the standard board is 790 × 525 mm in 3 × 2 panels", mapFormats["board-2x3"].widthMm === 790 && mapFormats["board-2x3"].heightMm === 525 && mapFormats["board-2x3"].columns === 3 && mapFormats["board-2x3"].rows === 2);
check("the extended board is 1053 × 526 mm in 4 × 2 panels", mapFormats["board-2x4"].widthMm === 1053 && mapFormats["board-2x4"].heightMm === 526 && mapFormats["board-2x4"].columns === 4 && mapFormats["board-2x4"].rows === 2);

// ---------------------------------------------------------------- the choices a print run offers
check("four ways to split: one sheet, per panel, full size, and one page the size of the board", JSON.stringify(splits.map((s) => s.id)) === JSON.stringify(["sheet", "panel", "full", "page"]), splits.map((s) => s.id).join(", "));
check("four papers", JSON.stringify(papers.map((p) => p.id)) === JSON.stringify(["a4", "a3", "letter", "tabloid"]), papers.map((p) => p.id).join(", "));
const tabloid = papers.find((p) => p.id === "tabloid");
check("Tabloid is 11 × 17 in", tabloid.widthMm === 279.4 && tabloid.heightMm === 431.8, `${tabloid.widthMm} × ${tabloid.heightMm}`);
check("the standard board can print at Anniversary size", printChoices("board-2x3").sizes.map((s) => s.id).join() === "standard,anniversary", printChoices("board-2x3").sizes.map((s) => s.id).join());
check("the extended board has no Anniversary size", printChoices("board-2x4").sizes.map((s) => s.id).join() === "standard", printChoices("board-2x4").sizes.map((s) => s.id).join());

// ---------------------------------------------------------------- one sheet
const sheetA4 = printPlan("board-2x3", { split: "sheet", paper: "a4" });
check("one sheet is one page", sheetA4.pages.length === 1, String(sheetA4.pages.length));
check("a 2×3 board on one A4 is an upright page with the map turned on it", sheetA4.orientation === "portrait" && sheetA4.pageMm.width === 210 && sheetA4.pageMm.height === 297, `${sheetA4.orientation} ${sheetA4.pageMm.width} × ${sheetA4.pageMm.height}`);
check("at 35 % on A4", pct(sheetA4) === 35, `${pct(sheetA4)} %`);
check("at 51 % on A3", pct(printPlan("board-2x3", { split: "sheet", paper: "a3" })) === 51, `${pct(printPlan("board-2x3", { split: "sheet", paper: "a3" }))} %`);
const sheetTabloid = printPlan("board-2x3", { split: "sheet", paper: "tabloid" });
check("Tabloid is declared upright in millimetres", sheetTabloid.pageMm.width === 279.4 && sheetTabloid.pageMm.height === 431.8, `${sheetTabloid.pageMm.width} × ${sheetTabloid.pageMm.height}`);

// ---------------------------------------------------------------- one sheet per panel
for (const paper of ["a4", "a3", "letter", "tabloid"]) {
  check(`2×3 per panel on ${paper} is 6 pages`, printPlan("board-2x3", { split: "panel", paper }).pages.length === 6);
  check(`2×4 per panel on ${paper} is 8 pages`, printPlan("board-2x4", { split: "panel", paper }).pages.length === 8);
}
check("a 2×3 panel on landscape A4 prints at 69 %", pct(printPlan("board-2x3", { split: "panel", paper: "a4" })) === 69, `${pct(printPlan("board-2x3", { split: "panel", paper: "a4" }))} %`);
check("a panel is never enlarged: A3 holds one at 100 %", pct(printPlan("board-2x3", { split: "panel", paper: "a3" })) === 100, `${pct(printPlan("board-2x3", { split: "panel", paper: "a3" }))} %`);

// ---------------------------------------------------------------- always landscape
// Every run prints landscape, so the answer to "which way up" in the browser's own print dialog is
// always the same. Safari does not always switch by itself. Portrait saved a sheet or a few percent
// in some cases; the counts below are the landscape ones.
const everyPlan = [];
for (const format of ["board-2x3", "board-2x4"]) for (const paper of ["a4", "a3", "letter", "tabloid"]) for (const choice of [{ split: "sheet" }, { split: "panel" }, { split: "full" }, { split: "full", size: "anniversary" }]) everyPlan.push(printPlan(format, { ...choice, paper }));
check("every sheet is laid out landscape", everyPlan.every((plan) => plan.pages.every((p) => p.contentMm.width >= p.contentMm.height - 1)), "");
check("and every page is declared upright, the map turned on it", everyPlan.every((plan) => plan.orientation === "portrait" && plan.pageMm.height > plan.pageMm.width), everyPlan.filter((plan) => plan.orientation !== "portrait").map((plan) => `${plan.choice.split} ${plan.choice.paper}`).join(", "));
check("Anniversary on landscape A3 is 9 sheets", printPlan("board-2x3", { split: "full", paper: "a3", size: "anniversary" }).pages.length === 9, String(printPlan("board-2x3", { split: "full", paper: "a3", size: "anniversary" }).pages.length));
check("Anniversary on landscape Letter is 16 sheets", printPlan("board-2x3", { split: "full", paper: "letter", size: "anniversary" }).pages.length === 16, String(printPlan("board-2x3", { split: "full", paper: "letter", size: "anniversary" }).pages.length));

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
  // The sheet is turned on the page: its width runs down the page's height.
  const fits = plan.pages.every((page) => page.contentMm.width <= plan.pageMm.height - 20 + 1e-6 && page.contentMm.height <= plan.pageMm.width - 28 + 1e-6);
  check(`${format} on ${paper}${size ? " " + size : ""}: every tile fits the printable area`, fits);
  check(`${format} on ${paper}${size ? " " + size : ""}: the tiles cover the board exactly once`, Math.abs(area - 1) < 1e-9, String(area));
}

// ---------------------------------------------------------------- cut marks count against the page
// Full-size sheets carry cut marks reaching past the artwork. Safari fitted a 274 mm sheet with its
// headers and footers on, but spilled a 263 mm sheet whose 6 mm marks made it 275. So the marks are
// part of the budget: artwork and marks together fit the paper less its margins.
const { CUT_MARK_REACH_MM, DEFAULT_PRINT_CHOICE } = require(path.join(out, "print-plan.js"));
// The first print, before anything is chosen: the whole board on one A4 sheet, the quickest playtest.
check("by default the whole board prints on one sheet of A4", DEFAULT_PRINT_CHOICE.split === "sheet" && DEFAULT_PRINT_CHOICE.paper === "a4" && DEFAULT_PRINT_CHOICE.size === "standard", JSON.stringify(DEFAULT_PRINT_CHOICE));
check("cut marks reach no more than 2.5 mm past the artwork", CUT_MARK_REACH_MM > 0 && CUT_MARK_REACH_MM <= 2.5, String(CUT_MARK_REACH_MM));
for (const format of ["board-2x3", "board-2x4"]) for (const paperId of ["a4", "a3", "letter", "tabloid"]) for (const size of format === "board-2x3" ? ["standard", "anniversary"] : ["standard"]) {
  const plan = printPlan(format, { split: "full", paper: paperId, size });
  const long = plan.pageMm.height - 20, short = plan.pageMm.width - 20;
  const fits = plan.pages.every((page) => page.contentMm.width + 2 * CUT_MARK_REACH_MM <= long + 1e-6 && 8 + page.contentMm.height + CUT_MARK_REACH_MM <= short + 1e-6);
  check(`${format} full size on ${paperId}${size === "anniversary" ? " at Anniversary size" : ""}: artwork and cut marks fit the page`, fits);
}
check("and no sheet count changes for it", [["board-2x3", "a3", "standard", 4], ["board-2x3", "a4", "standard", 9], ["board-2x3", "letter", "standard", 12], ["board-2x3", "a4", "anniversary", 16], ["board-2x4", "a3", "standard", 6]]
  .every(([format, paper, size, count]) => printPlan(format, { split: "full", paper, size }).pages.length === count));

// ---------------------------------------------------------------- Safari
// Safari's first print layout has about 264 mm down an upright A4 page: a 274 mm sheet spilled about
// 10 mm onto a second page, a 268 mm one spilled too, and every later layout fitted. Nobody knows why,
// so in Safari the sheet's length is capped at 255 mm on A4, a 21 mm clear margin at each end of the
// long side instead of 10.
const { PRINT_PROFILES } = require(path.join(out, "print-plan.js"));
const safari = (format, choice) => printPlan(format, choice, PRINT_PROFILES.safari);
const count = (plan) => plan.pages.length;
check("Safari: full size on A4 is 12 sheets", count(safari("board-2x3", { split: "full", paper: "a4" })) === 12, String(count(safari("board-2x3", { split: "full", paper: "a4" }))));
check("Safari: on A3 6, on Letter 12, on Tabloid 9", count(safari("board-2x3", { split: "full", paper: "a3" })) === 6 && count(safari("board-2x3", { split: "full", paper: "letter" })) === 12 && count(safari("board-2x3", { split: "full", paper: "tabloid" })) === 9,
  ["a3", "letter", "tabloid"].map((paper) => count(safari("board-2x3", { split: "full", paper }))).join("/"));
check("Safari: Anniversary on A4 16, on Letter 20", count(safari("board-2x3", { split: "full", paper: "a4", size: "anniversary" })) === 16 && count(safari("board-2x3", { split: "full", paper: "letter", size: "anniversary" })) === 20);
check("Safari: a 2×4 at full size on A4 is 15", count(safari("board-2x4", { split: "full", paper: "a4" })) === 15);
check("Safari: one sheet of A4 is 32 %", pct(safari("board-2x3", { split: "sheet", paper: "a4" })) === 32, `${pct(safari("board-2x3", { split: "sheet", paper: "a4" }))} %`);
check("Safari: a panel on A4 is still 69 %", pct(safari("board-2x3", { split: "panel", paper: "a4" })) === 69);
const safariReach = [];
for (const format of ["board-2x3", "board-2x4"]) for (const split of ["sheet", "panel", "full"]) {
  const plan = safari(format, { split, paper: "a4" });
  for (const p of plan.pages) safariReach.push(p.contentMm.width + (split === "full" ? 2 * CUT_MARK_REACH_MM : 0));
}
check("Safari: no A4 sheet reaches more than 255 mm down the page, cut marks included", Math.max(...safariReach) <= 255 + 1e-6, `${Math.max(...safariReach).toFixed(1)} mm`);
check("and without the Safari profile nothing changes", count(printPlan("board-2x3", { split: "full", paper: "a4" })) === 9 && pct(printPlan("board-2x3", { split: "sheet", paper: "a4" })) === 35);

// ---------------------------------------------------------------- the comparison table is the plan
const table = printChoices("board-2x3").table;
check("the table has a row per paper", table.length === 4, String(table.length));
check("and a column per way to print, Anniversary included on 2×3", table.every((row) => row.cells.length === 4));
check("the extended board's table has no Anniversary column", printChoices("board-2x4").table.every((row) => row.cells.length === 3));
check("every cell says what printPlan says", printChoices("board-2x3").table.every((row) => row.cells.every((cell) => cell.pages === printPlan("board-2x3", cell.choice).pages.length && cell.scale === printPlan("board-2x3", cell.choice).scale)));

// ---------------------------------------------------------------- the whole board on one page
{
  const page = printPlan("board-2x3", { split: "page", paper: "a4" });
  check("one page: a single page at real size", page.pages.length === 1 && page.scale === 1 && page.columns === 1 && page.rows === 1, JSON.stringify([page.pages.length, page.scale]));
  check("the board on it is the real 790 × 525 mm", page.boardMm.width === 790 && page.boardMm.height === 525 && page.pages[0].contentMm.width === 790 && page.pages[0].contentMm.height === 525, JSON.stringify(page.boardMm));
  check("the page is the board with the caption above it and the margin round it: 810 × 553 mm", page.pageMm.width === 810 && page.pageMm.height === 553, JSON.stringify(page.pageMm));
  check("it is not turned: the page is as wide as the board, because the paper is the board's own", page.turned === false);
  check("the paper chosen makes no difference to it", JSON.stringify(printPlan("board-2x3", { split: "page", paper: "tabloid" }).pageMm) === JSON.stringify(page.pageMm));
  const wide = printPlan("board-2x4", { split: "page", paper: "a4" });
  check("the extended board is 1053 × 526 mm, on a page of 1073 × 554 mm", wide.boardMm.width === 1053 && wide.pageMm.width === 1073 && wide.pageMm.height === 554, JSON.stringify([wide.boardMm, wide.pageMm]));
  check("Anniversary size is not offered on one page", printChoiceFor("board-2x3", { split: "page", paper: "a4", size: "anniversary" }).size === "standard");
  check("the other ways of splitting are turned, as before", ["sheet", "panel", "full"].every((split) => printPlan("board-2x3", { split, paper: "a4" }).turned === true));
  check("the table of sheets is unchanged: still one column per way a paper can be used", printChoices("board-2x3").columns.length === 4);
}

// ---------------------------------------------------------------- a standing board
// A board that stands is printed standing on the upright page, not turned: its sheet is the page's
// short side across and its long side, less the caption, down. Worked out the same way as above:
// A4 leaves 190 mm across and 297 − 20 − 8 = 269 mm down; full size takes 2.5 mm off each for the marks.
{
  const stand = (format, paper, split = "full", size = "standard", profile) => printPlan(format, { split, paper, size }, profile, "portrait");
  const panel = stand("board-2x3", "a4", "panel");
  check("a standing board is not turned on the page", !panel.turned && !stand("board-2x3", "a4", "sheet").turned && !stand("board-2x3", "a4").turned);
  check("its panels are 2 across and 3 down: six sheets", panel.columns === 2 && panel.rows === 3 && panel.pages.length === 6, `${panel.columns} × ${panel.rows}`);
  check("a panel of 262.5 × 263.3 mm on 190 × 269 mm prints at 72 %", pct(panel) === 72, `${pct(panel)} %`);
  check("the whole standing board on one A4 sheet prints at 34 %", pct(stand("board-2x3", "a4", "sheet")) === 34, `${pct(stand("board-2x3", "a4", "sheet"))} %`);
  const full = stand("board-2x3", "a4");
  check("at full size it is 3 × 3 = 9 sheets of A4, standing", full.pages.length === 9 && full.columns === 3 && full.rows === 3 && full.boardMm.width === 525 && full.boardMm.height === 790, `${full.columns} × ${full.rows}, ${JSON.stringify(full.boardMm)}`);
  check("an Anniversary standing board is 648 × 972 mm, 4 × 4 = 16 sheets", stand("board-2x3", "a4", "full", "anniversary").pages.length === 16 && stand("board-2x3", "a4", "full", "anniversary").boardMm.width === 648);
  check("a standing 2×4 board is 3 × 4 = 12 sheets of A4", stand("board-2x4", "a4").pages.length === 12, String(stand("board-2x4", "a4").pages.length));
  const page = stand("board-2x3", "a4", "page");
  check("one page the size of a standing board is 545 × 818 mm, standing", page.pageMm.width === 545 && page.pageMm.height === 818, JSON.stringify(page.pageMm));
  check("in Safari, with 21 mm kept at each end of the long side, the full-size standing board is 12 sheets", printPlan("board-2x3", { split: "full", paper: "a4" }, { id: "safari", longMarginMm: 21 }, "portrait").pages.length === 12);
  const table = printChoices("board-2x3", undefined, "portrait").table.find((row) => row.paper.id === "a4").cells;
  check("the sheet table counts the standing board's sheets", table.map((cell) => cell.pages).join(",") === "1,6,9,16", table.map((cell) => cell.pages).join(","));
  check("cards lie on a lying board and stand on a standing one", JSON.stringify(cardSize("board-2x3")) === JSON.stringify({ width: 62, height: 45 }) && JSON.stringify(cardSize("board-2x3", "portrait")) === JSON.stringify({ width: 45, height: 62 }));
}

console.log(ok.map((line) => `  ✓ ${line}`).join("\n"));
if (bad.length) console.log(bad.map((line) => `  ✗ ${line}`).join("\n"));
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
