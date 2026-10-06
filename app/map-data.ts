export type StopType = string;
// `junction` marks a type whose stops are only there to join routes: paths run through them, but no
// ticket ever ends at one and they do not count as stops when a deck is judged.
export type StopTypeStyle = { id: string; label: string; fill: string; stroke: string; square?: boolean; junction?: boolean };
export type StopSize = "small" | "medium" | "large";
export type StopSymbol = "none" | "dot" | "dash" | "cross" | "letter";
export type RouteType = string;
export type BackgroundType = "area" | "line" | "label";
// The shape of the board, and nothing else. How it is printed — paper, how it is split, whether it
// adds up to a standard or an Anniversary board — is chosen per print run; see app/print-plan.ts.
export type MapFormat = "board-2x3" | "board-2x4";
export type Point = { x: number; y: number };
export type Stop = Point & { id: string; name: string; type: StopType; /** A hub on purpose: many tickets may name it. */ hub?: boolean; size?: StopSize; symbol?: StopSymbol; letter?: string; labelAngle?: number; endGapMm?: number; locked?: boolean; labelLocked?: boolean };

// Where a stop's name sits, as a compass bearing around the stop in degrees (0 = right, 90 = below).
// Undefined keeps the original behaviour: up and to the right, flipping left near the right edge.
export const defaultLabelAngle = (stop: Point, boardWidth = W) => (stop.x > boardWidth - 200 ? 215 : 325);
export type Route = { id: string; a: string; b: string; length: number; type: RouteType; color: string; /** Contested on purpose: tickets may crowd it. */ contested?: boolean; points?: Point[]; locomotiveSlots?: number[]; lineStyle?: string; curved?: boolean; wagonStyle?: string };
export type LineStyle = { id: string; label: string; strokeWidth: number; dash: string };

// How a route's wagon spaces are drawn, to signal that it plays by a rule of its own. Shape is
// deliberately a short list: a space prints at 20 x 9 mm on a board and about 7.5 x 3.4 mm on an A4
// proof, so anything subtler than these disappears. `glyph` is what survives that shrink, and what
// still reads in black and white.
export type WagonShape = "plain" | "serrated" | "notched" | "heavy" | "oval";
export type WagonStyle = { id: string; label: string; shape: WagonShape; glyph?: string };

export const wagonShapeMeta: Record<WagonShape, { label: string }> = {
  plain: { label: "Plain" },
  serrated: { label: "Serrated (tunnel)" },
  oval: { label: "Pointed (boat)" },
  notched: { label: "Notched corners" },
  heavy: { label: "Heavy outline" },
};

// Ships with every map so a tunnel is there from the start, but it is an ordinary style: rename it,
// restyle it, or delete it like any other.
export const defaultWagonStyles: WagonStyle[] = [
  { id: "tunnel", label: "Tunnel", shape: "serrated" },
];
// A route type describes the whole route: the line it is drawn with and the wagon spaces along it.
// `shape` and `glyph` used to live in a separate wagon-style list, which meant defining two things
// and remembering to apply both. A tunnel is a kind of route, not a line that happens to carry
// tunnel wagons.
export type RouteTypeStyle = { id: string; label: string; stroke: string; dash: string; strokeWidth: number; infrastructure: boolean; shape?: WagonShape; glyph?: string };
export type BackgroundShape = {
  id: string;
  type: BackgroundType;
  label: string;
  labelPoint?: Point;
  points: Point[];
  fill: string;
  stroke: string;
  opacity: number;
  strokeWidth: number;
  locked?: boolean;
};
export type ImageCrop = { top: number; right: number; bottom: number; left: number };
export type BackgroundImage = {
  dataUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  crop: ImageCrop;
  locked?: boolean;
};
// A destination ticket: reach one stop from the other to score its points. `long` marks the ones
// drawn from a separate, longer deck.
// `adjust` is the designer's own correction to the computed value, kept separate so that suggesting
// a new deck never silently overwrites it.
export type Ticket = { id: string; a: string; b: string; points: number; long?: boolean; set?: string; adjust?: number };

// Tickets live in named sets so several decks can sit in one map and be compared. A ticket without
// a set belongs to the first one, which is how a map written before sets still opens.
export type TicketSet = { id: string; label: string };
export const defaultTicketSet: TicketSet = { id: "main", label: "Main deck" };

export function ticketsInSet(data: MapData, setId: string): Ticket[] {
  const first = data.ticketSets[0]?.id;
  return data.tickets.filter((ticket) => (ticket.set ?? first) === setId);
}

