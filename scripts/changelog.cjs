// Writes CHANGELOG.md, What's new for GitHub, from the release notes in app/version.ts: the same notes
// the What's new page in the editor shows, so the two cannot disagree. tests/releases.cjs checks it.
//
//   npm run changelog
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function changelog(releases, homepage) {
  return [
    "# What's new",
    "",
    `What changed in each version of the [Ticket to Ride map editor](${homepage}), newest first. The same notes are on the What's new page under Help in the editor.`,
    "",
    "This file is written from `app/version.ts` by `npm run changelog`; edit the notes there.",
    "",
    ...releases.flatMap((release) => [`## ${release.version} · ${release.date}`, "", `**${release.title}**`, "", ...release.changes.map((change) => `- ${change}`), ""]),
  ].join("\n");
}

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-changelog-"));
  execFileSync("npx", ["tsc", "app/version.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck"], { cwd: root, stdio: "inherit" });
  const { RELEASES } = require(path.join(out, "version.js"));
  const { homepage } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  fs.writeFileSync(path.join(root, "CHANGELOG.md"), changelog(RELEASES, homepage));
  fs.rmSync(out, { recursive: true, force: true });
  console.log("CHANGELOG.md written");
}

module.exports = { changelog };
