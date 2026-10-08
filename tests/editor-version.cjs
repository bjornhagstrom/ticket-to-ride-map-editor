// A file says which version of the editor wrote it, and an older editor says so when it opens one from a newer one.
// Written before the check existed.
//
//   npm run test:editor-version
//
// The warning is soft: the file still opens (a file the reader cannot follow is refused by the file's own version,
// docs/FILE-FORMAT.md rule 2). It compares the editor's version numbers part by part, so 1.10.0 is newer than 1.9.0,
// and it stays quiet when the file has no version, a version that is not a number, or one that is the same or older.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-editor-version-"));
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/version.ts", "app/map-storage.ts", "app/map-data.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--esModuleInterop"], { cwd: root, stdio: "pipe" });
const { newerEditor, APP_VERSION } = require(path.join(out, "version.js"));
const storage = require(path.join(out, "map-storage.js"));
const { initialMap } = require(path.join(out, "map-data.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };

check("a newer minor version is newer", newerEditor("1.3.0", "1.2.0") === true);
check("a newer patch version is newer", newerEditor("1.2.1", "1.2.0") === true);
check("a newer major version is newer", newerEditor("2.0.0", "1.9.9") === true);
check("the parts are numbers, not text: 1.10.0 is newer than 1.9.0", newerEditor("1.10.0", "1.9.0") === true && newerEditor("1.9.0", "1.10.0") === false);
check("the same version is not newer", newerEditor("1.2.0", "1.2.0") === false);
check("an older version is not newer", newerEditor("1.1.9", "1.2.0") === false && newerEditor("0.4.1", "1.2.0") === false);
check("a pre-release suffix is left out of the comparison", newerEditor("1.3.0-beta.1", "1.2.0") === true && newerEditor("1.2.0-beta.1", "1.2.0") === false);
check("no version, an empty one or one that is not a number say nothing", [undefined, null, "", "x", "1.x", 5, {}, [], "1.2"].every((v) => newerEditor(v, "1.2.0") === false), JSON.stringify([undefined, null, "", "x"]));
check("with no second argument it is this build that is compared with", newerEditor("999.0.0") === true && newerEditor(APP_VERSION) === false);

// The file carries it, and reading gives it back.
const own = storage.normalizeMap(JSON.parse(JSON.stringify(initialMap)));
const written = storage.writeMapFile("map", storage.mapPayload(own), own);
const read = storage.readMapFile(JSON.parse(JSON.stringify(written)));
check("a file this build writes says which version wrote it", written.app && written.app.version === APP_VERSION, JSON.stringify(written.app));
check("and reading it gives that version back", read.app && read.app.version === APP_VERSION, JSON.stringify(read.app));
const other = JSON.parse(JSON.stringify(written)); other.app = { name: "Map prototypes", version: "99.1.0" };
check("a file from a newer editor still opens: the version is a note, not a lock", storage.readMapFile(other).app.version === "99.1.0" && storage.readMapFile(other).payload.stops.length === initialMap.stops.length);
const noApp = JSON.parse(JSON.stringify(written)); delete noApp.app;
check("a file with no app block reads, with no version", storage.readMapFile(noApp).app === undefined);
const oddApp = JSON.parse(JSON.stringify(written)); oddApp.app = "nonsense";
check("a file whose app block is not an object reads, with no version", storage.readMapFile(oddApp).app === undefined);
const flat = storage.readMapFile({ kind: "map", ...JSON.parse(JSON.stringify(initialMap)) });
check("a version 1 file, which has no envelope, has no version", flat.app === undefined);

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
