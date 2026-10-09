// The lane rule of a map: from how many players the second lane of a double route opens (docs/FILE-FORMAT.md, "The lane rule").
// Written before the code. The analysis could read a rule, but nothing set it and a file never carried it. A map now has a setting for it, "opens from N players" (2 to 6, 4 by default, the standard rule), kept as
// `laneRule` and carried through export and import. The field has a name no older build knows, so an older build keeps it
// untouched (docs/FILE-FORMAT.md, rule 3), which is why it is not called what the analysis called it, a name every older build
// drops; both are checked here against the builds themselves. A rule that is not of that shape (a hand-written file's own
// counts) is kept as it is, shown as the map's own rule, and replaced when a number is chosen.
//
//   npm run test:lane-rule
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-lane-rule-"));
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/map-data.ts", "app/map-storage.ts", "app/map-analysis.ts",
  "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const data = require(path.join(out, "map-data.js"));
const storage = require(path.join(out, "map-storage.js"));
const A = require(path.join(out, "map-analysis.js"));
const { initialMap } = data;

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const clone = (value) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------- the rule from a number, and the number from a rule
check("the standard rule is four: a map with no rule opens its second lane from four players", data.lanesOpenFrom(undefined) === 4 && data.lanesOpenFrom({}) === 4);
check("four is written as no rule at all, so a file stays as it was", data.laneRuleOpeningFrom(4) === undefined);
check("two means always open: one entry", JSON.stringify(data.laneRuleOpeningFrom(2)) === JSON.stringify({ "2+": "all" }), JSON.stringify(data.laneRuleOpeningFrom(2)));
check("three, five and six: one lane from two players up, all lanes from that number", [3, 5, 6].every((n) => JSON.stringify(data.laneRuleOpeningFrom(n)) === JSON.stringify({ "2+": 1, [`${n}+`]: "all" })), JSON.stringify(data.laneRuleOpeningFrom(5)));
check("the number comes back from the rule, for every number from 2 to 6", [2, 3, 4, 5, 6].every((n) => data.lanesOpenFrom(data.laneRuleOpeningFrom(n)) === n));
check("a rule of the map's own, which no number says, has no number", data.lanesOpenFrom({ "2": 1, "3": 2, "4": "all" }) === null && data.lanesOpenFrom({ "2+": 1, "3+": 2, "4+": "all" }) === null);
check("a number out of range is brought to the nearest the setting offers", JSON.stringify(data.laneRuleOpeningFrom(1)) === JSON.stringify(data.laneRuleOpeningFrom(2)) && JSON.stringify(data.laneRuleOpeningFrom(9)) === JSON.stringify(data.laneRuleOpeningFrom(6)));

// ---------------------------------------------------------------- what the rule does to the lanes
const lanes = (n, players) => data.lanesUsableAt(players, 2, data.laneRuleOpeningFrom(n));
check("opening from 2: both lanes at every table", [2, 3, 4, 5].every((p) => lanes(2, p) === 2));
check("opening from 3: one lane at two players, both from three", lanes(3, 2) === 1 && lanes(3, 3) === 2 && lanes(3, 5) === 2);
check("opening from 4, as before: one lane below four, both from four", lanes(4, 3) === 1 && lanes(4, 4) === 2);
check("opening from 5: one lane at four players, both at five", lanes(5, 4) === 1 && lanes(5, 5) === 2);
check("a triple route follows the same rule: one lane below, all three from the number", data.lanesUsableAt(3, 3, data.laneRuleOpeningFrom(3)) === 3 && data.lanesUsableAt(2, 3, data.laneRuleOpeningFrom(3)) === 1);

