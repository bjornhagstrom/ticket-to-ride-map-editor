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
const { APP_VERSION, RELEASES, REPO_URL, UNRELEASED } = require(path.join(out, "version.js"));
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

// What's new on GitHub: CHANGELOG.md is written from the same notes by scripts/changelog.cjs, so the
// page in the editor and the page in the repository cannot say different things.
{
  const file = path.join(root, "CHANGELOG.md");
  const { changelog } = require(path.join(root, "scripts", "changelog.cjs"));
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  check("CHANGELOG.md is in the repository, written from the release notes, and up to date (npm run changelog)", text !== "" && text === changelog(RELEASES, pkg.homepage, UNRELEASED), text ? "out of date" : "missing");
  // Notes are written as changes are made, not at release: until the next version is decided they are
  // collected as unreleased, at the top of CHANGELOG.md, and held to the same standard as the rest.
  check("changes since the last release are collected as unreleased notes", Array.isArray(UNRELEASED));
  check("each one a sentence of plain words, naming no files, commits or tools", (UNRELEASED || []).every((c) => typeof c === "string" && c.trim().length >= 25 && c.length <= 320 && /[.!]$/.test(c.trim()) && !/\b[0-9a-f]{7,40}\b/.test(c) && !/\bapp\/|\.tsx?\b|\.cjs\b|\bAGENTS\b|\bCodex\b|\bClaude\b/.test(c)));
  check("and CHANGELOG.md shows them first, under Unreleased, when there are any", !(UNRELEASED || []).length || (text.includes("## Unreleased") && text.indexOf("## Unreleased") < text.indexOf(`## ${RELEASES[0].version}`) && UNRELEASED.every((c) => text.includes(`- ${c}`))));
  check("it has every release under its version and date, newest first", RELEASES.every((r) => text.includes(`## ${r.version} · ${r.date}`)) && text.indexOf(`## ${RELEASES[0].version}`) < text.indexOf(`## ${RELEASES[RELEASES.length - 1].version}`));
  check("it links to the editor", text.includes(`](${pkg.homepage})`));
  check("and the README links to it", /\]\(CHANGELOG\.md\)/.test(fs.readFileSync(path.join(root, "README.md"), "utf8")));
}

// The README is the repository's front page on GitHub: it should send a visitor to the tool first,
// and tell them what it is for in the same terms as the About page, before any developer detail.
{
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const firstScreen = readme.split("\n").slice(0, 12).join("\n");
  const firstHeading = readme.indexOf("\n## ");
  check("the README opens with a link to the editor itself", firstScreen.includes(`](${pkg.homepage})`), firstScreen.slice(0, 300));
  const about = fs.readFileSync(path.join(root, "app", "about", "page.tsx"), "utf8");
  const sections = [...about.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
  const before = (title) => { const at = readme.indexOf(`## ${title}`); return at >= 0 && at < readme.indexOf("## Local development"); };
  check("and tells what the About page tells, section by section, before the developer notes", sections.length >= 4 && sections.every(before), sections.filter((t) => !before(t)).join(" | ") || sections.join(" | "));
  check("the README shows the editor and the ticket cards in pictures that are in the repository", /!\[[^\]]+\]\(docs\/images\/[\w-]+\.png\)/.test(readme) && [...readme.matchAll(/\(docs\/images\/([\w-]+\.png)\)/g)].every((m) => fs.existsSync(path.join(root, "docs", "images", m[1]))) && [...readme.matchAll(/\(docs\/images\//g)].length >= 2);
  check("the README does not promise official decks a score below 5", !/below 5/.test(readme));
  check("and says it is unofficial, as the About page does", /not affiliated/i.test(readme) && /Days of Wonder/.test(readme));
  check("the README's opening is short enough to read before the feature list", firstHeading > 0 && firstHeading < 900, String(firstHeading));
}

console.log(`${ok.length} passed, ${bad.length} failed`);
if (bad.length) { console.log("FAIL:"); for (const b of bad) console.log("  ✗ " + b); }
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
