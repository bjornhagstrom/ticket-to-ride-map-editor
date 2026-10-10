// The merge and release tiers in one command each (docs/TESTING.md, step 5). Each prints what it ran, what it left out and
// why, and how long it took, and says "green" only when everything it ran was.
//
//   npm run test:merge      # before work is merged into main
//   npm run test:release    # before every push of a release and every deploy
//
// merge:   typecheck, lint and the fast unit suites (the calibration suites too when the change touches the ticket suggester or the
//          balance figures), the build, then the whole regression in Chromium on that build, in parallel, with shorter waits.
// release: `npm test` (everything, the calibration suites and the build included), the scan of out/ for names from the private
//          reference data, then the whole regression on the production build with the waits as written, in Chromium and in WebKit
//          at the same time. The review (docs/REVIEW.md) and the walk-through (docs/DEPLOYMENT.md) are done by hand, and said so.
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const lib = require("./tier-lib.cjs");

const root = path.join(__dirname, "..");
const tier = process.argv[2];
if (tier !== "merge" && tier !== "release") { console.error("usage: node scripts/test-tiers.cjs merge|release"); process.exit(2); }

const started = Date.now();
const results = [];
const left = [];
const seconds = (t) => ((Date.now() - t) / 1000).toFixed(0);
const record = (name, ok, t, note = "") => { results.push({ name, ok }); console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(46)} ${seconds(t).padStart(4)} s${note ? `  ${note}` : ""}`); };

const run = (command, args, env = {}) => new Promise((resolve) => {
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env } });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  child.on("close", (code) => resolve({ code, out }));
});
const show = (out, lines = 25) => { const bad = out.split("\n").filter((l) => /✗|FAIL|error|HARNESS|CONSOLE ERRORS: \[/i.test(l)).slice(0, lines); if (bad.length) console.log(bad.map((l) => `     ${l}`).join("\n")); };

(async () => {
  console.log(`${tier} tier\n`);
  const git = spawnSync("git", ["diff", "--name-only", "main"], { cwd: root, encoding: "utf8" });
  const changed = git.status === 0 ? git.stdout.split("\n").filter(Boolean) : [];

  if (tier === "merge") {
    const calibrate = lib.needsCalibration(changed);
    let t = Date.now();
    const quick = await run("node", ["scripts/test-quick.cjs", ...(calibrate ? ["--with-calibration"] : [])]);
    record(`quick tier${calibrate ? " with the calibration suites" : ""}`, quick.code === 0, t, quick.out.split("\n").filter((l) => /Quick tier:/.test(l)).join(""));
    if (quick.code !== 0) show(quick.out);
    if (!calibrate) left.push("the calibration suites (deck-tension, ticket-calibration, balance-official): nothing changed that they measure");
    t = Date.now();
    const build = await run("npm", ["run", "build"]);
    record("build", build.code === 0, t);
    if (build.code !== 0) show(build.out);
    if (quick.code === 0 && build.code === 0) {
      const server = await lib.serveOut(path.join(root, "out"));
      t = Date.now();
      const regression = await run("node", ["scripts/test-regression-parallel.cjs", "--fast"], { TTR_URL: `http://127.0.0.1:${server.port}/ttr/` });
      await server.close();
      const sum = lib.regressionSummary(regression.out);
      record("regression, Chromium, production build, --fast", regression.code === 0 && sum !== null && sum.failed === 0, t, sum ? `${sum.passed} checks` : "no summary");
      if (regression.code !== 0) show(regression.out);
    } else left.push("the regression: the steps before it failed");
    left.push("WebKit and the waits as written (the release tier)", "the review (docs/REVIEW.md) for more than a small change: by hand");
  } else {
    let t = Date.now();
    const unit = await run("npm", ["test"]);
    record("npm test (everything, the build included)", unit.code === 0, t);
    if (unit.code !== 0) show(unit.out);
    if (unit.code === 0) {
      t = Date.now();
      const names = lib.referenceNames(path.join(root, "..", "ttr-reference-data", "ttr-reference-maps.json"));
      if (names === null) { left.push("the scan of out/ for private names: the reference data is not at hand (it is how a clean scan is known)"); }
      else {
        const scan = lib.scanOut(path.join(root, "out"), names);
        record("scan of out/ for private reference names", scan.unexpected.length === 0, t, `${scan.files} files, ${[...new Set(scan.allowed.map((h) => h.name))].length} allowed names found (${[...new Set(scan.allowed.map((h) => h.name))].join(", ")})`);
        for (const hit of scan.unexpected) console.log(`     ${hit.name} in ${hit.file}`);
      }
      const server = await lib.serveOut(path.join(root, "out"));
      const url = `http://127.0.0.1:${server.port}/ttr/`;
      t = Date.now();
      const [chromium, webkit] = await Promise.all([
        run("node", ["scripts/test-regression-parallel.cjs"], { TTR_URL: url }),
        run("node", ["scripts/test-regression-parallel.cjs"], { TTR_URL: url, TTR_BROWSER: "webkit" }),
      ]);
      await server.close();
      for (const [name, r] of [["Chromium", chromium], ["WebKit", webkit]]) {
        const sum = lib.regressionSummary(r.out);
        record(`regression, ${name}, production build, waits as written`, r.code === 0 && sum !== null && sum.failed === 0, t, sum ? `${sum.passed} checks` : "no summary");
        if (r.code !== 0) show(r.out);
      }
    } else left.push("the scan and the regression: npm test failed");
    left.push("Chromium against the dev server (the production build is the stricter of the two for what ships)", "the review of the release (docs/REVIEW.md) and the walk-through (docs/DEPLOYMENT.md): by hand", "the owner's go for a push or a deploy");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${tier[0].toUpperCase()}${tier.slice(1)} tier: ${failed.length ? `NOT green, ${failed.length} of ${results.length} steps failed (${failed.map((r) => r.name).join("; ")})` : `green, ${results.length} steps`} in ${seconds(started)} s.`);
  console.log(`Not run: ${left.join("; ")}.`);
  const regressions = results.filter((r) => r.name.startsWith("regression")).length;
  process.exit(failed.length || regressions < (tier === "release" ? 2 : 1) ? 1 : 0);
})();
