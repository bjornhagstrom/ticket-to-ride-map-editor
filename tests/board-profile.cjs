// The board profile (docs/PROPOSAL-SMALL-BOARDS.md, step 1): four optional fields of a map say how big its board's panel, its wagons, its stops and
// the capitals of its names really are, so that a small board (New York, Amsterdam, London) can be drawn to scale. Written before the code.
//
//   npm run test:board-profile
//
// panelMm {width, height}   one panel as the board LIES (long side first); the board is the panels times it. Absent: 263.3 × 262.5 (the presets keep their measured sizes).
// wagonMm {length[, width, gap, endMargin]}   the width, gap and margin follow the standard proportions of the 20 mm wagon when they are left out.
// stopMm                    across a medium stop, its ring included; small and large follow in the standard ratios. Absent: 9.
// nameMm                    the height of a capital letter in a city's name. Absent: 6.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-board-profile-"));
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/map-data.ts", "app/map-storage.ts", "app/board.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const data = require(path.join(out, "map-data.js"));
const storage = require(path.join(out, "map-storage.js"));
const { boardOf } = require(path.join(out, "board.js"));
const { initialMap, W } = data;

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const near = (a, b, e = 0.01) => Math.abs(a - b) <= e;

// ---------------------------------------------------------------- the board from its panels and the profile
const std = data.boardDefinition({ format: "board-2x2" });
check("with no profile a board is the panels it always was: 2 × 2 standard panels is about 527 × 525 mm", near(std.widthMm, 527, 1) && near(std.heightMm, 525, 1) && std.columns === 2 && std.rows === 2, `${std.widthMm} × ${std.heightMm}`);
check("and the two measured boards keep their sizes", data.boardDefinition({ format: "board-2x3" }).widthMm === 790 && data.boardDefinition({ format: "board-2x4" }).heightMm === 526);
const ny = data.boardDefinition({ format: "board-2x2", panelMm: { width: 214, height: 140 } });
check("a panel of 214 × 140 mm makes a 2 × 2 board of 428 × 280 mm", ny.widthMm === 428 && ny.heightMm === 280 && ny.columns === 2 && ny.rows === 2, `${ny.widthMm} × ${ny.heightMm}`);
check("the long side is 1100 units and the short side follows: 720 for 428 × 280", ny.width === W && ny.height === Math.round(W * 280 / 428), `${ny.width} × ${ny.height}`);
const am = data.boardDefinition({ format: "board-2x2", panelMm: { width: 214, height: 165 } });
check("a panel of 214 × 165 makes 428 × 330 mm and 848 units of height", am.widthMm === 428 && am.heightMm === 330 && am.height === 848, `${am.widthMm} × ${am.heightMm}, ${am.height}`);
check("one map unit is 0.389 mm on both small boards and 0.718 mm on the standard 2 × 3", near(ny.widthMm / ny.width, 0.389, 0.001) && near(am.widthMm / am.width, 0.389, 0.001) && near(data.boardDefinition({ format: "board-2x3" }).widthMm / W, 0.718, 0.001));
check("the profile belongs to a board of panels: the label says it is a custom size", /small|custom/i.test(ny.label), ny.label);
check("a profile on one of the two measured boards is used too (the profile wins)", data.boardDefinition({ format: "board-2x3", panelMm: { width: 100, height: 100 } }).widthMm === 300);

// What is not a profile is not one: the board is then what the format says.
const notPanels = [{ width: 0, height: 100 }, { width: -5, height: 100 }, { width: 100 }, { width: "214", height: 140 }, { width: 214, height: NaN }, { width: 20, height: 140 }, { width: 2000, height: 140 }, null, "big", 5, [], { width: {}, height: [] }, { width: 100, height: 300 }];
check("a panel that is not numbers, is out of 40–1500 mm, or makes the board taller than wide is no profile", notPanels.every((p) => near(data.boardDefinition({ format: "board-2x2", panelMm: p }).widthMm, 527, 1)), JSON.stringify(notPanels.filter((p) => !near(data.boardDefinition({ format: "board-2x2", panelMm: p }).widthMm, 527, 1))));