export type NoteBox = {
  id: string;
  /** A note the editor draws itself: "playtest" is the box for the version, the date played and who
   *  played. An older build shows it as an ordinary note with its text. */
  kind?: "playtest";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  locked?: boolean;
  collapsed?: boolean;
};
// The terms a deck is suggested on: how many tickets, how long, how they spread. Our three sets live
// in TICKET_SUGGESTER and cannot be changed; a map may carry sets of its own, made from one of ours,
// and choose which one the suggester follows. Shares are fractions (0.18), as in TICKET_SUGGESTER.
export type DeckRuleValues = {
  ticketsPerStop: number;
  longPerStop: number;
  /** Five shares of the regular deck, by length as a fraction of reach: <.30, .30–.45, .45–.60, .60–.75, ≥.75. */
  bins: number[];
  longRange: [number, number] | null;
  bonusFrom: number | null;
  lengthCap: number;
  maxPerStop: number;
  dupRate: number;
  periphery: "relative" | "point";
  /** Own sets only: how much further out than the map's average stop long tickets should end, and
   *  short ones (negative is further in), on a scale from the middle (0) to the edge (1). null means no
   *  preference: only a deck on the wrong side of the average stop is marked down. When both are
   *  absent, `periphery` decides, as it does for our three. */
  longEnds?: number | null;
  shortEnds?: number | null;
};
export type DeckRuleSet = DeckRuleValues & { id: string; label: string; basedOn: string };
/** Our sets, by the id a map chooses them with. Their values are in TICKET_SUGGESTER.styles. */
export const BUILT_IN_DECK_RULES = ["generic", "classic", "europe"] as const;

/** One number handed out: when, and how the map left the editor (print, export, image). */
export type MapVersionEntry = { number: number; date: string; by: string; [key: string]: unknown };
/** The map's version: one series for every print and export. `fingerprint` is of the content when the
 *  number was handed out, so a print or export of an unchanged map keeps it. Fields a later build adds
 *  are kept. See docs/FILE-FORMAT.md. */
export type MapVersion = { number: number; fingerprint: string; issued: MapVersionEntry[]; [key: string]: unknown };

export type MapData = { name: string; mapVersion?: MapVersion; deckTension?: number; format: MapFormat; orientation?: "landscape" | "portrait"; rules?: string; endGapMm?: number; background: BackgroundShape[]; stops: Stop[]; routes: Route[]; backgroundImage?: BackgroundImage; notes: NoteBox[]; lineStyles: LineStyle[]; routeTypeStyles: RouteTypeStyle[]; wagonStyles: WagonStyle[]; stopTypeStyles: StopTypeStyle[]; tickets: Ticket[]; ticketSets: TicketSet[]; wagonsPerPlayer?: number; startingTickets?: number; keptTickets?: number; players?: PlayerRange; lanesUsableByPlayers?: LaneRule; ticketBands?: TicketBands; ticketMix?: TicketMix; ticketValuation?: { longBonus?: boolean; ferryPremium?: number }; deckRules?: DeckRuleSet[]; deckRule?: string;
  // Fields from a file this build does not know about. Kept so that opening and re-exporting a map
  // written by a newer version never quietly throws its work away.
  unknown?: Record<string, unknown> };

/** Points for claiming a route, by its length, as the standard rules list them (lengths 1 to 8). */
export const ROUTE_POINTS: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 10, 6: 15, 7: 18, 8: 21 };
export const routePointsTable = () => `| Route length | Points |\n| ---: | ---: |\n${Object.entries(ROUTE_POINTS).map(([length, points]) => `| ${length} | ${points} |`).join("\n")}`;
export const W = 1100;
/** Where the map is kept in this browser. 0.4.0 and earlier used LEGACY_STORAGE_KEY; see
 *  moveLegacyStorage in map-storage.ts. */
export const STORAGE_KEY = "ttr-map";
export const LEGACY_STORAGE_KEY = "orebro-map-editor-public-v2";

export type MapFormatDefinition = {
  label: string;
  shortLabel: string;
  note: string;
  width: number;
  height: number;
  widthMm: number;
  heightMm: number;
  columns: number;
  rows: number;
  custom?: boolean;
};

export const mapFormats: Record<MapFormat, MapFormatDefinition> = {
  "board-2x3": { label: "Standard board 2×3", shortLabel: "Standard board 2×3", note: "Verified standard Ticket to Ride size", width: W, height: Math.round(W * 525 / 790), widthMm: 790, heightMm: 525, columns: 3, rows: 2 },
  "board-2x4": { label: "Extended board 2×4", shortLabel: "Extended board 2×4", note: "Custom size using standard-size square panels", width: W, height: Math.round(W * 526 / 1053), widthMm: 1053, heightMm: 526, columns: 4, rows: 2, custom: true },
};

