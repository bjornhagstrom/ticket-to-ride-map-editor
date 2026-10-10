// Helpers for the test tiers (docs/TESTING.md, step 5). Plain functions so tests/tiers.cjs can check them.
const fs = require("fs");
const http = require("http");
const path = require("path");

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".mp4": "video/mp4", ".webmanifest": "application/manifest+json" };

// The production build under /ttr, as on the server: /ttr/ is index.html, a folder serves its index.html, nothing outside the
// build is ever read. Listens on a free port of its own, so a run never meets another.
function serveOut(outDir) {
  const base = path.resolve(outDir);
  const server = http.createServer((req, res) => {
    const send = (status, body, type = "text/plain") => { res.writeHead(status, { "content-type": type }); res.end(body); };
    let pathname;
    try { pathname = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0]); } catch { return send(400, "bad request"); }
    if (pathname !== "/ttr" && !pathname.startsWith("/ttr/")) return send(404, "not found");
    const relative = pathname.slice("/ttr".length).replace(/^\/+/, "");
    let file = path.resolve(base, relative);
    if (file !== base && !file.startsWith(base + path.sep)) return send(404, "not found");
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html"); } catch { return send(404, "not found"); }
    fs.readFile(file, (error, data) => (error ? send(404, "not found") : send(200, data, TYPES[path.extname(file).toLowerCase()] || "application/octet-stream")));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, close: () => new Promise((done) => server.close(() => done())) })));
}

// Names the public notes carry on purpose (a public place name used as an example, a library's attribute, the editor's own storage
// key). Found in every build since 1.1.0 and looked at each time; a name outside this list is a failure.
const ALLOWED_NAMES = ["Edinburgh", "London", "Marseille", "Pamplona", "orebro", "Basel", "basel", "Monaco"];

// The names of places and maps in the private reference data: strings of five or more letters under a key that is a name.
function referenceNames(file) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  const names = new Set();
  const walk = (value, key) => {
    if (typeof value === "string") { if (/name|label|title|city|^a$|^b$/i.test(key || "") && value.length >= 5 && /^[A-Za-zÀ-ÿ .'-]+$/.test(value)) names.add(value); }
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(data, "");
  return [...names];
}

// Every name found in a readable file of out/: those on the allowed list apart from the rest.
function scanOut(outDir, names) {
  const files = [];
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, entry.name); if (entry.isDirectory()) walk(p); else if (!/\.(png|jpe?g|webp|woff2?|mp4|ico)$/i.test(entry.name)) files.push(p); } };
  walk(outDir);
  const unexpected = [], allowed = [];
  const texts = files.map((file) => [path.relative(outDir, file), fs.readFileSync(file, "utf8")]);
  for (const name of names) for (const [file, text] of texts) if (text.includes(name)) (ALLOWED_NAMES.includes(name) ? allowed : unexpected).push({ name, file });
  return { unexpected, allowed, files: files.length };
}

// "949 passed, 0 failed in 128 s": the last such line of a run's output, or null when there is none.
function regressionSummary(output) {
  const found = [...String(output).matchAll(/(\d+) passed, (\d+) failed/g)];
  if (!found.length) return null;
  const last = found[found.length - 1];
  return { passed: Number(last[1]), failed: Number(last[2]) };
}

// A change to the ticket suggester or the balance figures is what the three calibration suites measure.
const CALIBRATION_FILES = [/^app\/ticket-suggester/, /^app\/map-analysis\.ts$/, /^app\/ticket-valuation\.ts$/, /^app\/map-data\.ts$/];
const needsCalibration = (files) => files.some((file) => CALIBRATION_FILES.some((pattern) => pattern.test(file)));

module.exports = { serveOut, scanOut, referenceNames, regressionSummary, needsCalibration, ALLOWED_NAMES };
