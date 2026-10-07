// The wagon count against the map (Map balance, "Game setup against the map"). Written before the change. What
// matters is what a full table holds against what the board can take: the players at the largest table times the
// wagons each, over the wagon spaces that table can claim (a second lane of a double route counts only where it
// is open). The eight official maps hold 57 to 76 % (tests/balance-official.cjs); more than 100 % means nobody
// can run out of wagons, so the game cannot end that way; under 40 % leaves the board mostly empty.
//
//   npm run test:setup-balance
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-setup-"));
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/map-analysis.ts", "app/map-data.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const { setupBalance, BALANCE_OFFICIAL } = require(path.join(out, "map-analysis.js"));
const { initialMap, emptyMap } = require(path.join(out, "map-data.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const clone = (v) => JSON.parse(JSON.stringify(v));

// A line of stops: A–B–C–D, routes of the given lengths, plain.
const line = (lengths, extra = {}) => {
  const m = clone(emptyMap);
  m.stops = lengths.concat([0]).map((_, i) => ({ id: `s${i}`, name: `S${i}`, type: "city", x: 100 + i * 100, y: 100 }));
  m.routes = lengths.map((length, i) => ({ id: `r${i}`, a: `s${i}`, b: `s${i + 1}`, length, type: "city", color: "red" }));
  return { ...m, ...extra };
};

{
  const m = line([25, 25, 25, 25], { wagonsPerPlayer: 25, players: { min: 2, max: 3 } });
  const s = setupBalance(m);
  check("a full table holds its wagons against the spaces: 3 players of 25 wagons on 100 spaces is 75 %", s.totalSpaces === 100 && s.usableSpaces === 100 && s.wagonsAtTable === 75 && Math.abs(s.fill - 0.75) < 1e-9 && s.spaceVerdict === "ok", JSON.stringify({ spaces: s.totalSpaces, usable: s.usableSpaces, wagons: s.wagonsAtTable, fill: s.fill, verdict: s.spaceVerdict }));
  const more = setupBalance({ ...m, players: { min: 2, max: 5 } });
  check("the same map for five players holds 125 wagons against 100 spaces: more than the board, so too tight", Math.abs(more.fill - 1.25) < 1e-9 && more.spaceVerdict === "tight", `${more.fill} ${more.spaceVerdict}`);
  const few = setupBalance({ ...m, wagonsPerPlayer: 8 });
  check("24 wagons on 100 spaces is under 40 %: very roomy", Math.abs(few.fill - 0.24) < 1e-9 && few.spaceVerdict === "roomy", `${few.fill} ${few.spaceVerdict}`);
  const two = { ...m, players: { min: 2, max: 2 } };
  check("the edges: exactly 40 % is not yet roomy and 39 % is; exactly 100 % is not yet too tight and 102 % is", setupBalance({ ...two, wagonsPerPlayer: 20 }).spaceVerdict === "ok" && setupBalance({ ...two, wagonsPerPlayer: 19.5 }).spaceVerdict === "roomy" && setupBalance({ ...two, wagonsPerPlayer: 50 }).spaceVerdict === "ok" && setupBalance({ ...two, wagonsPerPlayer: 51 }).spaceVerdict === "tight");
}
{
  // A double route: its second lane counts only at a table that may use it.
  const m = line([20, 20, 20, 20], { wagonsPerPlayer: 20, players: { min: 2, max: 3 } });
  m.routes.push({ id: "r0b", a: "s0", b: "s1", length: 20, type: "city", color: "blue" });
  const three = setupBalance(m);
  check("at three players the second lane of a double route is not open, so its spaces are not counted", three.totalSpaces === 100 && three.usableSpaces === 80 && Math.abs(three.fill - 60 / 80) < 1e-9, `${three.usableSpaces} usable of ${three.totalSpaces}`);
  const four = setupBalance({ ...m, players: { min: 2, max: 4 } });
  check("from four players it is open, and counted", four.usableSpaces === 100 && Math.abs(four.fill - 80 / 100) < 1e-9, `${four.usableSpaces}`);
  const rule = setupBalance({ ...m, players: { min: 2, max: 3 }, lanesUsableByPlayers: { "2+": "all" } });
  check("a map's own rule for its lanes is followed", rule.usableSpaces === 100, `${rule.usableSpaces}`);
}
{
  const none = setupBalance(clone(emptyMap));
  check("a map with no routes has nothing to put wagons on: too tight, as before, and no division by nothing", none.usableSpaces === 0 && none.spaceVerdict === "tight" && none.fill === null, JSON.stringify({ usable: none.usableSpaces, fill: none.fill, verdict: none.spaceVerdict }));
  const nowagons = setupBalance(line([10, 10], { wagonsPerPlayer: 0 }));
  check("no wagons at all is roomy, not a crash", nowagons.spaceVerdict === "roomy" && nowagons.fill === 0);
}
{
  const ex = setupBalance(initialMap);
  check("the example map: 28 wagons for five players is 140 against 99 spaces", ex.usableSpaces === 99 && ex.wagonsAtTable === 140 && Math.abs(ex.fill - 140 / 99) < 1e-9 && ex.spaceVerdict === "tight", JSON.stringify({ usable: ex.usableSpaces, wagons: ex.wagonsAtTable, verdict: ex.spaceVerdict }));
}
check("the official range is on the page for the other figures to sit beside: 57 to 76 %", Array.isArray(BALANCE_OFFICIAL.wagonFill) && BALANCE_OFFICIAL.wagonFill[0] === 57 && BALANCE_OFFICIAL.wagonFill[1] === 76, JSON.stringify(BALANCE_OFFICIAL.wagonFill));

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