// Footprint of a real plastic train and the spacing a real board gives it, in millimetres.
// `gap` and `endMargin` are not guesses: they come from a least-squares fit over all 101 routes of
// the published Ticket to Ride Europe map, where the distance between two city centres works out
// as 25.6 mm per wagon space plus 14.8 mm of margin at the ends. Scored against that model the
// real board lands between 97% and 106% at every route length, which is what makes it a usable
// reference for "is this route drawn about right". Change these if you measure your own set.
export const realWagon = { length: 20, width: 9, gap: 5.5, endMargin: 15 };

// The board the default view draws to scale against, so a map looks the same whichever format it is
// set to. True-scale mode measures against the map's own target board instead.
export const REFERENCE_BOARD_MM = 790;

// How far a stop's name box is pushed out from the point at its bearing, as fractions of half its
// width and half its height. Following a square rather than a circle puts the box's nearest corner
// exactly on the point at the diagonals, so the name never slides onto the stop; it is still
// continuous all the way round. Shared by the drawing and the overlap analysis.
export const labelPush = (angleDegrees: number): { x: number; y: number } => {
  const rad = angleDegrees * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad), m = Math.max(Math.abs(cos), Math.abs(sin));
  return { x: cos / m, y: sin / m };
};

// Extra room, in millimetres on the reference board, added beyond a stop's own circle before the
// first wagon of every route into it. Two is the measured sweet spot on the imported Europe map:
// it keeps the median wagon spacing at the real board's 25.5 mm while leaving about 3 mm of clear
// paper around every stop. Past about four the wagons start being squeezed out of real spacing.
// `MapData.endGapMm` sets it for the whole map and `Stop.endGapMm` for one stop, which is what
// lets the two ends of the same route differ.
export const DEFAULT_END_GAP_MM = 2;
// How much of a background image must stay over the board, so it can hang over an edge without
// being dragged out of reach.
export const IMAGE_KEEP_ON_BOARD = 30;

// How a game on this map is set up. The defaults are the original Ticket to Ride's: 45 wagons each,
// three destination tickets dealt at the start.
export const DEFAULT_WAGONS_PER_PLAYER = 45;
export const DEFAULT_STARTING_TICKETS = 3;
export const DEFAULT_KEPT_TICKETS = 2;

// How tense a full deck of tickets built for the map is, from 0 (calm: tickets spread out) through 50
// (like the official maps) to 100 (tense: tickets crowd the same corridors). A map that has not chosen
// is read as 50. The three words an earlier development build wrote ("calm", "official", "tense") still
// read, as 0, 50 and 100.
export const TENSION_CALM = 0;
export const DEFAULT_TENSION = 50;
export const TENSION_TENSE = 100;
export function normalizeTension(value: unknown): number | undefined {
  if (value === "calm") return TENSION_CALM;
  if (value === "official") return DEFAULT_TENSION;
  if (value === "tense") return TENSION_TENSE;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(TENSION_TENSE, Math.max(TENSION_CALM, Math.round(value)));
}
/** The tension a map builds its decks with: its own choice, or like the official maps. */
export const tensionOf = (data: { deckTension?: number }): number => normalizeTension(data.deckTension) ?? DEFAULT_TENSION;

// How many players the map is built for. It decides how big a deck has to be to deal from, and
// whether the second lane of a double route is ever in play: the standard rule opens it only from
// four players up.
export type PlayerRange = { min: number; max: number };
export const DEFAULT_PLAYERS: PlayerRange = { min: 2, max: 5 };
export const LANES_OPEN_FROM = 4;

// How many lanes of a multi-lane route a player may use, by player count. Every official map sets
// its own threshold, and Northern Lights' triple routes open one lane at a time, which no single
// threshold catches — so the map carries the counts rather than a rule name. Keys are a player
// count or "N+"; values a number of lanes or "all".
export type LaneRule = Record<string, number | "all">;

