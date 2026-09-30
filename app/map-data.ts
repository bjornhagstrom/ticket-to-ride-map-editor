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
export type Stop = Point & { id: string; name: string; type: StopType; size?: StopSize; symbol?: StopSymbol; letter?: string; labelAngle?: number; endGapMm?: number; locked?: boolean; labelLocked?: boolean };

// Where a stop's name sits, as a compass bearing around the stop in degrees (0 = right, 90 = below).
// Undefined keeps the original behaviour: up and to the right, flipping left near the right edge.
export const defaultLabelAngle = (stop: Point) => (stop.x > 900 ? 215 : 325);
export type Route = { id: string; a: string; b: string; length: number; type: RouteType; color: string; points?: Point[]; locomotiveSlots?: number[]; lineStyle?: string; curved?: boolean; wagonStyle?: string };
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
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  locked?: boolean;
  collapsed?: boolean;
};
export type MapData = { name: string; format: MapFormat; endGapMm?: number; background: BackgroundShape[]; stops: Stop[]; routes: Route[]; backgroundImage?: BackgroundImage; notes: NoteBox[]; lineStyles: LineStyle[]; routeTypeStyles: RouteTypeStyle[]; wagonStyles: WagonStyle[]; stopTypeStyles: StopTypeStyle[]; tickets: Ticket[]; ticketSets: TicketSet[]; wagonsPerPlayer?: number; startingTickets?: number; keptTickets?: number; players?: PlayerRange; lanesUsableByPlayers?: LaneRule; ticketBands?: TicketBands; ticketMix?: TicketMix; ticketValuation?: { longBonus?: boolean; ferryPremium?: number };
  // Fields from a file this build does not know about. Kept so that opening and re-exporting a map
  // written by a newer version never quietly throws its work away.
  unknown?: Record<string, unknown> };

export const W = 1100;
export const STORAGE_KEY = "orebro-map-editor-public-v2";

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

export const emptyMap: MapData = {
  name: "New map",
  format: "board-2x3",
  background: [],
  stops: [],
  routes: [],
  notes: [],
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
  notes: [
    { id: "example-note", x: 815, y: 28, width: 250, height: 110, text: "Evaluation note: use notes like this to record playtesting feedback. They show on screen and in print, but are not part of the finished map." },
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
  // Two or three players, and a wagon count that leaves the table about three and a half supplies of
  // room. Both decks can deal three players three tickets each.
  players: { min: 2, max: 3 },
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
  ],
  background: [
    { id: "example-lake", type: "area", label: "Lake", labelPoint: { x: 590, y: 340 }, points: [{ x: 400, y: 350 }, { x: 445, y: 285 }, { x: 505, y: 215 }, { x: 585, y: 172 }, { x: 652, y: 166 }, { x: 735, y: 202 }, { x: 812, y: 248 }, { x: 848, y: 300 }, { x: 878, y: 372 }, { x: 900, y: 452 }, { x: 868, y: 478 }, { x: 815, y: 462 }, { x: 760, y: 448 }, { x: 700, y: 440 }, { x: 640, y: 440 }, { x: 560, y: 445 }, { x: 490, y: 440 }, { x: 430, y: 395 }], fill: "#b8ddea", stroke: "#4f8394", opacity: 0.65, strokeWidth: 3, locked: true },
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
    { id: "example-route-3", a: "example-pine-hill", b: "example-central", length: 6, type: "city", color: "neutral", points: [{ x: 352, y: 514 }, { x: 348, y: 406 }] },
    { id: "example-route-4", a: "example-central", b: "example-lakeside", length: 6, type: "boat", color: "neutral", points: [{ x: 525, y: 225 }], locomotiveSlots: [0] },
    { id: "example-route-5", a: "example-central", b: "example-deepcut", length: 5, type: "tunnel", color: "blue", points: [{ x: 480, y: 416 }] },
    { id: "example-route-6", a: "example-lakeside", b: "example-northfield", length: 4, type: "city", color: "neutral", points: [{ x: 726, y: 171 }] },
    { id: "example-route-7", a: "example-lakeside", b: "example-gull-island", length: 5, type: "boat", color: "neutral", points: [{ x: 727, y: 226 }], locomotiveSlots: [0] },
    { id: "example-route-8", a: "example-old-town", b: "example-harbour", length: 6, type: "city", color: "green", points: [{ x: 790, y: 585 }] },
    { id: "example-route-9", a: "example-harbour", b: "example-eastgate", length: 6, type: "restricted", color: "yellow", points: [{ x: 960, y: 420 }], curved: false },
    { id: "example-route-10", a: "example-old-town", b: "example-brickworks", length: 4, type: "city", color: "purple", points: [{ x: 769, y: 622 }], curved: false },
    { id: "example-route-11", a: "example-westport", b: "example-millbrook", length: 4, type: "city", color: "black", points: [{ x: 211, y: 218 }] },
    { id: "example-route-20", a: "example-millbrook", b: "example-central", length: 4, type: "city", color: "neutral", points: [{ x: 355, y: 295 }] },
    { id: "example-route-21", a: "example-fernside", b: "example-pine-hill", length: 5, type: "city", color: "red", points: [{ x: 215, y: 495 }] },
    { id: "example-route-22", a: "example-deepcut", b: "example-old-town", length: 5, type: "city", color: "orange", points: [{ x: 616, y: 544 }] },
    { id: "example-route-23", a: "example-northfield", b: "example-eastgate", length: 4, type: "city", color: "neutral", points: [{ x: 897, y: 183 }] },
    { id: "example-route-24", a: "example-gull-island", b: "example-harbour", length: 5, type: "boat", color: "neutral", points: [{ x: 852, y: 362 }], locomotiveSlots: [0] },
    { id: "example-route-25", a: "example-brickworks", b: "example-quarry", length: 4, type: "city", color: "green", points: [{ x: 929, y: 635 }], curved: false },
    { id: "example-route-30", a: "example-pine-hill", b: "example-ford", length: 6, type: "city", color: "white", points: [{ x: 380, y: 640 }] },
    { id: "example-route-31", a: "example-ford", b: "example-old-town", length: 5, type: "city", color: "yellow", points: [{ x: 590, y: 640 }] },
    { id: "example-route-32", a: "example-harbour", b: "example-quarry", length: 6, type: "city", color: "black", points: [{ x: 965, y: 525 }] },
  ],
};
