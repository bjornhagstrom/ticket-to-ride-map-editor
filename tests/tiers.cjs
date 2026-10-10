// The helpers of the test tiers (docs/TESTING.md, step 5): a static server for the production build under /ttr, the scan of
// out/ for names from the private reference data, the summary line of a regression run, and which suites a change asks for.
// Written before the code.
//
//   npm run test:tiers
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const lib = require(path.join(__dirname, "..", "scripts", "tier-lib.cjs"));
const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const get = (port, urlPath) => new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => { const parts = []; res.on("data", (c) => parts.push(c)); res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"] || "", body: Buffer.concat(parts).toString("utf8") })); }).on("error", reject));

(async () => {
  // ------------------------------------------------------------ the server for out/
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-tiers-"));
  const outDir = path.join(dir, "out");
  fs.mkdirSync(path.join(outDir, "about"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "_next", "static"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), "<!doctype html><title>home</title>");
  fs.writeFileSync(path.join(outDir, "about", "index.html"), "<!doctype html><title>about</title>");
  fs.writeFileSync(path.join(outDir, "_next", "static", "a.js"), "console.log(1)");
  fs.writeFileSync(path.join(outDir, "_next", "static", "a.css"), "a{}");
  fs.writeFileSync(path.join(dir, "secret.txt"), "not in out");
  const server = await lib.serveOut(outDir);
  try {
    const home = await get(server.port, "/ttr/");
    check("/ttr/ is the home page of the build, as on the server", home.status === 200 && /home/.test(home.body) && /html/.test(home.type), `${home.status} ${home.type}`);
    check("a folder serves its index.html", (await get(server.port, "/ttr/about/")).status === 200 && /about/.test((await get(server.port, "/ttr/about/")).body));
    check("a folder without the slash is not lost either", (await get(server.port, "/ttr/about")).status === 200);
    const js = await get(server.port, "/ttr/_next/static/a.js"), css = await get(server.port, "/ttr/_next/static/a.css");
    check("scripts and styles carry the type a browser needs", /javascript/.test(js.type) && /css/.test(css.type), `${js.type} | ${css.type}`);
    check("a file that is not there is a 404", (await get(server.port, "/ttr/nothing.html")).status === 404);
    check("the page is under /ttr only: / itself is a 404, as on the server", (await get(server.port, "/")).status === 404);
    check("a path that climbs out of the build is refused", [(await get(server.port, "/ttr/../secret.txt")).status, (await get(server.port, "/ttr/%2e%2e/secret.txt")).status, (await get(server.port, "/ttr/..%2fsecret.txt")).status].every((s) => s === 404 || s === 400), "");
    check("and says nothing of what is outside", !/not in out/.test((await get(server.port, "/ttr/%2e%2e/secret.txt")).body));
  } finally { await server.close(); }

  // ------------------------------------------------------------ the scan of out/ for the private reference names
  const names = ["Zzyzx Junction", "Quuxville", "London", "Basel"];
  const scan = (files) => { const o = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-scan-")); for (const [name, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(o, name)), { recursive: true }); fs.writeFileSync(path.join(o, name), text); } const r = lib.scanOut(o, names); fs.rmSync(o, { recursive: true, force: true }); return r; };
  const clean = scan({ "index.html": "nothing here", "a.js": "let x=1" });
  check("an out/ with no reference name is clean", clean.unexpected.length === 0 && clean.allowed.length === 0);
  const planted = scan({ "index.html": "this page names Quuxville", "_next/x.js": "var a='Zzyzx Junction'" });
  check("a private name in any file is found, with the file", planted.unexpected.length === 2 && planted.unexpected.some((h) => h.name === "Quuxville" && /index\.html/.test(h.file)) && planted.unexpected.some((h) => h.name === "Zzyzx Junction" && /x\.js/.test(h.file)), JSON.stringify(planted.unexpected));
  const harmless = scan({ "index.html": "Edinburgh to London, near Basel" });
  check("names the editor may carry on purpose (public place names in the notes) are listed apart, not failures", harmless.unexpected.length === 0 && harmless.allowed.some((h) => h.name === "London") && harmless.allowed.some((h) => h.name === "Basel"), JSON.stringify(harmless));
  const mixed = scan({ "a.html": "London and Quuxville" });
  check("an allowed name does not hide one that is not", mixed.unexpected.length === 1 && mixed.unexpected[0].name === "Quuxville");
  check("pictures and fonts are left unread, as before", scan({ "logo.png": "Quuxville", "f.woff2": "Quuxville" }).unexpected.length === 0);
  const refFile = path.join(dir, "ref.json");
  fs.writeFileSync(refFile, JSON.stringify({ maps: [{ name: "Quuxland", stops: [{ name: "Zzyzx Junction" }, { name: "Ab" }, { city: "Plugh Falls" }], routes: [{ a: "Plugh Falls", b: "Zzyzx Junction", id: "r-1" }] }] }));
  const got = lib.referenceNames(refFile);
  check("the names are read out of the reference data: places and maps, not short words or ids", got.includes("Zzyzx Junction") && got.includes("Plugh Falls") && got.includes("Quuxland") && !got.includes("Ab") && !got.includes("r-1"), JSON.stringify(got));
  check("with no reference data the scan says so, and is skipped", lib.referenceNames(path.join(dir, "missing.json")) === null);

  // ------------------------------------------------------------ the summary of a regression run
  check("the summary line is read: passed and failed", JSON.stringify(lib.regressionSummary("noise\n949 passed, 0 failed in 128 s (the suite one after another takes about 408 s)\n")) === JSON.stringify({ passed: 949, failed: 0 }));
  check("and a run with no summary line is not green", lib.regressionSummary("crashed") === null);

  // ------------------------------------------------------------ which suites a change asks for
  check("a change to the suggester or the balance figures asks for the calibration suites", lib.needsCalibration(["app/ticket-suggester.ts"]) && lib.needsCalibration(["app/map-analysis.ts", "README.md"]) && lib.needsCalibration(["app/ticket-valuation.ts"]));
  check("a change to something else does not", !lib.needsCalibration(["app/map-styles.tsx", "docs/TESTING.md", "tests/regression.cjs"]) && !lib.needsCalibration([]));

  for (const line of ok) console.log(`  ok    ${line}`);
  for (const line of bad) console.log(`  FAIL  ${line}`);
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(bad.length ? 1 : 0);
})();