export function lanesUsableAt(players: number, lanes: number, rule?: LaneRule): number {
  if (rule) {
    const exact = rule[String(players)];
    if (exact !== undefined) return exact === "all" ? lanes : Math.max(1, Math.min(lanes, exact));
    let best: number | "all" | undefined;
    let from = -1;
    for (const [key, value] of Object.entries(rule)) {
      if (!key.endsWith("+")) continue;
      const at = Number(key.slice(0, -1));
      if (Number.isFinite(at) && at <= players && at > from) { from = at; best = value; }
    }
    if (best !== undefined) return best === "all" ? lanes : Math.max(1, Math.min(lanes, best));
  }
  // The standard rule when a map says nothing: one lane below four players, all of them from four.
  return players >= LANES_OPEN_FROM ? lanes : 1;
}

// Where a ticket stops being short and where it becomes long, as fractions of the map's own
// diameter — the same measure the official decks were read with, so a mix carries between maps of
// different sizes. The shares are what fraction of the deck should sit in each band.
export type TicketBands = { medium: number; long: number };
export type TicketMix = { short: number; medium: number; long: number };
export const DEFAULT_TICKET_BANDS: TicketBands = { medium: .35, long: .60 };
export const DEFAULT_TICKET_MIX: TicketMix = { short: 30, medium: 47, long: 23 };

// What the official decks actually do, to follow with one click. Measured from the full route and
// ticket data in ../ttr-reference-data/ttr-reference-maps.json.
export const TICKET_MIX_PRESETS: { id: string; label: string; note: string; mix: TicketMix }[] = [
  { id: "usa", label: "Ticket to Ride (USA)", note: "30 tickets in one deck, spread across the whole map", mix: { short: 30, medium: 47, long: 23 } },
  { id: "europe", label: "Ticket to Ride: Europe", note: "all 46 tickets: a short regular deck plus 6 long ones", mix: { short: 76, medium: 11, long: 13 } },
  { id: "europe-regular", label: "Europe, regular deck only", note: "the 40 regular tickets, without the long deck", mix: { short: 88, medium: 12, long: 0 } },
];

// Centre-to-centre distance between the lines of a double route, in millimetres on the reference
// board: a wagon's width plus a small gap, so the two rows sit beside each other the way a real
// board prints them rather than floating far apart.
export const PARALLEL_SPACING_MM = realWagon.width + 2.5;
// Styled spaces reach further across their own height than a plain rounded rectangle does — teeth
// meet teeth — so a double route carrying one gets a little more room between its lines.
export const PARALLEL_SPACING_STYLED_MM = realWagon.width + 5.5;

// Radii in canvas units, chosen to print at roughly the size a real board's city dots do on the
// reference board: about 3.2, 4.5 and 6.5 mm across the radius. Larger circles crowd the wagons and
// push the first wagon of every route further from the stop than a real board does.
export const stopSizeMeta: Record<StopSize, { label: string; radius: number }> = {
  small: { label: "Small", radius: 4.5 },
  medium: { label: "Medium", radius: 6.3 },
  large: { label: "Large", radius: 9 },
};

export const stopSymbolMeta: Record<StopSymbol, { label: string }> = {
  none: { label: "No symbol" },
  dot: { label: "Dot" },
  dash: { label: "Dash" },
  cross: { label: "Cross (X)" },
  letter: { label: "Letter" },
};

// Stop appearance is data, like route appearance. `square` draws the small centred square the
// railway station has always had, so that look survives as an option rather than a hard-coded type.
// Three to start with, not seven: a plain stop, a junction that no ticket goes to, and a ferry port.
// More are made in Settings when a map needs them, and a map that already has its own keeps them.
export const defaultStopTypeStyles: StopTypeStyle[] = [
  { id: "city", label: "Regular", fill: "#fffaf0", stroke: "#721c24" },
  { id: "ferry", label: "Ferry port", fill: "#dceff8", stroke: "#23749b" },
  // Last: a junction is the one you reach for least often.
  { id: "junction", label: "Junction", fill: "#e7e1d6", stroke: "#8a8277", junction: true },
];
export const fallbackStopTypeStyle: StopTypeStyle = { id: "city", label: "Stop", fill: "#fffaf0", stroke: "#721c24" };

export const defaultRouteTypeStyles: RouteTypeStyle[] = [
  // Three to start with. Card routes carry each route's own wagon colour, so these are told apart by
  // the shape of their spaces as much as by the line. `stroke` is only drawn for infrastructure.
  { id: "city", label: "Railway", stroke: "#721c24", dash: "", strokeWidth: 3, infrastructure: false, shape: "plain" },
  { id: "tunnel", label: "Tunnel", stroke: "#736d64", dash: "", strokeWidth: 3, infrastructure: false, shape: "serrated" },
  { id: "boat", label: "Boat", stroke: "#23749b", dash: "10 6", strokeWidth: 3, infrastructure: false, shape: "oval" },
];

