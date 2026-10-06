// The regression suite in parallel (docs/TESTING.md, step 4): the chain (sections 1 to 32 and 34, which
// share one page) is one job, the other sections run alone and are shared out over the rest, balanced by
// how long each took last time (tests/section-times.json). Every job is a plain
// `TTR_ONLY=… node tests/regression.cjs`, so each can be run by hand too.
//
//   npm run test:regression:parallel                       # against http://localhost:3000/ttr/ or TTR_URL
//   npm run test:regression:parallel -- --workers 4
//   npm run test:regression:parallel -- --fast             # shorter fixed waits, for the merge tier
//   npm run test:regression:parallel -- --record           # also rewrite tests/section-times.json
//
// --fast runs every fixed wait at half of what is written, never under 250 ms, except in the sections that
// were found to need real time (tooltip delays, debounced saves: FAST_FULL_WAITS below). Found by running
// the suite with shorter waits until nothing failed, then five times over (docs/TESTING.md, step 3). The
// release tier does not use it: it runs the waits as written.
//
// TTR_URL, TTR_BROWSER, TTR_WAIT_SCALE and TTR_FULL_WAITS reach every job. One server is used by all of
// them, so do not rebuild out/ while it runs.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const workers = Math.max(2, Number(value("--workers", Math.min(6, Math.max(2, os.cpus().length - 2)))));
const record = flag("--record");
const FAST = { TTR_WAIT_SCALE: "0.5", TTR_WAIT_FLOOR: "250", TTR_FULL_WAITS: "37,55" };
if (flag("--fast")) for (const [key, value] of Object.entries(FAST)) if (!process.env[key]) process.env[key] = value;

const timesFile = path.join(root, "tests", "section-times.json");
const known = fs.existsSync(timesFile) ? JSON.parse(fs.readFileSync(timesFile, "utf8")).sections : {};
const SECTIONS = 58;
const chain = [...Array(32).keys()].map((i) => i + 1).concat([34]);
const alone = [33, ...Array.from({ length: SECTIONS - 34 }, (_, i) => 35 + i)];
const weight = (n) => Number(known[n] ?? 10);

// The chain is one job. The sections that run alone are placed longest first on the least loaded of the
// other workers.
const bins = Array.from({ length: workers }, () => ({ sections: [], load: 0, chain: false }));
bins[0].chain = true; bins[0].load = chain.reduce((sum, n) => sum + weight(n), 0);
for (const n of [...alone].sort((a, b) => weight(b) - weight(a))) {
  const bin = bins.reduce((best, b) => (b.load < best.load ? b : best), bins[0]);
  bin.sections.push(n); bin.load += weight(n);
}
const jobs = bins.filter((b) => b.chain || b.sections.length).map((b, i) => ({ id: i + 1, only: [...(b.chain ? [1] : []), ...b.sections.sort((x, y) => x - y)], chain: b.chain, planned: b.load, sections: b.sections }));

const started = Date.now();
const results = [];
const runJob = (job) => new Promise((resolve) => {
  const times = path.join(os.tmpdir(), `ttr-times-${process.pid}-${job.id}.json`);
  const child = spawn("node", ["tests/regression.cjs"], { cwd: root, env: { ...process.env, TTR_ONLY: job.only.join(","), TTR_TIMES: times } });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  const t = Date.now();
  child.on("close", (code) => {
    const passed = Number((/(\d+) passed, (\d+) failed/.exec(out) || [])[1] || 0);
    const failed = Number((/(\d+) passed, (\d+) failed/.exec(out) || [])[2] || 0);
    const console_ = (/CONSOLE ERRORS: (.*)/.exec(out) || [])[1] || "(no summary)";
    const harness = /HARNESS FAILED.*/.exec(out);
    let sectionTimes = {};
    try { sectionTimes = JSON.parse(fs.readFileSync(times, "utf8")); fs.rmSync(times); } catch { /* the job broke off before writing */ }
    const result = { job, code, passed, failed, console: console_, harness: harness ? harness[0] : null, seconds: (Date.now() - t) / 1000, failures: out.split("\n").filter((l) => l.startsWith("  ✗")), sectionTimes };
    results.push(result);
    process.stdout.write(`job ${job.id} (${job.chain ? "chain + " : ""}${job.sections.length} section${job.sections.length === 1 ? "" : "s"}${job.sections.length ? ` ${job.sections.join(",")}` : ""}): ${passed} passed, ${failed} failed in ${result.seconds.toFixed(0)} s (planned ${job.planned.toFixed(0)})${harness ? " HARNESS FAILED" : ""}\n`);
    resolve();
  });
});

console.log(`Regression in parallel: ${jobs.length} jobs on ${workers} workers, against ${process.env.TTR_URL || "http://localhost:3000/ttr/"}${process.env.TTR_BROWSER ? ` in ${process.env.TTR_BROWSER}` : ""}${process.env.TTR_WAIT_SCALE ? `, waits ×${process.env.TTR_WAIT_SCALE}` : ""}`);
Promise.all(jobs.map(runJob)).then(() => {
  const passed = results.reduce((sum, r) => sum + r.passed, 0);
  const failed = results.reduce((sum, r) => sum + r.failed, 0);
  const broken = results.filter((r) => r.harness || (r.code !== 0 && r.failed === 0));
  const consoleErrors = results.filter((r) => r.console !== "none");
  for (const r of results) for (const line of r.failures) console.log(`job ${r.job.id}${line}`);
  for (const r of broken) console.log(`job ${r.job.id} ${r.harness || `exited ${r.code} without a summary`}`);
  for (const r of consoleErrors) console.log(`job ${r.job.id} CONSOLE ERRORS: ${r.console}`);
  console.log(`\n${passed} passed, ${failed} failed in ${((Date.now() - started) / 1000).toFixed(0)} s (the suite one after another takes about ${Object.values(known).reduce((sum, v) => sum + Number(v), 0).toFixed(0)} s)`);
  if (record && !broken.length) {
    const merged = { ...known };
    for (const r of results) for (const [n, seconds] of Object.entries(r.sectionTimes)) merged[n] = seconds;
    const file = JSON.parse(fs.readFileSync(timesFile, "utf8"));
    file.sections = Object.fromEntries(Object.entries(merged).sort((a, b) => Number(a[0]) - Number(b[0])));
    fs.writeFileSync(timesFile, `${JSON.stringify(file, null, 1)}\n`);
    console.log("Section times written to tests/section-times.json.");
  }
  process.exit(failed || broken.length || consoleErrors.length ? 1 : 0);
});
