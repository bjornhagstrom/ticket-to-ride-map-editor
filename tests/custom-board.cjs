// Boards of any number of fold panels, from 1 to 6 along each side, never more rows than columns, and never one panel only (docs/FILE-FORMAT.md, "Boards of any number of panels").
// Written before the code. A board is named by its panels, rows then columns, as the two it had were: `board-2x3` is
// two rows of three and `board-3x4` three rows of four. Any other name is not a board and reads as the standard one,
// as before; the two it had keep their own sizes. A board is always wider than tall: one that is taller is the wide board standing,
// and standing is the map's orientation. That is how a board is told to lie or stand, so one panel alone (exactly square)
// is not a board. A panel is about 263 mm square, so the board's size, how it is cut
// into printed sheets and how a map moves to it follow from the panels.
//
//   npm run test:custom-board
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-custom-board-"));
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/map-data.ts", "app/map-storage.ts", "app/board.ts", "app/print-plan.ts",
  "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const data = require(path.join(out, "map-data.js"));
const storage = require(path.join(out, "map-storage.js"));
const { boardOf } = require(path.join(out, "board.js"));
const plan = require(path.join(out, "print-plan.js"));
const { initialMap, W } = data;

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const clone = (value) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------- what a name means
const f = (id) => data.formatOf(id);
check("the standard board is as it was: 790 × 525 mm, three panels across and two down", f("board-2x3") && f("board-2x3").widthMm === 790 && f("board-2x3").heightMm === 525 && f("board-2x3").columns === 3 && f("board-2x3").rows === 2);
check("the extended board is as it was: 1053 × 526 mm, four across and two down", f("board-2x4") && f("board-2x4").widthMm === 1053 && f("board-2x4").heightMm === 526 && f("board-2x4").columns === 4 && f("board-2x4").rows === 2);
check("the long side is always W map units, the other follows the shape", [f("board-2x3"), f("board-2x4"), f("board-3x3"), f("board-3x4"), f("board-1x6"), f("board-6x6")].every((d) => d && d.width === W && d.height === Math.round(W * d.heightMm / d.widthMm)));
check("a 3 × 3 board is about 790 × 788 mm", f("board-3x3") && f("board-3x3").widthMm === 790 && f("board-3x3").heightMm === 788 && f("board-3x3").columns === 3 && f("board-3x3").rows === 3, JSON.stringify(f("board-3x3")));
check("a 3 × 4 board (three rows of four) is about 1053 × 788 mm", f("board-3x4") && f("board-3x4").widthMm === 1053 && f("board-3x4").heightMm === 788 && f("board-3x4").columns === 4 && f("board-3x4").rows === 3, JSON.stringify(f("board-3x4")));
check("the smallest board is one row of two panels, and the largest six by six; one panel alone is square, so it is not a board", f("board-1x2") && f("board-1x2").rows === 1 && f("board-6x6") && f("board-6x6").rows === 6 && f("board-1x1") === null);
const all = []; for (let r = 1; r <= 6; r++) for (let c = r; c <= 6; c++) if (data.formatOf(data.formatId(r, c))) all.push(data.formatOf(data.formatId(r, c)));
check("every board is wider than tall, in millimetres and in units, so it can tell lying from standing", all.length === 20 && all.every((d) => d.widthMm > d.heightMm && d.width > d.height), String(all.length));
check("names a plain object has anyway are not boards", ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"].every((n) => f(n) === null && !data.isMapFormat(n)));
check("a board wide and one panel tall is the longest", (() => { const d = f("board-1x6"); return d && d.widthMm > d.heightMm && d.width === W && d.height < W / 5; })(), JSON.stringify(f("board-1x6")));
const notBoards = ["board-1x1", "board-0x3", "board-7x2", "board-2x7", "board-3x2", "board-6x1", "board-4x3", "board-2x3x4", "board-02x3", "board-2.5x3", "board--2x3", "board-2x", "board-x3", "Board-2x3", "board-2x3 ", "a4", "", "board-custom", 5, null, undefined, {}, "board-2x3\n"];
check("anything else is not a board, nor one taller than wide (that is a wide board standing)", notBoards.every((id) => f(id) === null && !data.isMapFormat(id)), JSON.stringify(notBoards.filter((id) => f(id) !== null)));
check("formatId names the panels, rows then columns", data.formatId(3, 4) === "board-3x4" && data.formatId(2, 3) === "board-2x3");
check("and the labels say what the board is: the two it had keep their names", f("board-2x3").label === "Standard board 2×3" && f("board-2x4").label === "Extended board 2×4" && /3 × 4|3×4/.test(f("board-3x4").label) && !/Standard|Extended/.test(f("board-3x4").label), f("board-3x4").label);
check("the sizes the settings offer first are the two it had", data.PRESET_FORMATS.join() === "board-2x3,board-2x4");

// ---------------------------------------------------------------- the map and its board
const board = boardOf({ format: "board-3x4" });
check("boardOf gives a 3 × 4 board lying, four across and three down", board.orientation === "landscape" && board.columns === 4 && board.rows === 3 && board.width === W && board.height === f("board-3x4").height);
const stand = boardOf({ format: "board-3x4", orientation: "portrait" });
check("and standing, turned a quarter turn: three across and four down, the sides swapped", stand.columns === 3 && stand.rows === 4 && stand.height === W && stand.width === board.height && stand.widthMm === board.heightMm && stand.heightMm === board.widthMm);
check("a board that is not one reads as the standard board", boardOf({ format: "board-9x9" }).format === "board-2x3");

let map = storage.normalizeMap(clone(initialMap)); map.format = "board-3x4";
const norm = storage.normalizeMap(clone(map));
check("a map on a 3 × 4 board keeps it through normalizing", norm.format === "board-3x4");
const file = storage.writeMapFile("map", storage.mapPayload(norm), norm);
check("the file says the board, in its payload and in its frame", file.payload.format === "board-3x4" && file.board && file.board.width === W && file.board.height === f("board-3x4").height, JSON.stringify(file.board));
const back = storage.normalizeMap(storage.readMapFile(clone(file)).payload);
check("and reads back as the same board", back.format === "board-3x4");
const bogus = clone(file); bogus.payload.format = "board-9x9";
check("a file naming a board that is not one opens on the standard board, as before", storage.normalizeMap(storage.readMapFile(bogus).payload).format === "board-2x3");

// Moving a map to the board scales y by the height ratio, as it does between the two it had.
{
  const from = storage.normalizeMap(clone(initialMap));
  const to = storage.rescaleMapToFormat(clone(from), "board-3x3");
  const ratio = f("board-3x3").height / f("board-2x3").height;
  check("moving a map from 2×3 to 3×3 keeps x and scales y by the height ratio", to.format === "board-3x3" && from.stops.every((s, i) => to.stops[i].x === s.x && Math.abs(to.stops[i].y - s.y * ratio) < 1e-6), String(ratio));
  const there = storage.rescaleMapToFormat(clone(to), "board-2x3");
  check("and back again to where it was", there.stops.every((s, i) => Math.abs(s.y - from.stops[i].y) < 1e-6));
  const stood = storage.rescaleMapToFormat(storage.normalizeMap(Object.assign(clone(from), { orientation: "portrait" })), "board-3x3");
  check("a standing map moves too, and stays standing", stood.format === "board-3x3" && stood.orientation === "portrait");
}

// A board stands and lies again, whatever its shape, and a standing map moves to another board (the smallest and the squarest too).
{
  const { rotateMap } = require(path.join(out, "board.js"));
  for (const id of ["board-1x2", "board-2x2", "board-3x3", "board-6x6", "board-3x4"]) {
    const lying = storage.normalizeMap(clone(initialMap)); lying.format = id;
    const stood = rotateMap(lying, "portrait");
    const laid = rotateMap(stood, "landscape");
    check(`${id}: stood up it stands, laid down it lies, and the map is as it was`, stood.orientation === "portrait" && laid.orientation === undefined && lying.stops.every((st, i) => Math.abs(laid.stops[i].x - st.x) < 1e-6 && Math.abs(laid.stops[i].y - st.y) < 1e-6));
    const moved = storage.rescaleMapToFormat(clone(stood), "board-2x3");
    check(`${id}: a standing map moves to another board and keeps standing`, moved.format === "board-2x3" && moved.orientation === "portrait");
  }
}

// ---------------------------------------------------------------- the build before the boards (1.3.0), reading a file that names one
{
  const old = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-custom-board-old-"));
  let commitThere = true;
  try { execFileSync("git", ["cat-file", "-e", "4b82aa7"], { cwd: root, stdio: "pipe" }); } catch { commitThere = false; console.log("The 1.3.0 commit (4b82aa7) is not at hand: the check against it is skipped."); }
  if (commitThere) {
    try {
      execFileSync("sh", ["-c", `git archive 4b82aa7 app | tar -x -C ${old}`], { cwd: root, stdio: "pipe" });
      execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/map-storage.ts", "app/map-data.ts", "--outDir", path.join(old, "out"), "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: old, stdio: "pipe" });
      const oldStorage = require(path.join(old, "out", "map-storage.js"));
      const theirs = oldStorage.normalizeMap(oldStorage.readMapFile(clone(file)).payload);
      check("1.3.0 reads a file with a 3 × 4 board as the standard board, with the positions as they were (docs/FILE-FORMAT.md says so)", theirs.format === "board-2x3" && theirs.stops.length === norm.stops.length && theirs.stops.every((st, i) => st.x === norm.stops[i].x && st.y === norm.stops[i].y));
    } catch (error) { check("the 1.3.0 build compiles, to be read against", false, String(error.stdout || error.message).slice(0, 300)); }
  }
  fs.rmSync(old, { recursive: true, force: true });
}