// ---------------------------------------------------------------- wagon, stop, name
const w = data.wagonOf({});
check("with no profile the wagon is the one the editor has always measured against: 20 × 9 mm, gap 5.5, margin 15", w.length === 20 && w.width === 9 && w.gap === 5.5 && w.endMargin === 15);
const w24 = data.wagonOf({ wagonMm: { length: 24 } });
check("a wagon of 24 mm gets the standard proportions: width 10.8, gap 6.6, margin 18", near(w24.length, 24) && near(w24.width, 10.8) && near(w24.gap, 6.6) && near(w24.endMargin, 18), JSON.stringify(w24));
const wAll = data.wagonOf({ wagonMm: { length: 24, width: 11, gap: 7, endMargin: 20 } });
check("what is given is used", wAll.width === 11 && wAll.gap === 7 && wAll.endMargin === 20);
check("a part that is not a number is left to the proportion: the rest still counts", near(data.wagonOf({ wagonMm: { length: 24, gap: "wide" } }).gap, 6.6));
check("no length, or one out of 5–60 mm, is no profile", [{}, { width: 9 }, { length: 0 }, { length: 100 }, { length: "24" }, null, 24, []].every((x) => data.wagonOf({ wagonMm: x }).length === 20));
check("the parallel lanes of a double route sit a wagon's width and a little over apart, on any wagon", near(data.parallelSpacingMm({ wagonMm: { length: 24 } }), 10.8 + 2.5, 0.01) && near(data.parallelSpacingMm({}), 11.5));
check("a stop is 9 mm across without a profile, and what the profile says with one; small and large keep the ratios of the standard sizes (4.5 and 9 against 6.3)", data.stopMmOf({}) === 9 && data.stopMmOf({ stopMm: 18.5 }) === 18.5 && near(data.stopSizeMm({ stopMm: 18.5 }, "small"), 18.5 * 4.5 / 6.3, 0.01) && near(data.stopSizeMm({ stopMm: 18.5 }, "large"), 18.5 * 9 / 6.3, 0.01) && near(data.stopSizeMm({}, "medium"), 9));
check("on the standard board the three stop sizes are what they were: about 6.4, 9 and 12.9 mm across (radius 4.5, 6.3 and 9 units of 0.718 mm)", near(data.stopSizeMm({}, "small"), 6.4, 0.15) && near(data.stopSizeMm({}, "large"), 12.9, 0.15));
check("an unknown stop size is a medium one, whatever the profile", near(data.stopSizeMm({ stopMm: 14 }, "huge"), 14) && near(data.stopSizeMm({ stopMm: 14 }, 5), 14));
check("a stop outside 3–40 mm is no profile; a name outside 1.5–20 mm neither", data.stopMmOf({ stopMm: 1 }) === 9 && data.stopMmOf({ stopMm: 100 }) === 9 && data.stopMmOf({ stopMm: "9" }) === 9 && data.nameMmOf({ nameMm: 0.5 }) === 6 && data.nameMmOf({ nameMm: 99 }) === 6 && data.nameMmOf({ nameMm: null }) === 6);
check("a capital letter is 6 mm without a profile and 5.8 with it; the type is the capital over 0.7", data.nameMmOf({}) === 6 && data.nameMmOf({ nameMm: 5.8 }) === 5.8 && near(data.nameTypeMm({ nameMm: 5.8 }), 5.8 / 0.7, 0.01));

// ---------------------------------------------------------------- the file
const withProfile = storage.normalizeMap(Object.assign(clone(initialMap), { format: "board-2x2", panelMm: { width: 214, height: 140 }, wagonMm: { length: 24 }, stopMm: 18.5, nameMm: 5.8, orientation: "portrait" }));
check("a map keeps its profile through normalizing", withProfile.panelMm.width === 214 && withProfile.wagonMm.length === 24 && withProfile.stopMm === 18.5 && withProfile.nameMm === 5.8);
const file = storage.writeMapFile("map", storage.mapPayload(withProfile), withProfile);
check("the file carries the four fields", file.payload.panelMm.height === 140 && file.payload.wagonMm.length === 24 && file.payload.stopMm === 18.5 && file.payload.nameMm === 5.8);
check("and the frame says the board's size in units: 720 across and 1100 down for the standing New York", file.board && file.board.width === 720 && file.board.height === 1100, JSON.stringify(file.board));
const back = storage.normalizeMap(storage.readMapFile(clone(file)).payload);
check("and reads back the same", JSON.stringify([back.panelMm, back.wagonMm, back.stopMm, back.nameMm]) === JSON.stringify([withProfile.panelMm, withProfile.wagonMm, withProfile.stopMm, withProfile.nameMm]));
check("a map with no profile writes none: the file is what it was", !["panelMm", "wagonMm", "stopMm", "nameMm"].some((k) => k in storage.mapPayload(storage.normalizeMap(clone(initialMap)))));
const damaged = storage.repairMap(Object.assign(clone(initialMap), { panelMm: { width: "x", height: 140 }, wagonMm: { length: 400 }, stopMm: {}, nameMm: [] }));
check("a profile that is damaged is left out when the map is read, and the reader says so", !("panelMm" in damaged.map) && !("wagonMm" in damaged.map) && !("stopMm" in damaged.map) && !("nameMm" in damaged.map) && damaged.repairs.some((r) => /board|profile|panel|wagon/i.test(r)), damaged.repairs.join(" | "));
check("and reading that result again says nothing", storage.repairMap(clone(JSON.parse(JSON.stringify(damaged.map)))).repairs.length === 0);
check("a profile on a board that is not a panel board is not kept as unknown: the names are known fields", !(withProfile.unknown && ("panelMm" in withProfile.unknown)));