// ---------------------------------------------------------------- reading a rule from a file
const norm = (rule) => { const m = clone(initialMap); if (rule !== undefined) m.laneRule = rule; return storage.normalizeMap(m).laneRule; };
check("a map's rule survives normalizing", JSON.stringify(norm({ "2+": 1, "3+": "all" })) === JSON.stringify({ "2+": 1, "3+": "all" }), JSON.stringify(norm({ "2+": 1, "3+": "all" })));
check("a map with none has none", norm(undefined) === undefined);
check("an exact player count is a rule too, and kept", JSON.stringify(norm({ "2": 1, "3": 2, "4": "all" })) === JSON.stringify({ "2": 1, "3": 2, "4": "all" }));
check("entries that are not a rule are left out: bad keys, bad counts", JSON.stringify(norm({ "3+": "all", x: 1, "2": 0, "4": -1, "5": 2.5, "6": "some", "": 1, "7+": 1e9 })) === JSON.stringify({ "3+": "all" }), JSON.stringify(norm({ "3+": "all", x: 1, "2": 0, "4": -1, "5": 2.5, "6": "some", "": 1, "7+": 1e9 })));
check("a rule with nothing usable is no rule", norm({ x: 1 }) === undefined && norm("all") === undefined && norm([1, 2]) === undefined && norm(null) === undefined && norm({}) === undefined);
check("a key such as __proto__ is left out, and is never a prototype", (() => { const r = norm(JSON.parse('{"__proto__": 1, "constructor": 2, "3+": "all"}')); return JSON.stringify(r) === '{"3+":"all"}' && Object.getPrototypeOf(r) === Object.prototype; })());
const m = storage.normalizeMap(Object.assign(clone(initialMap), { laneRule: data.laneRuleOpeningFrom(3) }));
const file = storage.writeMapFile("map", storage.mapPayload(m), m);
check("the file carries it", JSON.stringify(file.payload.laneRule) === JSON.stringify({ "2+": 1, "3+": "all" }));
const back = storage.normalizeMap(storage.readMapFile(clone(file)).payload);
check("and it reads back, as the number three", data.lanesOpenFrom(back.laneRule) === 3);

// ---------------------------------------------------------------- Map balance follows it
{
  const base = storage.normalizeMap(clone(initialMap)); base.players = { min: 2, max: 3 };
  const standard = A.setupBalance(base, "main");
  const open = A.setupBalance({ ...base, laneRule: data.laneRuleOpeningFrom(2) }, "main");
  check("opening from 2, a table of three has every space of the board to fill, not one lane of each double route", standard.usableSpaces < standard.totalSpaces && open.usableSpaces === open.totalSpaces && open.usableSpaces > standard.usableSpaces, `${standard.usableSpaces} against ${open.usableSpaces} of ${open.totalSpaces}`);
}

// ---------------------------------------------------------------- the builds before it (0.4.1 and 1.4.0)
// A file with the rule must go through every older build and come out with it (rule 3), and a file an older build wrote, with no
// rule, must read here as the standard rule. 0.4.1 is the first release; 1.4.0 the last without the setting.
for (const [commit, name] of [["18b5763", "0.4.1"], ["fe0c705", "1.4.0"]]) {
  const old = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-lane-rule-old-"));
  let there = true;
  try { execFileSync("git", ["cat-file", "-e", commit], { cwd: root, stdio: "pipe" }); } catch { there = false; console.log(`The ${name} commit (${commit}) is not at hand: the checks against it are skipped.`); }
  if (there) {
    try {
      execFileSync("sh", ["-c", `git archive ${commit} app | tar -x -C ${old}`], { cwd: root, stdio: "pipe" });
      fs.symlinkSync(path.join(root, "node_modules"), path.join(old, "node_modules"));
      execFileSync(path.join(old, "node_modules", ".bin", "tsc"), ["app/map-storage.ts", "app/map-data.ts", "--outDir", "out", "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: old, stdio: "pipe" });
      const oldStorage = require(path.join(old, "out", "map-storage.js"));
      const oldData = require(path.join(old, "out", "map-data.js"));
      const withRule = clone(file); withRule.payload.laneRule = { "2+": 1, "3+": "all" };
      const read = oldStorage.readMapFile(clone(withRule)).payload;
      const through = oldStorage.mapPayload(oldStorage.repairMap ? oldStorage.repairMap(read).map : oldStorage.normalizeMap(read));
      check(`${name} keeps the rule untouched, in the file it writes`, JSON.stringify(through.laneRule) === JSON.stringify({ "2+": 1, "3+": "all" }), JSON.stringify(through.laneRule));
      const again = storage.normalizeMap(storage.readMapFile({ format: "ticket-to-ride-map", version: 3, kind: "map", payload: through }).payload);
      check(`and what ${name} wrote reads here with the rule: three players`, data.lanesOpenFrom(again.laneRule) === 3);
      const theirs = oldStorage.writeMapFile("map", oldStorage.mapPayload(oldStorage.normalizeMap(clone(oldData.initialMap))), oldStorage.normalizeMap(clone(oldData.initialMap)));
      const theirMap = storage.normalizeMap(storage.readMapFile(clone(theirs)).payload);
      check(`a file ${name} wrote, with no rule, reads here as the standard rule`, theirMap.laneRule === undefined && data.lanesOpenFrom(theirMap.laneRule) === 4);
    } catch (error) { check(`the ${name} build compiles, to be read against`, false, String(error.stdout || error.message).slice(0, 300)); }
  }
  fs.rmSync(old, { recursive: true, force: true });
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
