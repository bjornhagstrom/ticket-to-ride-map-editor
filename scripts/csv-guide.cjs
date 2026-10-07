// Makes app/csv-guide.ts from docs/CSV.md, so the guide that goes into the zip of templates is the page in the
// repository and not a second copy to keep up to date. Run after changing docs/CSV.md (tests/csv-export.cjs
// checks that it was):
//
//   npm run csv-guide
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const guide = fs.readFileSync(path.join(root, "docs", "CSV.md"), "utf8");
fs.writeFileSync(path.join(root, "app", "csv-guide.ts"), `// Written from docs/CSV.md by scripts/csv-guide.cjs (npm run csv-guide). Do not edit it by hand.
export const CSV_GUIDE: string = ${JSON.stringify(guide)};
`);
console.log("app/csv-guide.ts written");