// ---------------------------------------------------------------- the boards from Settings
const preset = (id, from = initialMap) => storage.applyBoardPreset(storage.normalizeMap(clone(from)), id);
const nyMap = preset("small-new-york");
const nyBoard = boardOf(nyMap);
check("New York: the map stands on a 2 × 2 board of 280 × 428 mm, 720 × 1100 units", nyMap.format === "board-2x2" && nyMap.orientation === "portrait" && nyBoard.widthMm === 280 && nyBoard.heightMm === 428 && nyBoard.width === 720 && nyBoard.height === 1100, JSON.stringify([nyMap.format, nyMap.orientation, nyBoard.widthMm, nyBoard.heightMm, nyBoard.width, nyBoard.height]));
check("with its panel, a wagon of 24 mm, stops of 18.5 mm and capitals of 5.8 mm", nyMap.panelMm.width === 214 && nyMap.panelMm.height === 140 && nyMap.wagonMm.length === 24 && nyMap.stopMm === 18.5 && nyMap.nameMm === 5.8);
check("and everything on it is on the board", nyMap.stops.every((s) => s.x >= 0 && s.x <= 720 && s.y >= 0 && s.y <= 1100 && Number.isFinite(s.x) && Number.isFinite(s.y)));
const amMap = preset("small-amsterdam");
const amBoard = boardOf(amMap);
check("Amsterdam and London: the map lies on 428 × 330 mm, 1100 × 848 units, with stops of 14 mm and capitals of 4.3 mm", amMap.format === "board-2x2" && !amMap.orientation && amBoard.widthMm === 428 && amBoard.heightMm === 330 && amBoard.height === 848 && amMap.stopMm === 14 && amMap.nameMm === 4.3 && amMap.wagonMm.length === 24, JSON.stringify([amBoard.widthMm, amBoard.heightMm, amBoard.height, amMap.stopMm, amMap.nameMm]));
const standardAgain = storage.applyBoardPreset(clone(nyMap), "standard");
check("Standard takes the profile off again and puts the map on the 2 × 3 board, standing as it was", standardAgain.format === "board-2x3" && !("panelMm" in standardAgain) && !("wagonMm" in standardAgain) && !("stopMm" in standardAgain) && !("nameMm" in standardAgain) && standardAgain.orientation === "portrait");
check("Extended does the same for the 2 × 4", (() => { const m = storage.applyBoardPreset(clone(amMap), "extended"); return m.format === "board-2x4" && !("panelMm" in m) && !("stopMm" in m); })());
check("a preset moves what is on the map with the board, as a change of board always did: x kept, y by the height", (() => { const lying = preset("small-amsterdam"); const was = storage.normalizeMap(clone(initialMap)); const ratio = amBoard.height / data.boardDefinition(was).height; return lying.stops.every((s, i) => near(s.x, was.stops[i].x, 0.01) && near(s.y, was.stops[i].y * ratio, 0.01)); })());
check("an unknown preset changes nothing", JSON.stringify(storage.applyBoardPreset(storage.normalizeMap(clone(initialMap)), "no-such")) === JSON.stringify(storage.normalizeMap(clone(initialMap))));
check("the presets Settings lists, in order", JSON.stringify(data.BOARD_PRESETS.map((p) => p.id)) === JSON.stringify(["standard", "extended", "small-new-york", "small-amsterdam"]));

