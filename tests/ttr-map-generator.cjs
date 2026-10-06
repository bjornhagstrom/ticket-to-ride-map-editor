// The export for ttr-map-generator (the open source Python tool, later in the production chain): three
// text files, locations, paths and tasks, in the format its own reader takes. Checked here against the
// rules the reader sets, and, when the tool is on this machine, by reading the files with its own code.
// Written before the export existed.
//
//   npm run test:ttr-map-generator
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-generator-"));
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/ttr-map-generator-export.ts", "app/map-analysis.ts", "app/map-data.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const { generatorFiles, generatorZip } = require(path.join(out, "ttr-map-generator-export.js"));
const { initialMap, problemMap } = require(path.join(out, "map-data.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const COLOURS = ["green", "red", "blue", "yellow", "orange", "purple", "black", "gray", "grey", "white"];
const lines = (text) => text.split("\n").filter((l) => l.length > 0);

for (const [label, map] of [["the example map", initialMap], ["the example map with problems", problemMap]]) {
  const files = generatorFiles(map);
  const locations = lines(files.locations);
  const infra = new Set(map.routeTypeStyles.filter((s) => s.infrastructure).map((s) => s.id));
  const buildable = map.routes.filter((r) => !infra.has(r.type));
  check(`${label}: one location per line, one for every stop`, locations.length === map.stops.length, `${locations.length} of ${map.stops.length}`);
  check(`${label}: no location is named twice, none is empty or padded`, new Set(locations).size === locations.length && locations.every((l) => l === l.trim() && l.length > 0));
  const paths = lines(files.paths).map((l) => l.split(" ; "));
  check(`${label}: one path per lane, as the reader splits it: place ; place ; length ; colour`, paths.length === buildable.length && paths.every((p) => p.length === 4), `${paths.length} of ${buildable.length}`);
  check(`${label}: both ends are locations in the file`, paths.every((p) => locations.includes(p[0]) && locations.includes(p[1])));
  check(`${label}: the length is a whole number from 1 up, and the colour one the tool knows`, paths.every((p) => /^[1-9]\d*$/.test(p[2]) && COLOURS.includes(p[3])), paths.map((p) => p[3]).filter((c) => !COLOURS.includes(c)).join(", "));
  check(`${label}: the lengths and colours are the map's own`, buildable.every((r, i) => Number(paths[i][2]) === r.length && paths[i][3] === (r.color === "neutral" ? "grey" : r.color)));
  const tasks = lines(files.tasks).map((l) => l.split(" ; "));
  check(`${label}: one task per ticket, place ; place`, tasks.length === map.tickets.length && tasks.every((t) => t.length === 2 && locations.includes(t[0]) && locations.includes(t[1])), `${tasks.length} of ${map.tickets.length}`);
  check(`${label}: nothing a Windows editor would mangle: plain newlines, no byte order mark`, !/\r|^﻿/.test(files.locations + files.paths + files.tasks));
}

// What the map has that the tool has no place for is said, not silently dropped.
const odd = generatorFiles(problemMap);
check("it says what the tool has no place for: tunnels, ferries and locomotive spaces become plain routes, ticket points are worked out again, the background and the styles stay behind", Array.isArray(odd.notes) && odd.notes.length === 3 && odd.notes.every((n) => typeof n === "string" && n.length > 10) && /tunnel/.test(odd.notes[0]) && /Ticket points/.test(odd.notes[1]) && /background/.test(odd.notes[2]) && !odd.notes.some((n) => /Positions/.test(n)), JSON.stringify(odd.notes));

// Names that would break the format are made safe, and stay distinct.
const tricky = { ...initialMap, stops: initialMap.stops.slice(0, 3).map((s, i) => ({ ...s, name: ["Same", "Same", "Has ; semicolon"][i] })), routes: [{ ...initialMap.routes[0], a: initialMap.stops[0].id, b: initialMap.stops[1].id }, { ...initialMap.routes[0], id: "t2", a: initialMap.stops[1].id, b: initialMap.stops[2].id }], tickets: [] };
const t = generatorFiles(tricky);
const tl = lines(t.locations);
check("two stops with one name stay two locations, and a name with ' ; ' in it does not split a line", new Set(tl).size === 3 && !tl.some((l) => l.includes(" ; ")) && lines(t.paths).every((l) => l.split(" ; ").length === 4), tl.join(" | "));
check("a name with a line break in it is written as the tool reads it, \\n", generatorFiles({ ...tricky, stops: tricky.stops.map((s, i) => (i === 0 ? { ...s, name: "Two\nlines" } : s)) }).locations.split("\n")[0] === "Two\\nlines");
check("an empty map gives empty files and no error", (() => { const e = generatorFiles({ ...initialMap, stops: [], routes: [], tickets: [] }); return e.locations === "" && e.paths === "" && e.tasks === ""; })());

// Positions: in centimetres on the board, y pointing up as the tool's plots do (ours points down).
{
  const files = generatorFiles(initialMap);
  const placed = JSON.parse(files.positions);
  const [w, h] = placed.board;
  check("positions come with the board's size in centimetres: 79 × 52.5 for the standard board", placed.unit === "cm" && Math.abs(w - 79) < 0.1 && Math.abs(h - 52.5) < 0.1, JSON.stringify(placed.board));
  const names = lines(files.locations);
  check("every location has a position on the board", names.every((n) => Array.isArray(placed.positions[n]) && placed.positions[n].length === 2 && placed.positions[n].every(Number.isFinite) && placed.positions[n][0] >= 0 && placed.positions[n][0] <= w && placed.positions[n][1] >= 0 && placed.positions[n][1] <= h));
  const westport = initialMap.stops.find((s) => s.name === "Westport");
  const eastgate = initialMap.stops.find((s) => s.name === "Eastgate");
  check("left stays left and the north end is the high y: Westport is left of Eastgate, and north of Fernside by y", placed.positions.Westport[0] < placed.positions.Eastgate[0] && westport.y < initialMap.stops.find((s) => s.name === "Fernside").y && placed.positions.Westport[1] > placed.positions.Fernside[1]);
  check("the scale is the board's: a stop's x in centimetres is its x in board units over the width, times 79", Math.abs(placed.positions.Eastgate[0] - eastgate.x / 1100 * 79) < 0.05, `${placed.positions.Eastgate[0]}`);
}

// One zip with everything: the three text files, the positions, the script and a note on how to use them.
const zip = generatorZip(initialMap);
check("one zip file, as bytes", zip instanceof Uint8Array && zip.length > 500 && zip[0] === 0x50 && zip[1] === 0x4b);
const toolRoot = process.env.TTR_MAP_GENERATOR || path.join(root, "..", "Test open source ttr editor", "ttr-map-generator");
const python = path.join(toolRoot, ".venv", "bin", "python");
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-generator-zip-"));
  fs.writeFileSync(path.join(dir, "bundle.zip"), zip);
  let listing = null, bad = "";
  try {
    listing = JSON.parse(execFileSync("python3", ["-c", `import zipfile, json\nz = zipfile.ZipFile(${JSON.stringify(path.join(dir, "bundle.zip"))})\nprint(json.dumps({"bad": z.testzip(), "names": z.namelist(), "locations": z.read("locations.txt").decode("utf-8")}))`], { encoding: "utf8" }));
  } catch (e) { bad = String(e.stderr || e.message).slice(0, 200); }
  const files = generatorFiles(initialMap);
  check("the zip is a sound zip with the six files named as the script expects", listing && listing.bad === null && JSON.stringify(listing.names) === JSON.stringify(["locations.txt", "paths.txt", "tasks.txt", "positions.json", "make_graph.py", "README.txt"]), bad || JSON.stringify(listing && listing.names));
  check("and what is in it is what the three files hold", listing && listing.locations === files.locations);
  if (fs.existsSync(python)) {
    execFileSync("python3", ["-c", `import zipfile; zipfile.ZipFile(${JSON.stringify(path.join(dir, "bundle.zip"))}).extractall(${JSON.stringify(dir)})`]);
    let made = null, error = "";
    try {
      execFileSync(python, [path.join(dir, "make_graph.py"), path.join(toolRoot, "src", "ttr_map_maker"), path.join(dir, "graph.json")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      made = JSON.parse(execFileSync(python, ["-c", `import sys, json\nsys.path.insert(0, ${JSON.stringify(path.join(toolRoot, "src", "ttr_map_maker"))})\nfrom ttr_particle_graph import TTR_Particle_Graph\ng = TTR_Particle_Graph.load_json(${JSON.stringify(path.join(dir, "graph.json"))})\nd = json.load(open(${JSON.stringify(path.join(dir, "graph.json"))}))\nnodes = {p["location_name"]: p["position"] for p in d["particle_graph"]["particles"] if p["particle_type"] == "Particle_Node"}\nprint(json.dumps({"locations": len(g.get_locations()), "paths": len(g.get_paths()), "size": d["project_setup"]["bg_image_size"], "nodes": nodes}))`], { encoding: "utf8" }).trim().split("\n").pop());
    } catch (e) { error = String(e.stderr || e.message).slice(0, 300); }
    check("the script makes a graph with the tool's own code, and the tool loads it back: every location and path", made && made.locations === initialMap.stops.length && made.paths === initialMap.routes.length, error || JSON.stringify(made && { l: made.locations, p: made.paths }));
    check("on a board of the right size", made && Math.abs(made.size[0] - 79) < 0.1 && Math.abs(made.size[1] - 52.5) < 0.1, JSON.stringify(made && made.size));
    const placed = JSON.parse(files.positions);
    check("with the nodes where the map has them", made && Object.entries(placed.positions).every(([n, xy]) => made.nodes[n] && Math.abs(made.nodes[n][0] - xy[0]) < 0.5 && Math.abs(made.nodes[n][1] - xy[1]) < 0.5), made ? JSON.stringify(Object.entries(placed.positions).filter(([n, xy]) => !made.nodes[n] || Math.abs(made.nodes[n][0] - xy[0]) >= 0.5).slice(0, 2)) : error);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// The tool's own reader, when the tool is here: read_locations, read_paths and read_tasks must agree.
if (fs.existsSync(python) && fs.existsSync(path.join(toolRoot, "src", "ttr_map_maker", "read_ttr_files.py"))) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-generator-files-"));
  for (const [label, map] of [["example", initialMap], ["problems", problemMap]]) {
    const files = generatorFiles(map);
    for (const [name, text] of Object.entries(files)) if (typeof text === "string") fs.writeFileSync(path.join(dir, `${label}-${name}.txt`), text);
    const infra = new Set(map.routeTypeStyles.filter((s) => s.infrastructure).map((s) => s.id));
    const script = `import sys, json\nsys.path.insert(0, ${JSON.stringify(path.join(toolRoot, "src", "ttr_map_maker"))})\nimport read_ttr_files as r\nd = ${JSON.stringify(dir)}\nl = r.read_locations(d + "/${label}-locations.txt")\np = r.read_paths(d + "/${label}-paths.txt")\nt = r.read_tasks(d + "/${label}-tasks.txt")\nprint(json.dumps({"locations": len(l), "paths": len(p), "tasks": len(t), "colours": sorted(set(x[3] for x in p)), "ends_ok": all(x[0] in l and x[1] in l for x in p)}))\n`;
    let result = null, error = "";
    try { result = JSON.parse(execFileSync(python, ["-c", script], { encoding: "utf8" }).trim().split("\n").pop()); } catch (e) { error = String(e.stderr || e.message).slice(0, 200); }
    const tickets = new Set(map.tickets.map((x) => [x.a, x.b].map((id) => map.stops.find((s) => s.id === id).name).join(" ; ")));
    check(`its own reader takes the files of ${label}: ${map.stops.length} locations, ${map.routes.filter((r) => !infra.has(r.type)).length} paths`, result && result.locations === map.stops.length && result.paths === map.routes.filter((r) => !infra.has(r.type)).length && result.ends_ok, error || JSON.stringify(result));
    check(`and its tasks are the tickets, the same pair counting once in the tool`, result && result.tasks > 0 && result.tasks <= map.tickets.length, error || String(result && result.tasks));
  }
  fs.rmSync(dir, { recursive: true, force: true });
} else {
  console.log(`ttr-map-generator not found at ${toolRoot}: the check with its own reader is skipped (set TTR_MAP_GENERATOR).`);
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
