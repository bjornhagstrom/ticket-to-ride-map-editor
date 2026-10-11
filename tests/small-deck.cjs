// The deck builder on a small board (docs/PROPOSAL-SMALL-BOARDS.md): a fourth set of rules, "Small boards", whose targets are what New York and Amsterdam measure
// with every ticket counted, and which is the start on a board under 500 mm. The first part needs no data; the second measures the two small decks in the private
// reference data (it steps aside without it, as tests/ticket-calibration.cjs does).
//
//   npm run test:small-deck
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-small-deck-"));
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/ticket-suggester.ts", "app/map-data.ts", "app/map-storage.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const suggester = require(path.join(out, "ticket-suggester.js"));
const data = require(path.join(out, "map-data.js"));
const storage = require(path.join(out, "map-storage.js"));
const { defaultStyle, deckRules, deckRuleFor, suggestedDeckSize, evaluateTicketDeck, suggestTickets, mulberry32, TICKET_SUGGESTER } = suggester;

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const clone = (value) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------- which rules a map starts on
const standard = clone(data.initialMap);
const smallMap = { ...clone(data.initialMap), format: "board-2x2", panelMm: { width: 214, height: 140 }, orientation: "portrait" };
check("there are four sets of rules of ours, the fourth for small boards", deckRules(standard).slice(0, 4).map((r) => r.id).join() === "generic,classic,europe,small" && deckRuleFor(standard, "small").label === "Small boards");
check("the standard board starts on Generic, as it always has", defaultStyle(standard) === "generic" && defaultStyle({ ...standard, format: "board-2x4" }) === "generic" && defaultStyle({ ...standard, format: "board-3x3" }) === "generic");
check("a board of New York's size starts on Small boards", defaultStyle(smallMap) === "small");
check("and Amsterdam's", defaultStyle({ ...smallMap, panelMm: { width: 214, height: 165 }, orientation: "landscape" }) === "small");
check("a custom size of big panels is not small", defaultStyle({ ...smallMap, panelMm: { width: 263, height: 262 } }) === "generic");
check("a rule the map has chosen wins on a small board too", defaultStyle({ ...smallMap, deckRule: "classic" }) === "classic");
check("the choice of Small boards is kept by a map's file", storage.normalizeMap({ ...clone(standard), deckRule: "small" }).deckRule === "small");
check("a standard map is not changed by there being a fourth set: its default deck size is what it was", (() => { const s = suggestedDeckSize({ ...standard }, "generic", 40); return s.regular === 44 && s.long === 0; })(), JSON.stringify(suggestedDeckSize(standard, "generic", 40)));
const sized = suggestedDeckSize(smallMap, "small", 15);
check("a deck for 15 stops on the small rules is about 20 tickets", sized.regular === 20 && sized.long === 0, JSON.stringify(sized));
check("the numbers quoted beside a small board are there", ["lengthCap", "maxPerStop", "perStop", "dupPct", "unusedPct"].every((key) => Array.isArray(TICKET_SUGGESTER.officialSmall[key]) && TICKET_SUGGESTER.officialSmall[key][0] <= TICKET_SUGGESTER.officialSmall[key][1]));