// ---------------------------------------------------------------- the builds before it
for (const [commit, name] of [["18b5763", "0.4.1"], ["ce85e72", "1.6.0"]]) {
  const old = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-board-profile-old-"));
  let there = true;
  try { execFileSync("git", ["cat-file", "-e", commit], { cwd: root, stdio: "pipe" }); } catch { there = false; console.log(`The ${name} commit (${commit}) is not at hand: the check against it is skipped.`); }
  if (there) {
    try {
      execFileSync("sh", ["-c", `git archive ${commit} app | tar -x -C ${old}`], { cwd: root, stdio: "pipe" });
      fs.symlinkSync(path.join(root, "node_modules"), path.join(old, "node_modules"));
      execFileSync(path.join(old, "node_modules", ".bin", "tsc"), ["app/map-storage.ts", "app/map-data.ts", "--outDir", "out", "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: old, stdio: "pipe" });
      const oldStorage = require(path.join(old, "out", "map-storage.js"));
      const read = oldStorage.readMapFile(clone(file)).payload;
      const through = oldStorage.mapPayload(oldStorage.repairMap ? oldStorage.repairMap(read).map : oldStorage.normalizeMap(read));
      check(`${name} keeps the four fields untouched in the file it writes (rule 3)`, JSON.stringify([through.panelMm, through.wagonMm, through.stopMm, through.nameMm]) === JSON.stringify([withProfile.panelMm, withProfile.wagonMm, withProfile.stopMm, withProfile.nameMm]), JSON.stringify([through.panelMm, through.stopMm]));
      const again = storage.normalizeMap(storage.readMapFile({ format: "ticket-to-ride-map", version: 3, kind: "map", payload: through }).payload);
      check(`and what ${name} wrote reads here with the profile`, again.panelMm && again.panelMm.width === 214 && again.stopMm === 18.5);
    } catch (error) { check(`the ${name} build compiles, to be read against`, false, String(error.stdout || error.message).slice(0, 300)); }
  }
  fs.rmSync(old, { recursive: true, force: true });
}

// ---------------------------------------------------------------- the game set up with the board (a preset brings its wagons and its table)
{
  const game = (id) => (data.BOARD_PRESETS.find((p) => p.id === id) || {}).game;
  check("New York brings 15 wagons a player and 2 to 4 players", game("small-new-york") && game("small-new-york").wagonsPerPlayer === 15 && game("small-new-york").players.min === 2 && game("small-new-york").players.max === 4);
  check("Amsterdam brings 16 wagons and 2 to 4 players", game("small-amsterdam") && game("small-amsterdam").wagonsPerPlayer === 16 && game("small-amsterdam").players.max === 4);
  check("the standard boards bring nothing of their own", !game("standard") && !game("extended"));
  const fresh = () => { const m = clone(initialMap); m.wagonsPerPlayer = 45; delete m.players; return m; };
  let m = storage.applyBoardPreset(fresh(), "small-new-york");
  check("a map with the standard game takes New York's: 15 wagons, 2 to 4 players", m.wagonsPerPlayer === 15 && m.players && m.players.min === 2 && m.players.max === 4, JSON.stringify([m.wagonsPerPlayer, m.players]));
  m = storage.applyBoardPreset(m, "small-amsterdam");
  check("and then Amsterdam's, since 15 is a number a preset set", m.wagonsPerPlayer === 16);
  m = storage.applyBoardPreset(m, "standard");
  check("back on the standard board the game is the standard one again: 45 wagons and the standard table (no range of its own)", m.wagonsPerPlayer === 45 && (!m.players || (m.players.min === 2 && m.players.max === 5)), JSON.stringify([m.wagonsPerPlayer, m.players]));
  const own = fresh(); own.wagonsPerPlayer = 28; own.players = { min: 2, max: 3 };
  m = storage.applyBoardPreset(own, "small-new-york");
  check("wagons and players a person has chosen are kept when the board changes", m.wagonsPerPlayer === 28 && m.players.max === 3, JSON.stringify([m.wagonsPerPlayer, m.players]));
  m = storage.applyBoardPreset(m, "standard");
  check("and kept on the way back", m.wagonsPerPlayer === 28 && m.players.max === 3);
  const half = fresh(); half.wagonsPerPlayer = 20;
  m = storage.applyBoardPreset(half, "small-amsterdam");
  check("each of the two is judged by itself: own wagons kept, the standard table replaced", m.wagonsPerPlayer === 20 && m.players && m.players.max === 4, JSON.stringify([m.wagonsPerPlayer, m.players]));
  const said = storage.gameForPreset(fresh(), "small-new-york");
  check("gameForPreset says what would change, for the message to the person", said && said.wagonsPerPlayer === 15 && said.players.max === 4 && storage.gameForPreset(own, "small-new-york") === null, JSON.stringify(said));
  const custom = storage.applyBoard(fresh(), { format: "board-2x2", profile: { panelMm: { width: 214, height: 140 } } });
  check("a custom board leaves the game alone", custom.wagonsPerPlayer === 45 && !custom.players);
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
