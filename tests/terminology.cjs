// The words the editor uses, held to docs/TERMINOLOGY.md. Written before that file existed.
//
//   npm run test:terminology
//
// The file lists, under "Not in the editor", words we have chosen not to use, each with the word to
// use instead. This checks that none of them appears in what a person reads: the editor's own pages
// and components, the README and the spreadsheet guide. Release notes are left alone: they record what
// things were called at the time. Comments in the code are left alone too.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };

const guide = fs.readFileSync(path.join(root, "docs", "TERMINOLOGY.md"), "utf8");
const section = guide.split(/^## /m).find((part) => part.startsWith("Not in the editor")) || "";
const avoided = [...section.matchAll(/^- `([^`]+)`, use `([^`]+)`/gm)].map((m) => ({ word: m[1], instead: m[2] }));
check("the terminology lists words not to use, each with the one to use instead", avoided.length >= 4, avoided.map((a) => a.word).join(", "));
check("and says what the main words mean", ["stop", "route", "wagon space", "ticket", "deck", "points", "score", "board"].every((term) => new RegExp(`\\*\\*${term}\\*\\*`, "i").test(guide)));

// What a person reads: the editor's components and pages, without comments; the README; the CSV guide.
const stripComments = (text) => text.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const sources = [
  ...fs.readdirSync(path.join(root, "app")).filter((f) => f.endsWith(".tsx")).map((f) => path.join("app", f)),
  "app/about/page.tsx", "app/whats-new/page.tsx", "README.md", "docs/CSV.md",
];
for (const { word, instead } of avoided) {
  const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const found = sources.filter((file) => {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    // The README's developer notes, from "Local development" on, talk about the code by its names.
    const read = file === "README.md" ? text.split("\n## Local development")[0] : text;
    return pattern.test(file.endsWith(".md") ? read : stripComments(read));
  });
  check(`"${word}" is not used; it is "${instead}"`, found.length === 0, found.join(", "));
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