// ---------------------------------------------------------------- the two small decks
const referencePath = process.env.TTR_REFERENCE_DATA || path.join(root, "..", "ttr-reference-data", "ttr-reference-maps.json");
if (!fs.existsSync(referencePath)) {
  console.log(`Reference data not found at ${referencePath}: the measurement against New York and Amsterdam is skipped.`);
} else {
  const reference = JSON.parse(fs.readFileSync(referencePath, "utf8"));
  const buildMap = (source, panel) => {
    const dropped = new Set(source.stops.filter((stop) => stop.deadEnd || stop.kind === "country" || stop.kind === "country-group").map((stop) => stop.id));
    return {
      name: source.name, format: "board-2x2", panelMm: panel, background: [], notes: [],
      stops: source.stops.filter((stop) => !dropped.has(stop.id)).map((stop, i) => ({ id: stop.id, name: stop.name, type: stop.kind === "waypoint" ? "junction" : "city", x: stop.x ?? i * 10, y: stop.y ?? i * 10 })),
      routes: source.routes.filter((route) => !dropped.has(route.a) && !dropped.has(route.b)).map((route, i) => ({ id: `r-${i}`, a: route.a, b: route.b, length: route.length, type: "city", color: route.color ?? "neutral", locomotiveSlots: [] })),
      lineStyles: [], routeTypeStyles: [{ id: "city", label: "City", stroke: "#736d64", dash: "", strokeWidth: 3, infrastructure: false }], wagonStyles: [],
      stopTypeStyles: [{ id: "city", label: "City", fill: "#fff", stroke: "#000" }, { id: "junction", label: "Junction", fill: "#eee", stroke: "#888", junction: true }],
      tickets: (source.tickets || []).filter((t) => t.a && t.b && !dropped.has(t.a) && !dropped.has(t.b)).map((t, i) => ({ id: `t-${i}`, a: t.a, b: t.b, points: t.points, set: "main" })),
      ticketSets: [{ id: "main", label: "Main deck" }], wagonsPerPlayer: source.trainsPerPlayer, startingTickets: 3, keptTickets: 2, players: { min: 2, max: 4 }, laneRule: source.lanesUsableByPlayers,
    };
  };
  const randomDeck = (map, size, seed, pairs) => {
    const random = mulberry32(seed); const picked = []; const used = new Set();
    while (picked.length < size && used.size < pairs.length) { const pair = pairs[Math.floor(random() * pairs.length)]; const key = pair.join("|"); if (used.has(key)) continue; used.add(key); picked.push({ id: `rand-${picked.length}`, a: pair[0], b: pair[1], points: 1, set: "main" }); }
    return { ...map, tickets: picked };
  };
  for (const [id, panel, beatsRandom] of [["newyork", { width: 214, height: 140 }, true], ["amsterdam", { width: 214, height: 165 }, false]]) {
    const source = reference.maps.find((m) => m.id === id);
    if (!source) { check(`${id} is in the reference data`, false); continue; }
    const map = buildMap(source, panel);
    check(`${id}: the board starts the deck builder on Small boards`, defaultStyle(map) === "small");
    const official = evaluateTicketDeck(map, { setId: "main", atTable: 4 });
    const generic = evaluateTicketDeck(map, { setId: "main", atTable: 4, style: "generic" });
    check(`${id}: on the small rules no ticket of its own deck is left out (on Generic ${generic.skipped} are: they are longer than 47 % of the wagons)`, official.skipped === 0 && generic.skipped > 0, `${official.skipped} against ${generic.skipped}`);
    const randoms = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((seed) => evaluateTicketDeck(randomDeck(map, official.regular + official.long, seed, official.reachablePairs), { setId: "main" }).score).sort((a, b) => a - b);
    const median = (randoms[4] + randoms[5]) / 2;
    // Amsterdam is the known exception: its deck has twice the near-duplicates of the other (10 % against 5), and leans on its double routes more than any other map (5.1 against 2.5); the
    // average of the two cannot describe both. Two maps are a start, not a law.
    check(`${id}: the official deck ${beatsRandom ? "beats" : "does not beat"} random decks on the small rules`, (official.score < median) === beatsRandom, `${official.score.toFixed(1)} against a random median of ${median.toFixed(1)}`);
    for (const seed of [1, 2]) {
      const { tickets, report } = suggestTickets(map, { style: "small", seed, tension: 0 });
      check(`${id}: seed ${seed} suggests a deck that scores under 5, better than the official one`, report.score < 5 && report.score < official.score, `${report.score.toFixed(1)} against ${official.score.toFixed(1)}`);
      const junctions = new Set(map.stops.filter((stop) => stop.type === "junction").map((stop) => stop.id));
      check(`${id}: seed ${seed} never ends a ticket at a junction, and suggests about as many as the map has stops times 1.3`, tickets.every((t) => !junctions.has(t.a) && !junctions.has(t.b)) && Math.abs(tickets.length - 1.3 * map.stops.filter((s) => s.type !== "junction").length) <= 3, `${tickets.length} tickets`);
    }
  }
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
