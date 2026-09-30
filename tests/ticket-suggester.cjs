// Acceptance checks for the destination-ticket suggester, against the official USA and Europe decks
// in the private reference data (ttr-reference-maps.json). The targets come from docs/TICKET-SUGGESTER.md §6.
//
//   npm run test:suggester
//
// The module is plain logic, so it is compiled with the TypeScript already in the project and run
// in Node. Nothing here touches the browser.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
// The official maps are private and live in their own repository beside this one
// (../ttr-reference-data), or wherever TTR_REFERENCE_DATA points. Without them these checks cannot
// run, and they say so and step aside: the editor itself needs none of this data.
const referencePath = process.env.TTR_REFERENCE_DATA || path.join(root, "..", "ttr-reference-data", "ttr-reference-maps.json");
if (!fs.existsSync(referencePath)) {
  console.log(`Reference data not found at ${referencePath}.\nThe 35 suggester checks need the private ttr-reference-data repository beside this one, or TTR_REFERENCE_DATA pointing at its ttr-reference-maps.json. Skipped.`);
  process.exit(0);
}
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-suggester-"));
execFileSync("npx", ["tsc", "app/ticket-suggester.ts", "app/map-data.ts",
  "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck"],
  { cwd: root, stdio: "inherit" });
const { suggestTickets, evaluateTicketDeck, TICKET_SUGGESTER, mulberry32 } = require(path.join(out, "ticket-suggester.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };

// ---------------------------------------------------------------- reference maps as MapData
const reference = JSON.parse(fs.readFileSync(referencePath, "utf8"));
const officialMap = (id) => {
  const source = reference.maps.find((map) => map.id === id);
  const stops = source.stops.map((stop, i) => ({ id: stop.id, name: stop.name, type: "city", x: stop.x ?? i * 10, y: stop.y ?? i * 10 }));
  const routes = source.routes.map((route, i) => ({
    id: `r-${i}`, a: route.a, b: route.b, length: route.length, type: "city", color: route.color ?? "neutral",
    // Our routes carry ferries as locomotive slots and tunnels as a wagon style.
    locomotiveSlots: Array.from({ length: route.ferryLocomotives ?? 0 }, (_, k) => k),
    wagonStyle: route.tunnel ? "tunnel" : undefined,
  }));
  const tickets = source.tickets.map((ticket, i) => ({ id: `t-${i}`, a: ticket.a, b: ticket.b, points: ticket.points, long: ticket.long || undefined, set: "main" }));
  return {
    name: source.name, format: "board-2x3", background: [], stops, routes, notes: [],
    lineStyles: [], routeTypeStyles: [{ id: "city", label: "City", stroke: "#736d64", dash: "", strokeWidth: 3, infrastructure: false }],
    wagonStyles: [], stopTypeStyles: [], tickets, ticketSets: [{ id: "main", label: "Main deck" }],
    wagonsPerPlayer: source.setup?.trainsPerPlayer ?? 45,
    startingTickets: 3, keptTickets: 2,
  };
};

const usa = officialMap("usa");
const europe = officialMap("europe");
check("the USA reference map builds", usa.stops.length === 36 && usa.routes.length === 100 && usa.tickets.length === 30, `${usa.stops.length} stops, ${usa.routes.length} routes, ${usa.tickets.length} tickets`);
check("the Europe reference map builds", europe.stops.length === 47 && europe.routes.length === 101 && europe.tickets.length === 46, `${europe.stops.length} stops, ${europe.routes.length} routes, ${europe.tickets.length} tickets`);

// ---------------------------------------------------------------- the official decks score well
const usaReport = evaluateTicketDeck(usa, { style: "classic" });
check("USA: reach is 21 for 45 wagons", usaReport.reach === 21, String(usaReport.reach));
check("USA: the official deck scores under 5", usaReport.score < 5, usaReport.score.toFixed(1));
check("USA: near-duplicates match the published 1.6 %", Math.abs(usaReport.dupPct - 1.6) < .6, `${usaReport.dupPct.toFixed(1)} %`);
check("USA: unused routes match the published 14 %", Math.abs(usaReport.unusedPct - 14) < 4, `${usaReport.unusedPct.toFixed(0)} %`);
check("USA: at most 5 tickets name one stop", usaReport.maxPerStop === 5, String(usaReport.maxPerStop));

const europeReport = evaluateTicketDeck(europe, { style: "europe" });
check("Europe: the official deck scores under 5", europeReport.score < 5, europeReport.score.toFixed(1));
check("Europe: near-duplicates match the published 0.3 %", Math.abs(europeReport.dupPct - .3) < .6, `${europeReport.dupPct.toFixed(1)} %`);
check("Europe: unused routes match the published 17 %", Math.abs(europeReport.unusedPct - 17) < 5, `${europeReport.unusedPct.toFixed(0)} %`);
check("Europe: at most 4 tickets name one stop", europeReport.maxPerStop === 4, String(europeReport.maxPerStop));
check("Europe: no stop is left without a ticket", europeReport.zeroStops === 0, String(europeReport.zeroStops));

// ---------------------------------------------------------------- random decks score badly
const randomDeck = (map, size, seed) => {
  const random = mulberry32(seed);
  const ids = map.stops.map((stop) => stop.id);
  const tickets = [];
  const used = new Set();
  while (tickets.length < size) {
    const a = ids[Math.floor(random() * ids.length)];
    const b = ids[Math.floor(random() * ids.length)];
    const key = [a, b].sort().join("|");
    if (a === b || used.has(key)) continue;
    used.add(key);
    tickets.push({ id: `rand-${tickets.length}`, a, b, points: 1, set: "main" });
  }
  return { ...map, tickets };
};
const randomScores = [1, 2, 3, 4, 5].map((seed) => evaluateTicketDeck(randomDeck(usa, 30, seed), { style: "classic" }).score);
const medianRandom = randomScores.slice().sort((a, b) => a - b)[2];
check("random decks score far worse than the official one", medianRandom > 10, `median ${medianRandom.toFixed(1)} of ${randomScores.map((s) => s.toFixed(0)).join(", ")}`);

// ---------------------------------------------------------------- suggesting a deck
const usaSuggestion = suggestTickets(usa, { style: "classic", seed: 1 });
check("USA: suggests about 31 tickets", Math.abs(usaSuggestion.tickets.length - 31) <= 1, String(usaSuggestion.tickets.length));
// The classic style pays +1 at 0.9 of reach and +2 for the single longest, as the USA deck does.
check("USA: no ticket reaches beyond what a player can build", usaSuggestion.tickets.every((ticket) => ticket.points <= usaSuggestion.report.reach + 2), `longest ${Math.max(...usaSuggestion.tickets.map((t) => t.points))}`);
check("USA: the suggestion scores under 5", usaSuggestion.report.score < 5, usaSuggestion.report.score.toFixed(1));
const usaBinTargets = TICKET_SUGGESTER.styles.classic.bins.map((share) => share * usaSuggestion.report.regular);
const usaBinsOff = usaSuggestion.report.bins.map((count, i) => Math.abs(count - usaBinTargets[i]));
check("USA: every length bin is within 2 of its target", usaBinsOff.every((off) => off <= 2), `bins ${usaSuggestion.report.bins.join("/")} against ${usaBinTargets.map((t) => t.toFixed(1)).join("/")}`);

const europeSuggestion = suggestTickets(europe, { style: "europe", seed: 1 });
const europeLong = europeSuggestion.tickets.filter((ticket) => ticket.long);
check("Europe: suggests 40 regular and 6 long tickets", europeSuggestion.report.regular === 40 && europeLong.length === 6, `${europeSuggestion.report.regular} + ${europeLong.length}`);
check("Europe: every long ticket is 19–21 wagons", europeLong.every((ticket) => ticket.points >= 19 && ticket.points <= 21), europeLong.map((t) => t.points).join(", "));
check("Europe: the suggestion scores under 5", europeSuggestion.report.score < 5, europeSuggestion.report.score.toFixed(1));
check("Europe: long tickets sit out at the edges", europeSuggestion.report.longPeriphery > .5, String(europeSuggestion.report.longPeriphery?.toFixed(2)));

// ---------------------------------------------------------------- repeatability and keeps
const again = suggestTickets(usa, { style: "classic", seed: 1 });
const sameDeck = (x, y) => JSON.stringify(x.map((t) => [t.a, t.b, t.points].join()).sort()) === JSON.stringify(y.map((t) => [t.a, t.b, t.points].join()).sort());
check("the same seed gives the same deck", sameDeck(usaSuggestion.tickets, again.tickets));
const other = suggestTickets(usa, { style: "classic", seed: 2 });
check("a different seed gives a different deck", !sameDeck(usaSuggestion.tickets, other.tickets));

const keepThese = usa.tickets.slice(0, 4);
const kept = suggestTickets(usa, { style: "classic", seed: 3, keep: keepThese.map((ticket) => ticket.id) });
const has = (ticket) => kept.tickets.some((made) => (made.a === ticket.a && made.b === ticket.b) || (made.a === ticket.b && made.b === ticket.a));
check("kept tickets are always in the suggestion", keepThese.every(has), keepThese.filter((t) => !has(t)).map((t) => `${t.a}–${t.b}`).join(", ") || "all four kept");

// ---------------------------------------------------------------- following a chosen mix
// A map can set its own short/medium/long split, and the suggester aims at that instead of the
// style's own spread.
const withMix = (map, mix) => ({ ...map, ticketMix: mix });
const mixOf = (report) => report.mix;
const europeOfficialMix = evaluateTicketDeck(europe, { style: "europe" });
check("the official Europe deck reads as its published 76/11/13 mix", mixOf(europeOfficialMix).map((n) => Math.round(100 * n / 46)).join("/") === "76/11/13", mixOf(europeOfficialMix).join("/"));

const usaOfficialMix = evaluateTicketDeck(usa, { style: "classic" });
check("the official USA deck reads as its published 30/47/23 mix", mixOf(usaOfficialMix).map((n) => Math.round(100 * n / 30)).join("/") === "30/47/23", mixOf(usaOfficialMix).join("/"));

const shortHeavy = suggestTickets(withMix(usa, { short: 70, medium: 25, long: 5 }), { style: "classic", seed: 1 });
const shortShares = mixOf(shortHeavy.report).map((count) => 100 * count / shortHeavy.tickets.length);
check("asking for mostly short tickets gives mostly short tickets", Math.abs(shortShares[0] - 70) <= 10, shortShares.map((v) => v.toFixed(0)).join("/"));

const longHeavy = suggestTickets(withMix(usa, { short: 20, medium: 30, long: 50 }), { style: "classic", seed: 1 });
const longShares = mixOf(longHeavy.report).map((count) => 100 * count / longHeavy.tickets.length);
check("asking for mostly long tickets gives mostly long tickets", Math.abs(longShares[2] - 50) <= 10, longShares.map((v) => v.toFixed(0)).join("/"));
check("the two mixes really differ", Math.abs(shortShares[0] - longShares[0]) > 25, `${shortShares[0].toFixed(0)} % short against ${longShares[0].toFixed(0)} %`);

const followUsa = suggestTickets(withMix(europe, { short: 30, medium: 47, long: 23 }), { style: "classic", seed: 1 });
const followShares = mixOf(followUsa.report).map((count) => 100 * count / followUsa.tickets.length);
check("a map can follow another map's published mix", followShares.every((share, i) => Math.abs(share - [30, 47, 23][i]) <= 10), followShares.map((v) => v.toFixed(0)).join("/"));

const noMix = suggestTickets(usa, { style: "classic", seed: 1 });
check("a map without a mix of its own still follows the style", noMix.report.score < 5 && noMix.report.bins.join("/") === usaSuggestion.report.bins.join("/"), noMix.report.bins.join("/"));

// ---------------------------------------------------------------- where a map's own rules end tickets
// A set of the map's own measures ticket ends from the map's average stop. With no preference on either
// end it is Generic's rule exactly, so an official deck scores the same under both.
const genericValues = { ...TICKET_SUGGESTER.styles.generic };
const ownGeneric = { id: "own", label: "Own", basedOn: "generic", ticketsPerStop: genericValues.ticketsPerStop, longPerStop: genericValues.longPerStop, bins: [...genericValues.bins], longRange: genericValues.longRange, bonusFrom: genericValues.bonusFrom, lengthCap: genericValues.lengthCap, maxPerStop: genericValues.maxPerStop, dupRate: genericValues.dupRate, periphery: genericValues.periphery, longEnds: null, shortEnds: null };
const usaOwn = { ...usa, deckRules: [ownGeneric] };
const genericScore = evaluateTicketDeck(usa, { style: "generic", setId: "main" }).score;
const ownScore = evaluateTicketDeck(usaOwn, { style: "own", setId: "main" }).score;
check("an own set with no preference on either end scores exactly as Generic", Math.abs(genericScore - ownScore) < 1e-9, `${genericScore} against ${ownScore}`);
const farOut = evaluateTicketDeck({ ...usa, deckRules: [{ ...ownGeneric, longEnds: 0.4 }] }, { style: "own", setId: "main" }).score;
check("and asking long tickets to end far out changes the score", farOut > ownScore, `${ownScore} to ${farOut}`);

// ---------------------------------------------------------------- maps too small to work with
const tiny = { ...usa, stops: usa.stops.slice(0, 3), routes: usa.routes.slice(0, 2), tickets: [] };
const tinyResult = suggestTickets(tiny, {});
check("a map with too few stops returns an empty deck and says why", tinyResult.tickets.length === 0 && Boolean(tinyResult.report.note), tinyResult.report.note ?? "no note");
const noRoutes = { ...usa, routes: [], tickets: [] };
check("a map with no routes does not throw", suggestTickets(noRoutes, {}).tickets.length === 0);
check("evaluating an empty deck does not throw", evaluateTicketDeck({ ...usa, tickets: [] }, {}).regular === 0);

// ---------------------------------------------------------------- how long it takes
const started = Date.now();
suggestTickets(europe, { style: "europe", seed: 7 });
const elapsed = Date.now() - started;
check("a Europe-sized map is suggested in well under a second", elapsed < 1000, `${elapsed} ms`);

console.log("PASS:"); ok.forEach((line) => console.log("  ✓ " + line));
if (bad.length) { console.log("FAIL:"); bad.forEach((line) => console.log("  ✗ " + line)); }
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
