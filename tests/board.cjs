// A board that lies or stands. Written before app/board.ts existed.
//
//   npm run test:board
//
// The board's orientation is a property of the map, chosen beside its format. Its long side is always
// 1100 map units, so turning a board a quarter turn moves everything on it without changing a single
// distance: wagons, spacing and every analysis stay as they were. Turning it back gives back exactly
// the map that was turned.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-board-"));
execFileSync("npx", ["tsc", "app/board.ts", "app/map-data.ts", "app/map-storage.ts",
  "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"],
  { cwd: root, stdio: "inherit" });
const board = require(path.join(out, "board.js"));
const storage = require(path.join(out, "map-storage.js"));
const { initialMap, mapFormats, W } = require(path.join(out, "map-data.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------- the board's size
{
  const lying = board.boardOf({ format: "board-2x3" });
  const standing = board.boardOf({ format: "board-2x3", orientation: "portrait" });
  check("a map without an orientation lies, as every map did before", lying.orientation === "landscape" && lying.width === W && lying.height === mapFormats["board-2x3"].height);
  check("a standing 2×3 board is the lying one turned: 731 × 1100 units, 525 × 790 mm", standing.width === mapFormats["board-2x3"].height && standing.height === W && standing.widthMm === 525 && standing.heightMm === 790, JSON.stringify(standing));
  check("and its panels are 2 across and 3 down", standing.columns === 2 && standing.rows === 3);
  const tall = board.boardOf({ format: "board-2x4", orientation: "portrait" });
  check("a standing 2×4 board is 526 × 1053 mm, 2 panels across and 4 down", tall.widthMm === 526 && tall.heightMm === 1053 && tall.columns === 2 && tall.rows === 4, JSON.stringify(tall));
  check("one map unit is the same length in millimetres either way", near(standing.widthMm / standing.width, lying.widthMm / lying.width, 1e-3));
  check("an orientation that is not known is read as lying", board.boardOf({ format: "board-2x3", orientation: "sideways" }).orientation === "landscape");
}

// ---------------------------------------------------------------- turning a map
const map = storage.normalizeMap(clone(initialMap));
// Give the example a note, a background image and a few set label angles, so every kind of thing on a board is turned.
map.notes = [...(map.notes || []), { id: "n-test", x: 300, y: 200, width: 200, height: 90, text: "Upright" }, { id: "n-edge", x: 20, y: 30, width: 260, height: 90, text: "In a corner" }];
map.backgroundImage = { dataUrl: "data:image/png;base64,AAAA", naturalWidth: 400, naturalHeight: 300, x: 100, y: 120, width: 400, height: 300, rotation: 10, opacity: .5, crop: { top: 0, right: 0, bottom: 0, left: 0 } };
map.stops[0].labelAngle = 0; map.stops[1].labelAngle = 300;
const turned = board.rotateMap(clone(map), "portrait");
const back = board.rotateMap(clone(turned), "landscape");
const size = board.boardOf(turned);
check("turned, the map stands", turned.orientation === "portrait" && size.width < size.height);
check("turned back, it lies again and says nothing about standing", back.orientation === undefined || back.orientation === "landscape");
const inside = (p, b, pad = 0) => p.x >= -pad && p.x <= b.width + pad && p.y >= -pad && p.y <= b.height + pad;
check("every stop is on the standing board", turned.stops.every((s) => inside(s, size)));
check("a quarter turn clockwise: a stop at (x, y) stands at (731 − y, x)", map.stops.every((s, i) => near(turned.stops[i].x, mapFormats["board-2x3"].height - s.y) && near(turned.stops[i].y, s.x)), JSON.stringify([map.stops[0], turned.stops[0]].map((s) => [s.x, s.y])));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
check("no distance between two stops changes", map.stops.every((a, i) => map.stops.every((b, j) => near(dist(a, b), dist(turned.stops[i], turned.stops[j])))));
check("route bends turn with their routes", map.routes.every((r, i) => (r.points || []).every((p, k) => near(turned.routes[i].points[k].x, mapFormats["board-2x3"].height - p.y) && near(turned.routes[i].points[k].y, p.x))));
check("background shapes and their label points turn", map.background.every((shape, i) => shape.points.every((p, k) => near(turned.background[i].points[k].y, p.x)) && (!shape.labelPoint || near(turned.background[i].labelPoint.y, shape.labelPoint.x))));
check("a name set at an angle turns with its stop: right becomes below", turned.stops[0].labelAngle === 90 && turned.stops[1].labelAngle === 30, `${turned.stops[0].labelAngle}, ${turned.stops[1].labelAngle}`);
check("a name left to place itself is still left to place itself", map.stops.every((s, i) => s.labelAngle !== undefined || turned.stops[i].labelAngle === undefined));
const note = turned.notes.find((n) => n.id === "n-test"), before = map.notes.find((n) => n.id === "n-test");
check("a note keeps its size and stays upright, its middle where the turn takes it", note.width === before.width && note.height === before.height && near(note.x + note.width / 2, mapFormats["board-2x3"].height - (before.y + before.height / 2)) && near(note.y + note.height / 2, before.x + before.width / 2), JSON.stringify(note));
check("a note that the turn would push past the edge is kept on the board", turned.notes.every((n) => n.x >= 0 && n.y >= 0 && n.x + n.width <= size.width + 1e-9 && n.y + n.height <= size.height + 1e-9), JSON.stringify(turned.notes.find((n) => n.id === "n-edge")));
const image = turned.backgroundImage;
check("the background image turns with the map: its middle moves, it turns 90°, its size stays", image.width === 400 && image.height === 300 && image.rotation === 100 && near(image.x + 200, mapFormats["board-2x3"].height - (120 + 150)) && near(image.y + 150, 100 + 200), JSON.stringify(image));
const same = (a, b) => JSON.stringify(a, (k, v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v));
// Everything but a note that had to be kept on the board; Undo, not a second turn, is how to get that back.
// The example's own note sits near the top edge, so it is one of them.
const kept = (n) => { const t = turned.notes.find((x) => x.id === n.id); return near(t.x + t.width / 2, mapFormats["board-2x3"].height - (n.y + n.height / 2)) && near(t.y + t.height / 2, n.x + n.width / 2); };
const withoutEdge = (m) => ({ ...m, orientation: undefined, notes: m.notes.filter((n) => kept(map.notes.find((x) => x.id === n.id))) });
check("a note away from the edges is back exactly where it was", kept(map.notes.find((n) => n.id === "n-test")) && same(back.notes.find((n) => n.id === "n-test")) === same(map.notes.find((n) => n.id === "n-test")));
check("turned and turned back, it is the map it was, to the last coordinate", same(withoutEdge(back)) === same(withoutEdge(map)), "");
check("turning a map to the way it already lies changes nothing", same(board.rotateMap(clone(map), "landscape")) === same(map));
check("tickets, decks, styles and rules do not move", same(turned.tickets) === same(map.tickets) && same(turned.routeTypeStyles) === same(map.routeTypeStyles) && turned.rules === map.rules);

// ---------------------------------------------------------------- a standing map in a file
{
  const file = storage.writeMapFile("map", storage.mapPayload(turned), turned);
  check("a standing map's file gives its board frame standing", file.board.width === size.width && file.board.height === size.height, JSON.stringify(file.board));
  check("and is version 4, so an editor that cannot stand a board refuses it rather than lays it down wrong", file.version === 4, String(file.version));
  const lyingFile = storage.writeMapFile("map", storage.mapPayload(map), map);
  check("a lying map's file stays version 3, so older editors still open it", lyingFile.version === 3, String(lyingFile.version));
  const read = storage.normalizeMap(storage.readMapFile(JSON.parse(JSON.stringify(file))).payload);
  check("read back, it stands, every stop where it was", read.orientation === "portrait" && read.stops.every((s, i) => near(s.x, turned.stops[i].x) && near(s.y, turned.stops[i].y)));
  // A network from a standing map, brought into a lying one: turned to lie, then on the board.
  const network = storage.writeMapFile("network", storage.networkPayload(turned), turned);
  const brought = storage.normalizeNetworkFile(storage.readMapFile(JSON.parse(JSON.stringify(network))).payload, board.boardOf(map));
  check("a network from a standing map is laid down when brought into a lying one", brought.stops.every((s, i) => near(s.x, map.stops[i].x) && near(s.y, map.stops[i].y)), JSON.stringify([brought.stops[0], map.stops[0]].map((s) => [s.x, s.y])));
  const upright = storage.normalizeNetworkFile(storage.readMapFile(JSON.parse(JSON.stringify(storage.writeMapFile("network", storage.networkPayload(map), map)))).payload, size);
  check("and one from a lying map is stood up when brought into a standing one", upright.stops.every((s, i) => near(s.x, turned.stops[i].x) && near(s.y, turned.stops[i].y)));
  const background = storage.normalizeBackgroundFile(storage.readMapFile(JSON.parse(JSON.stringify(storage.writeMapFile("background", { format: map.format, background: map.background, backgroundImage: map.backgroundImage }, map)))).payload, size);
  check("a background from a lying map is stood up too, its image with it", background.background.every((shape, i) => shape.points.every((p, k) => near(p.x, turned.background[i].points[k].x) && near(p.y, turned.background[i].points[k].y))) && background.backgroundImage.rotation === 100);
}

// ---------------------------------------------------------------- a standing map changes format
{
  const wider = storage.rescaleMapToFormat(clone(turned), "board-2x4");
  const b = board.boardOf(wider);
  check("a standing map moved to 2×4 still stands, on the taller board", wider.orientation === "portrait" && b.width === mapFormats["board-2x4"].height && b.height === W);
  check("with every stop on it", wider.stops.every((s) => inside(s, b)));
  const direct = board.rotateMap(storage.rescaleMapToFormat(clone(map), "board-2x4"), "portrait");
  check("and in the same place as when the lying map is moved first and then stood up", wider.stops.every((s, i) => near(s.x, direct.stops[i].x) && near(s.y, direct.stops[i].y)));
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
