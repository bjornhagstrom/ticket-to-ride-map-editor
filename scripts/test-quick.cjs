// The quick tier (docs/TESTING.md): the type check, lint and the fast unit suites, with the time of
// each. Not the calibration suites (deck-tension, ticket-calibration, balance-official: about a minute
// together), which matter when the ticket suggester or the balance figures change; `npm test` runs
// them, and so does the release tier. Naming them here as `--with-calibration` runs them too.
//
//   npm run test:quick
//   npm run test:quick -- --with-calibration
const { spawnSync } = require("child_process");
const root = require("path").join(__dirname, "..");
const withCalibration = process.argv.includes("--with-calibration");
const fast = ["synthetic", "suggester", "file-format", "print-plan", "markdown", "releases", "editor-version", "custom-board", "lane-rule", "turn-names", "csv-editor-version", "license", "csv", "csv-import", "csv-ids", "setup-balance", "csv-curves", "ticket-rebind", "board", "terminology", "network-shape", "map-version", "corrupt-files", "intended", "problem-example", "ttr-map-generator"];
const slow = ["calibration", "balance-official", "deck-tension"];
const steps = [["typecheck"], ["lint"], ...fast.map((name) => [`test:${name}`]), ...(withCalibration ? slow.map((name) => [`test:${name}`]) : [])];
const started = Date.now();
const results = [];
for (const [script] of steps) {
  const t = Date.now();
  const run = spawnSync("npm", ["run", "--silent", script], { cwd: root, encoding: "utf8" });
  const seconds = (Date.now() - t) / 1000;
  results.push({ script, seconds, ok: run.status === 0 });
  process.stdout.write(`${run.status === 0 ? "ok  " : "FAIL"} ${script.padEnd(24)} ${seconds.toFixed(1)} s\n`);
  if (run.status !== 0) { process.stdout.write(run.stdout.split("\n").filter((l) => /✗|FAIL|error/i.test(l)).slice(0, 20).join("\n") + "\n" + run.stderr.split("\n").slice(0, 10).join("\n") + "\n"); }
}
const failed = results.filter((r) => !r.ok);
console.log(`\nQuick tier: ${results.length - failed.length} of ${results.length} green in ${((Date.now() - started) / 1000).toFixed(0)} s.`);
console.log(withCalibration ? "Ran the calibration suites too." : "Left out: calibration, balance-official, deck-tension (run with --with-calibration, or npm test), the regression suite (TTR_ONLY=… node tests/regression.cjs), the production build, WebKit.");
process.exit(failed.length ? 1 : 0);
