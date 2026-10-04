// A version number for every print and export in which the map has changed. Written before
// app/map-version.ts existed.
//
//   npm run test:map-version
//
// One series of numbers for every way a map leaves the editor: printed, exported as a file, saved as
// an image. A print or export of a map that has not changed since the last one keeps its number; one
// that has changed gets the next. The number is stored in the map file as `mapVersion`, an addition to
// the format: older files open without it and start at 1, and an older build keeps it untouched
// (docs/FILE-FORMAT.md, rule 3) — checked here against the build on origin/main, which the live site
// runs, when that branch is at hand.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-map-version-"));
const tsc = (cwd, files, dir) => execFileSync(path.join(root, "node_modules", ".bin", "tsc"), [...files, "--outDir", dir, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd, stdio: "inherit" });
tsc(root, ["app/map-version.ts", "app/map-storage.ts", "app/map-data.ts"], out);
const version = require(path.join(out, "map-version.js"));
const storage = require(path.join(out, "map-storage.js"));
const { initialMap, emptyMap } = require(path.join(out, "map-data.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const day = (n) => new Date(Date.UTC(2026, 9, n, 12));

// ---------------------------------------------------------------- one series, bumped only by a change
let map = storage.normalizeMap(clone(initialMap));
check("a map that has never left the editor has no version", version.versionStatus(map).number === undefined && map.mapVersion === undefined);
let issued = version.issueVersion(map, "print", day(4));
check("its first print is version 1", issued.number === 1 && issued.bumped && issued.data.mapVersion.number === 1, JSON.stringify(issued.data.mapVersion));
check("the version log says when and how", issued.data.mapVersion.issued.length === 1 && issued.data.mapVersion.issued[0].by === "print" && issued.data.mapVersion.issued[0].date.startsWith("2026-10-04"), JSON.stringify(issued.data.mapVersion.issued));
map = issued.data;
issued = version.issueVersion(map, "export", day(5));
check("printing or exporting it again unchanged keeps the number", issued.number === 1 && !issued.bumped && issued.data === map);
check("and adds nothing to the log", map.mapVersion.issued.length === 1);
check("its status says unchanged", version.versionStatus(map).changed === false && version.versionStatus(map).number === 1);
const renamed = clone(map); renamed.stops[0].name = "Renamed";
check("a change shows in the status, with the number the next print will get", version.versionStatus(renamed).changed === true && version.versionStatus(renamed).next === 2);
issued = version.issueVersion(renamed, "export", day(6));
check("an export after a change is the next number: one series for prints and exports", issued.number === 2 && issued.bumped && issued.data.mapVersion.issued.at(-1).by === "export");
const image = clone(issued.data); image.routes[0].length += 1;
check("and so is a saved image after another change", version.issueVersion(image, "image", day(7)).number === 3);
const undone = clone(issued.data); undone.stops[0].name = "Changed for a moment"; undone.stops[0].name = "Renamed";
check("a change that was undone again is no change", version.issueVersion(undone, "print", day(8)).number === 2);

// ---------------------------------------------------------------- what the fingerprint sees
const base = storage.normalizeMap(clone(initialMap));
const fp = version.fingerprint(base);
check("the fingerprint is a short string", typeof fp === "string" && /^[0-9a-f]{8}$/.test(fp), fp);
check("the version record itself is not part of it", version.fingerprint({ ...base, mapVersion: { number: 9, fingerprint: "x", issued: [] } }) === fp);
const reordered = Object.fromEntries(Object.entries(clone(base)).reverse());
reordered.stops = reordered.stops.map((stop) => Object.fromEntries(Object.entries(stop).reverse()));
check("nor the order of the fields", version.fingerprint(reordered) === fp);
const withImage = { ...clone(base), backgroundImage: { dataUrl: "data:image/png;base64," + "A".repeat(200000) + "END1", x: 0, y: 0, width: 100, height: 100, opacity: 1 } };
const otherImage = { ...withImage, backgroundImage: { ...withImage.backgroundImage, dataUrl: withImage.backgroundImage.dataUrl.replace("END1", "END2") } };
check("a different background image is a change", version.fingerprint(withImage) !== version.fingerprint(otherImage));

// ---------------------------------------------------------------- in the file
const fileMap = version.issueVersion(storage.normalizeMap(clone(initialMap)), "export", day(4)).data;
const file = JSON.parse(JSON.stringify(storage.writeMapFile("map", storage.mapPayload(fileMap), fileMap)));
check("the number is written in the map file", file.payload.mapVersion && file.payload.mapVersion.number === 1);
check("as an addition: the file version does not move", file.version === 3, String(file.version));
const back = storage.normalizeMap(storage.readMapFile(file).payload);
check("and read back with it", back.mapVersion && back.mapVersion.number === 1 && back.mapVersion.fingerprint === fileMap.mapVersion.fingerprint && !(back.unknown && back.unknown.mapVersion));
check("a map read back unchanged is not changed", version.versionStatus(back).changed === false);
const grown = clone(file); grown.payload.mapVersion.reviewer = "added by a later build"; grown.payload.mapVersion.issued[0].note = "kept too";
const grownBack = storage.normalizeMap(storage.readMapFile(grown).payload);
check("fields a later build adds to it survive", grownBack.mapVersion.reviewer === "added by a later build" && grownBack.mapVersion.issued[0].note === "kept too");
for (const [label, broken] of [["a number that is not a whole number above 0", { number: -2, fingerprint: "ab", issued: [] }], ["a string", "v8"], ["no fingerprint", { number: 3, issued: [] }]]) {
  const read = storage.normalizeMap({ ...clone(initialMap), mapVersion: broken });
  check(`a broken version record (${label}) is dropped, not trusted`, read.mapVersion === undefined, JSON.stringify(read.mapVersion));
}
const badLog = storage.normalizeMap({ ...clone(initialMap), mapVersion: { number: 4, fingerprint: "ab12cd34", issued: [{ number: 4, date: "2026-10-04T10:00:00.000Z", by: "print" }, "junk", { number: "x" }] } });
check("log entries that make no sense are left out, the rest kept", badLog.mapVersion && badLog.mapVersion.number === 4 && badLog.mapVersion.issued.length === 1, JSON.stringify(badLog.mapVersion));

// ---------------------------------------------------------------- older files in this build
const legacy1 = { kind: "map", ...clone(initialMap) };
const v3 = clone(storage.writeMapFile("map", storage.mapPayload(storage.normalizeMap(clone(initialMap))), initialMap)); delete v3.payload.mapVersion;
const v4map = storage.normalizeMap({ ...clone(initialMap), orientation: "portrait" });
const v4 = clone(storage.writeMapFile("map", storage.mapPayload(v4map), v4map));
for (const [label, raw, want] of [["a version 1 file (no envelope)", legacy1, 1], ["a version 3 file", v3, 3], ["a version 4 file (a standing board)", v4, 4]]) {
  const read = storage.readMapFile(raw);
  const opened = storage.normalizeMap(read.payload);
  check(`${label} opens without a version, and its first print is version 1`, read.version === want && opened.mapVersion === undefined && version.issueVersion(opened, "print", day(4)).number === 1, `version ${read.version}`);
}

// ---------------------------------------------------------------- an older copy brought in
const current = { ...clone(initialMap), mapVersion: { number: 8, fingerprint: "11111111", issued: [] } };
const older = { ...clone(initialMap), mapVersion: { number: 5, fingerprint: "22222222", issued: [] } };
const warning = version.olderCopyWarning(current, older);
check("bringing in a copy with a lower number than the map it replaces warns", typeof warning === "string" && /5/.test(warning) && /8/.test(warning), String(warning));
check("and suggests a new name so the two series cannot be mixed up", /rename|new name/i.test(warning) && warning.includes(initialMap.name), String(warning));
check("a copy with the same or a higher number does not warn", version.olderCopyWarning(current, { ...older, mapVersion: { ...older.mapVersion, number: 8 } }) === null && version.olderCopyWarning(current, { ...older, mapVersion: { ...older.mapVersion, number: 9 } }) === null);
check("nor does a copy of another map, or one without a number", version.olderCopyWarning(current, { ...older, name: "Another map" }) === null && version.olderCopyWarning(current, clone(initialMap)) === null);

// ---------------------------------------------------------------- the playtest box
const box = version.playtestNote(storage.normalizeMap(clone(initialMap)));
check("the playtest box is a note of its own kind", box.kind === "playtest" && typeof box.id === "string" && box.width > 0 && box.height > 0);
check("whose text says what to write, for a build that does not know the kind", /Played/.test(box.text) && /back/.test(box.text), box.text);
const crowded = storage.normalizeMap(clone(initialMap));
const inside = (b, p) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
check("it is placed where no stop is", !crowded.stops.some((stop) => inside(box, stop)), JSON.stringify(box));
const labelOf = (shape) => shape.labelPoint ?? { x: shape.points.reduce((t, p) => t + p.x, 0) / shape.points.length, y: shape.points.reduce((t, p) => t + p.y, 0) / shape.points.length };
check("nor over the name of a background shape", !crowded.background.filter((shape) => shape.label && shape.points.length).some((shape) => inside({ x: box.x - 20, y: box.y - 20, width: box.width + 40, height: box.height + 40 }, labelOf(shape))), crowded.background.map((shape) => `${shape.label} ${JSON.stringify(labelOf(shape))}`).join("; "));
check("in the top right corner when it is free, as the owner wants it", box.x + box.width >= 1100 - 20 && box.y <= 24, JSON.stringify(box));
check("and over no other note", !crowded.notes.some((note) => note.x < box.x + box.width && box.x < note.x + note.width && note.y < box.y + box.height && box.y < note.y + note.height));

// ---------------------------------------------------------------- through the build the live site runs
const liveDir = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-live-build-"));
let live = null;
try {
  execFileSync("sh", ["-c", `git archive origin/main app | tar -x -C ${liveDir}`], { cwd: root, stdio: "pipe" });
  tsc(liveDir, ["app/map-storage.ts", "app/map-data.ts"], path.join(liveDir, "out"));
  live = require(path.join(liveDir, "out", "map-storage.js"));
} catch { console.log("origin/main is not at hand: the round trip through the live build is skipped."); }
if (live) {
  const ours = version.issueVersion(storage.normalizeMap({ ...clone(initialMap), notes: [...clone(initialMap).notes, version.playtestNote(storage.normalizeMap(clone(initialMap)))] }), "export", day(4)).data;
  const sent = JSON.parse(JSON.stringify(storage.writeMapFile("map", storage.mapPayload(ours), ours)));
  const opened = live.normalizeMap(live.readMapFile(sent).payload);
  check("the live build opens a file with a version number", opened.stops.length === ours.stops.length);
  const edited = clone(opened); edited.stops[0].name = "Edited in the live build";
  const returned = JSON.parse(JSON.stringify(live.writeMapFile("map", live.mapPayload(edited), edited)));
  check("and writes the number back untouched", returned.payload.mapVersion && returned.payload.mapVersion.number === 1 && returned.payload.mapVersion.fingerprint === ours.mapVersion.fingerprint, JSON.stringify(returned.payload.mapVersion));
  check("and the playtest box too, kind and all", returned.payload.notes.some((note) => note.kind === "playtest"));
  const home = storage.normalizeMap(storage.readMapFile(returned).payload);
  check("back here, the edit made there counts as a change: the next print is version 2", version.versionStatus(home).changed && version.issueVersion(home, "print", day(5)).number === 2);
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(liveDir, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