// ---------------------------------------------------------------- printing
{
  const sheet = plan.printPlan("board-3x3", { split: "sheet", paper: "a4" });
  check("one sheet: the whole 3 × 3 board on one page", sheet.pages.length === 1 && Math.abs(sheet.boardMm.width - 790) < 1e-6 && Math.abs(sheet.boardMm.height - 788) < 1e-6, JSON.stringify(sheet.boardMm));
  const panels = plan.printPlan("board-3x3", { split: "panel", paper: "a4" });
  check("a sheet per panel: nine for a 3 × 3 board, three across and three down", panels.pages.length === 9 && panels.columns === 3 && panels.rows === 3);
  check("a 3 × 4 board has twelve panels", plan.printPlan("board-3x4", { split: "panel", paper: "a4" }).pages.length === 12);
  const standing = plan.printPlan("board-3x4", { split: "panel", paper: "a4" }, undefined, "portrait");
  check("and a standing one has twelve too, four down and three across", standing.pages.length === 12 && standing.columns === 3 && standing.rows === 4);
  const full = plan.printPlan("board-3x3", { split: "full", paper: "a4", size: "standard" });
  check("full size: at 100 %, as many A4 sheets as it takes to cover 790 × 788 mm", full.scale === 1 && full.pages.length >= 9 && full.pages.length <= 16, String(full.pages.length));
  const one = plan.printPlan("board-3x3", { split: "page", paper: "a4" });
  check("one page, real size: the page is the board with its caption and margins", Math.abs(one.pageMm.width - (790 + 2 * plan.PRINT_MARGIN_MM)) < 1e-6 && one.pages.length === 1 && one.scale === 1);
  const sizes = (id) => plan.printChoices(id).sizes.map((s) => s.id).join();
  check("only the standard 2×3 offers an Anniversary size", sizes("board-2x3") === "standard,anniversary" && sizes("board-2x4") === "standard" && sizes("board-3x3") === "standard" && sizes("board-3x4") === "standard");
  check("a choice of Anniversary on another board falls back to Standard", plan.printChoiceFor("board-3x3", { split: "full", paper: "a4", size: "anniversary" }).size === "standard");
  check("the ticket cards lie the way the board lies", plan.cardSize("board-3x4").width === 62 && plan.cardSize("board-3x4", "portrait").width === 45);
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