// Wagon space colours. Grey and black sit inside the same dark outline, so they are set far apart:
// a light grey and a true black, at least 4.5:1 against each other, with grey still 3:1 on the paper.
// The regression suite measures both.
export const routeColors: Record<string, string> = {
  neutral: "#8c877d", red: "#cf3f3f", blue: "#3b72b9", green: "#4c8b58",
  yellow: "#e2b83b", black: "#1d1e21", white: "#fffdf5", orange: "#da7a31", purple: "#8a5aa5",
};

export const colorLabels: Record<string, string> = {
  neutral: "Grey", red: "Red", blue: "Blue", green: "Green", yellow: "Yellow",
  black: "Black", white: "White", orange: "Orange", purple: "Purple",
};

/** The playtest box: its size, its place in the top right corner of a lying 2×3 board, and what it
 *  says in a build that does not draw it itself. map-version.ts places it on other maps. */
export const PLAYTEST_SIZE = { width: 230, height: 96 };
export const PLAYTEST_MARGIN = 16;
export const PLAYTEST_TEXT = "Played: ______________\nPlayers: write their names on the back";

export const emptyMap: MapData = {
  name: "New map",
  format: "board-2x3",
  background: [],
  stops: [],
  routes: [],
  // A new map starts with the playtest box, in its top right corner, where the owner wants it.
  notes: [{ id: "playtest", kind: "playtest", x: W - PLAYTEST_SIZE.width - PLAYTEST_MARGIN, y: PLAYTEST_MARGIN, width: PLAYTEST_SIZE.width, height: PLAYTEST_SIZE.height, text: PLAYTEST_TEXT }],
  lineStyles: [],
  routeTypeStyles: defaultRouteTypeStyles.map((style) => ({ ...style })),
  wagonStyles: defaultWagonStyles.map((style) => ({ ...style })),
  stopTypeStyles: defaultStopTypeStyles.map((style) => ({ ...style })),
  tickets: [],
  ticketSets: [{ ...defaultTicketSet }],
  wagonsPerPlayer: DEFAULT_WAGONS_PER_PLAYER,
  startingTickets: DEFAULT_STARTING_TICKETS,
  keptTickets: DEFAULT_KEPT_TICKETS,
};

