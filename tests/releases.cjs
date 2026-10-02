// The version number and the release notes behind the What's new page.
//
//   npm run test:releases
//
// The notes are for the people who use the editor, so they are checked for what a note must be: in
// order, dated, written in plain words, and with no file names or commit hashes in them.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-releases-"));
execFileSync("npx", ["tsc", "app/version.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const { APP_VERSION, RELEASES, REPO_URL } = require(path.join(out, "version.js"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const semver = /^\d+\.\d+\.\d+$/;
const parts = (v) => v.split(".").map(Number);
const newer = (a, b) => { const [x, y] = [parts(a), parts(b)]; for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

check("the version is the package's own", APP_VERSION === pkg.version, `${APP_VERSION} against ${pkg.version}`);
check("it is a plain three-part version", semver.test(APP_VERSION));
check("the newest release note is the current version", RELEASES[0] && RELEASES[0].version === APP_VERSION, RELEASES[0] && RELEASES[0].version);
check("every release has a three-part version, and they run from newest to oldest", RELEASES.every((r) => semver.test(r.version)) && RELEASES.every((r, i) => i === 0 || newer(RELEASES[i - 1].version, r.version)), RELEASES.map((r) => r.version).join(" > "));
check("every release has a real date, and the dates never go forward as the versions go back", RELEASES.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && !Number.isNaN(Date.parse(r.date))) && RELEASES.every((r, i) => i === 0 || r.date <= RELEASES[i - 1].date), RELEASES.map((r) => r.date).join(", "));
check("no release is dated in the future", RELEASES.every((r) => Date.parse(r.date) <= Date.now() + 86400000));
check("every release has a title and at least one change", RELEASES.every((r) => typeof r.title === "string" && r.title.trim() && Array.isArray(r.changes) && r.changes.length >= 1));
check("every change is a sentence of plain words, not a stub and not an essay", RELEASES.every((r) => r.changes.every((c) => typeof c === "string" && c.trim().length >= 25 && c.length <= 320 && /[.!]$/.test(c.trim()))));
check("the notes name no files, commits or tools", RELEASES.every((r) => [r.title, ...r.changes].every((t) => !/\b[0-9a-f]{7,40}\b/.test(t) && !/\bapp\/|\.tsx?\b|\.cjs\b|\bAGENTS\b|\bCodex\b|\bClaude\b|\bnpm\b|\bgit\b/i.test(t))));
check("the repository link is a GitHub address to an owner and a repository", /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(REPO_URL), String(REPO_URL));
check("the package names the same repository, and the public address of the tool", pkg.repository && String(pkg.repository.url).includes(REPO_URL.replace("https://", "")) && pkg.homepage === "https://hagstrom.nu/ttr/", JSON.stringify([pkg.repository, pkg.homepage]));
check("the first version is in the list", RELEASES.some((r) => r.version === "0.1.0"));
check("no two releases share a version", new Set(RELEASES.map((r) => r.version)).size === RELEASES.length);

console.log(`${ok.length} passed, ${bad.length} failed`);
if (bad.length) { console.log("FAIL:"); for (const b of bad) console.log("  ✗ " + b); }
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
