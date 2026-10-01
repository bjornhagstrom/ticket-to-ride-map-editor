// The licence. The code is MIT-licensed, and the one piece of someone else's work in the repository
// keeps its own licence.
//
//   npm run test:license
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => (fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), "utf8") : "");
const pkg = JSON.parse(read("package.json"));
const licence = read("LICENSE");
const readme = read("README.md");

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };

check("there is a LICENSE file", licence.length > 500);
check("it is the MIT licence", /^MIT License\s*\n/.test(licence) && /Permission is hereby granted, free of charge, to any person obtaining a copy/.test(licence) && /THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND/.test(licence));
check("it names the owner and the year", /^Copyright \(c\) 2026 Björn Hagström$/m.test(licence), (licence.match(/^Copyright.*$/m) || [""])[0]);
check("it requires the notice to stay with copies", /The above copyright notice and this permission notice shall be included in all\s+copies or substantial portions of the Software\./.test(licence));
check("the package says MIT, in the SPDX way", pkg.license === "MIT", String(pkg.license));
check("the README says what the licence covers, and what it does not", /MIT/.test(readme) && /not the Ticket to Ride game/i.test(readme));
check("the README points to the file", /\[LICENSE\]\(LICENSE\)/.test(readme));
check("shadcn's own licence for the CSS in vendor/ is still there", /MIT License/.test(read("vendor/shadcn-tailwind-4.13.0.LICENSE.md")) && /shadcn/.test(read("vendor/shadcn-tailwind-4.13.0.LICENSE.md")));

console.log(`${ok.length} passed, ${bad.length} failed`);
if (bad.length) { console.log("FAIL:"); for (const b of bad) console.log("  ✗ " + b); }
process.exit(bad.length ? 1 : 0);