export const initialMap: MapData = {
  // A small map that shows what the editor does, and is itself clean: every route as long as its
  // wagons need, no crossings, no name on a route, every stop reached by a ticket, and a setup that
  // fits. The regression suite checks both halves of that promise.
  name: "Example map",
  format: "board-2x3",
  // Rules for the example: the standard ones, except where they say otherwise. The exceptions are made
  // up, or left as XXX, to show what the rules box does, with a stop and routes named so the preview
  // draws them. Every name here is on this map; the regression suite checks that.
  rules: `# Rules of the example map

This map follows the standard *Ticket to Ride* rules, except where it says otherwise below. The exceptions are made up to show what this box can do: replace them with your own.

## Where this map differs

- **Start.** Every player puts a marker on [[Westport]] before the first turn. XXX
- **Boats.** The boat routes [[Lakeside–Gull Island]] and [[Gull Island–Harbour]] can only be claimed by a player who already holds a route into [[Harbour]]. XXX
- **Tunnel.** [[Central–Deepcut]] is a tunnel. XXX
- **Restricted route.** [[Harbour–Eastgate]] is marked R. XXX
- **Double route.** [[Westport–Millbrook]] has two lanes, but with two or three players only one of them is used, as in the standard rules.

## Points for routes

A claimed route scores by its length, as in the standard rules:

${routePointsTable()}

## Still to decide

- XXX
- XXX

| Players | Wagons each | Tickets dealt |
| --- | ---: | ---: |
| 2 | 28 | 3 |
| 3 | 28 | 3 |

*Tip: point at a name above and the map marks it. Write your own with \`[[Stop]]\` or \`[[Stop–Stop]]\`.*
`,
  notes: [
    { id: "example-note", x: 40, y: 24, width: 300, height: 134, text: "Print this map for a quick playtest: claim routes by colouring in their spaces, each player with a marker of their own colour. Notes like this one keep what you learn, on screen and in print." },
  ],
  lineStyles: [],
  routeTypeStyles: [
    ...defaultRouteTypeStyles.map((style) => ({ ...style })),
    // A type of the map's own: a heavy dotted line and an R in every space, for a route that plays
    // by a rule of its own.
    { id: "restricted", label: "Restricted", stroke: "#721c24", dash: "2 5", strokeWidth: 7, infrastructure: false, shape: "plain", glyph: "R" },
  ],
  wagonStyles: defaultWagonStyles.map((style) => ({ ...style })),
  stopTypeStyles: defaultStopTypeStyles.map((style) => ({ ...style })),
  // The standard two to five players (none is stated, so DEFAULT_PLAYERS holds), and a wagon count that
  // leaves the board about three and a half supplies of room. Both decks can deal five players three
  // tickets each.
  wagonsPerPlayer: 28,
  startingTickets: DEFAULT_STARTING_TICKETS,
  keptTickets: DEFAULT_KEPT_TICKETS,
  ticketSets: [{ id: "main", label: "Main deck" }, { id: "example-long", label: "Long journeys" }],
  // Worth their shortest path, as every ticket is. The main deck names every stop but the junction.
  tickets: [
    { id: "example-ticket-1", a: "example-millbrook", b: "example-fernside", points: 9, set: "main" },
    { id: "example-ticket-2", a: "example-deepcut", b: "example-brickworks", points: 9, set: "main" },
    { id: "example-ticket-3", a: "example-northfield", b: "example-gull-island", points: 9, set: "main" },
    { id: "example-ticket-4", a: "example-westport", b: "example-lakeside", points: 14, set: "main" },
    { id: "example-ticket-5", a: "example-central", b: "example-eastgate", points: 14, set: "main" },
    { id: "example-ticket-6", a: "example-pine-hill", b: "example-old-town", points: 11, set: "main" },
    { id: "example-ticket-7", a: "example-quarry", b: "example-deepcut", points: 13, set: "main" },
    { id: "example-ticket-8", a: "example-westport", b: "example-harbour", points: 24, long: true, set: "main" },
    { id: "example-ticket-9", a: "example-eastgate", b: "example-fernside", points: 25, long: true, set: "main" },
    { id: "example-ticket-10", a: "example-quarry", b: "example-millbrook", points: 22, long: true, set: "main" },
    { id: "example-ticket-11", a: "example-millbrook", b: "example-deepcut", points: 9, set: "example-long" },
    { id: "example-ticket-12", a: "example-westport", b: "example-central", points: 8, set: "example-long" },
    { id: "example-ticket-13", a: "example-pine-hill", b: "example-brickworks", points: 15, set: "example-long" },
    { id: "example-ticket-14", a: "example-old-town", b: "example-eastgate", points: 12, set: "example-long" },
    { id: "example-ticket-15", a: "example-quarry", b: "example-gull-island", points: 11, set: "example-long" },
    { id: "example-ticket-16", a: "example-harbour", b: "example-fernside", points: 22, long: true, set: "example-long" },
    { id: "example-ticket-17", a: "example-fernside", b: "example-northfield", points: 21, long: true, set: "example-long" },
    { id: "example-ticket-18", a: "example-lakeside", b: "example-brickworks", points: 20, long: true, set: "example-long" },
    { id: "example-ticket-19", a: "example-westport", b: "example-quarry", points: 26, long: true, set: "example-long" },
    { id: "example-ticket-20", a: "example-harbour", b: "example-brickworks", points: 10, set: "main" },
    { id: "example-ticket-21", a: "example-central", b: "example-northfield", points: 10, set: "main" },
    { id: "example-ticket-22", a: "example-old-town", b: "example-gull-island", points: 11, set: "main" },
    { id: "example-ticket-23", a: "example-pine-hill", b: "example-lakeside", points: 12, set: "main" },
    { id: "example-ticket-24", a: "example-pine-hill", b: "example-eastgate", points: 20, long: true, set: "main" },
    { id: "example-ticket-25", a: "example-harbour", b: "example-deepcut", points: 11, set: "example-long" },
    { id: "example-ticket-26", a: "example-lakeside", b: "example-millbrook", points: 10, set: "example-long" },
    { id: "example-ticket-27", a: "example-eastgate", b: "example-gull-island", points: 11, set: "example-long" },
    { id: "example-ticket-28", a: "example-central", b: "example-old-town", points: 10, set: "example-long" },
    { id: "example-ticket-29", a: "example-harbour", b: "example-millbrook", points: 20, long: true, set: "example-long" },
    { id: "example-ticket-30", a: "example-northfield", b: "example-brickworks", points: 20, long: true, set: "example-long" },
  ],
  background: [
    { id: "example-lake", type: "area", label: "Lake", labelPoint: { x: 745, y: 350 }, points: [{ x: 630, y: 222 }, { x: 668, y: 190 }, { x: 735, y: 205 }, { x: 812, y: 248 }, { x: 848, y: 300 }, { x: 878, y: 372 }, { x: 900, y: 452 }, { x: 868, y: 478 }, { x: 815, y: 462 }, { x: 760, y: 440 }, { x: 700, y: 415 }, { x: 655, y: 380 }, { x: 625, y: 325 }, { x: 618, y: 270 }], fill: "#b8ddea", stroke: "#4f8394", opacity: 0.65, strokeWidth: 3, locked: true },
    { id: "example-highlands", type: "area", label: "Highlands", labelPoint: { x: 160, y: 640 }, points: [{ x: 35, y: 445 }, { x: 205, y: 400 }, { x: 345, y: 500 }, { x: 300, y: 690 }, { x: 55, y: 690 }], fill: "#c9d9ad", stroke: "#718360", opacity: 0.55, strokeWidth: 3, locked: true },
    { id: "example-river", type: "line", label: "River", labelPoint: { x: 705, y: 508 }, points: [{ x: 30, y: 345 }, { x: 240, y: 330 }, { x: 420, y: 385 }, { x: 625, y: 465 }, { x: 830, y: 500 }, { x: 1070, y: 455 }], fill: "#000000", stroke: "#5b9db4", opacity: 0.75, strokeWidth: 10, locked: true },
    { id: "example-north-label", type: "label", label: "North District", points: [{ x: 500, y: 75 }], fill: "#000000", stroke: "#71685c", opacity: 0.8, strokeWidth: 0, locked: true },
  ],
  stops: [
    { id: "example-westport", name: "Westport", type: "city", x: 130, y: 205, symbol: "dot", labelAngle: 195 },
    { id: "example-pine-hill", name: "Pine Hill", type: "city", x: 280, y: 575, size: "small", labelAngle: 120 },
    { id: "example-central", name: "Central", type: "city", x: 420, y: 345, labelAngle: 180 },
    { id: "example-lakeside", name: "Lakeside", type: "city", x: 640, y: 185, labelAngle: 270 },
    { id: "example-old-town", name: "Old Town", type: "city", x: 690, y: 600, labelAngle: 90 },
    { id: "example-harbour", name: "Harbour", type: "ferry", x: 875, y: 455, symbol: "letter", letter: "F", labelAngle: 225, locked: true },
    { id: "example-eastgate", name: "Eastgate", type: "city", x: 980, y: 210, size: "large", labelAngle: 300 },
    { id: "example-quarry", name: "Quarry", type: "city", x: 1010, y: 625, size: "small", labelAngle: 210 },
    { id: "example-millbrook", name: "Millbrook", type: "city", x: 287, y: 248, labelAngle: 330 },
    { id: "example-fernside", name: "Fernside", type: "city", size: "small", x: 165, y: 407, labelAngle: 330 },
    { id: "example-deepcut", name: "Deepcut", type: "city", x: 544, y: 484, labelAngle: 330 },
    { id: "example-northfield", name: "Northfield", type: "city", x: 812, y: 165, labelAngle: 330 },
    { id: "example-gull-island", name: "Gull Island", type: "ferry", size: "small", x: 808, y: 277, labelAngle: 330 },
    { id: "example-brickworks", name: "Brickworks", type: "city", size: "small", x: 848, y: 644, labelAngle: 300 },
    { id: "example-ford", name: "Ford", type: "junction", x: 490, y: 650 },
  ],
  routes: [
    { id: "example-route-1", a: "example-westport", b: "example-millbrook", length: 4, type: "city", color: "red", points: [{ x: 211, y: 218 }] },
    { id: "example-route-2", a: "example-westport", b: "example-fernside", length: 5, type: "city", color: "orange", points: [{ x: 144, y: 307 }] },
    { id: "example-route-3", a: "example-pine-hill", b: "example-central", length: 6, type: "city", color: "neutral", points: [{ x: 352, y: 514 }, { x: 348, y: 406 }], locomotiveSlots: [2] },
    { id: "example-route-4", a: "example-central", b: "example-lakeside", length: 6, type: "city", color: "neutral", points: [{ x: 525, y: 225 }], locomotiveSlots: [0, 1] },
    { id: "example-route-5", a: "example-central", b: "example-deepcut", length: 5, type: "tunnel", color: "blue", points: [{ x: 480, y: 416 }] },
    { id: "example-route-6", a: "example-lakeside", b: "example-northfield", length: 4, type: "city", color: "neutral", points: [{ x: 726, y: 171 }], locomotiveSlots: [0] },
    { id: "example-route-7", a: "example-lakeside", b: "example-gull-island", length: 5, type: "boat", color: "neutral", points: [{ x: 727, y: 226 }] },
    { id: "example-route-8", a: "example-old-town", b: "example-harbour", length: 6, type: "city", color: "green", points: [{ x: 790, y: 585 }] },
    { id: "example-route-9", a: "example-harbour", b: "example-eastgate", length: 6, type: "restricted", color: "yellow", points: [{ x: 960, y: 420 }], curved: false },
    { id: "example-route-10", a: "example-old-town", b: "example-brickworks", length: 4, type: "city", color: "purple", points: [{ x: 769, y: 622 }], curved: false },
    { id: "example-route-11", a: "example-westport", b: "example-millbrook", length: 4, type: "city", color: "black", points: [{ x: 211, y: 218 }] },
    { id: "example-route-20", a: "example-millbrook", b: "example-central", length: 4, type: "city", color: "neutral", points: [{ x: 355, y: 295 }] },
    { id: "example-route-21", a: "example-fernside", b: "example-pine-hill", length: 5, type: "city", color: "red", points: [{ x: 215, y: 495 }] },
    { id: "example-route-22", a: "example-deepcut", b: "example-old-town", length: 5, type: "city", color: "orange", points: [{ x: 616, y: 544 }] },
    { id: "example-route-23", a: "example-northfield", b: "example-eastgate", length: 4, type: "city", color: "neutral", points: [{ x: 897, y: 183 }] },
    { id: "example-route-24", a: "example-gull-island", b: "example-harbour", length: 5, type: "boat", color: "neutral", points: [{ x: 852, y: 362 }] },
    { id: "example-route-25", a: "example-brickworks", b: "example-quarry", length: 4, type: "city", color: "green", points: [{ x: 929, y: 635 }], curved: false },
    { id: "example-route-30", a: "example-pine-hill", b: "example-ford", length: 6, type: "city", color: "white", points: [{ x: 380, y: 640 }] },
    { id: "example-route-31", a: "example-ford", b: "example-old-town", length: 5, type: "city", color: "yellow", points: [{ x: 590, y: 640 }] },
    { id: "example-route-32", a: "example-harbour", b: "example-quarry", length: 6, type: "city", color: "black", points: [{ x: 965, y: 525 }] },
  ],
};

// The example map with two things done wrong on purpose, so someone new can see how the editor's
// warnings look: a route that crosses another (the Crossings card turns to a warning, and the crossing
// is ringed on the map) and a stop reached by a single route (a dead end, under how the network holds
// together). Built from the clean example, which stays as it is: everything there is here, plus a stop
// and two routes. The regression suite checks both.
const problemStop: Stop = { id: "problem-outpost", name: "Outpost", type: "city", size: "small", x: 95, y: 565, labelAngle: 90 };
export const problemMap: MapData = {
  ...initialMap,
  name: "Example map with problems",
  rules: `# Rules of the example map with problems

This is the example map with two things done wrong on purpose, so that you can see what the editor says about them. In every other way it follows the standard *Ticket to Ride* rules.

## What is wrong

- **A route that crosses another.** [[Fernside–Deepcut]] runs over a route it does not meet at a stop. Players cannot tell which one a wagon belongs to where they cross, so Map balance counts the crossing and rings it on the map.
- **A dead end.** [[Outpost]] is reached by [[Fernside–Outpost]] only: nothing runs on from it, so it is a corner of the map that a ticket can reach by one way alone. How the network holds together lists it.

## What to do about it

Move a stop or bend the route so that it no longer crosses, or let it cross at a stop. Join [[Outpost]] to a second stop, or accept the dead end if a corner like it is what you want. The warnings are not faults: they say how the map differs.

*Tip: point at a card in Map balance and the map marks what it is about.*
`,
  notes: [{ id: "problem-note", x: 40, y: 24, width: 300, height: 150, text: "Two things are wrong on purpose here: Fernside–Deepcut crosses another route, and Outpost is a dead end, reached by one route only. Open Map balance to see how the editor says so, then fix them or leave them." }],
  stops: [...initialMap.stops, problemStop],
  routes: [
    ...initialMap.routes,
    { id: "problem-route-1", a: "example-fernside", b: "problem-outpost", length: 4, type: "city", color: "white", points: [], curved: false },
    { id: "problem-route-2", a: "example-fernside", b: "example-deepcut", length: 8, type: "city", color: "blue", points: [], curved: false },
  ],
};
