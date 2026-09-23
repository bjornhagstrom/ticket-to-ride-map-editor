export type StopType = "city" | "region" | "brt" | "rail" | "ferry" | "outing";
export type StopSize = "small" | "medium" | "large";
export type StopSymbol = "none" | "dot" | "dash" | "cross" | "letter";
export type RouteType = string;
export type BackgroundType = "area" | "line" | "label";
export type MapFormat = "board-2x3" | "board-2x3-large" | "board-2x4" | "a4" | "a3" | "us-letter";
export type Point = { x: number; y: number };
export type Stop = Point & { id: string; name: string; type: StopType; size?: StopSize; symbol?: StopSymbol; letter?: string };
export type Route = { id: string; a: string; b: string; length: number; type: RouteType; color: string; points?: Point[]; locomotiveSlots?: number[]; lineStyle?: string; curved?: boolean };
export type LineStyle = { id: string; label: string; strokeWidth: number; dash: string };
export type RouteTypeStyle = { id: string; label: string; stroke: string; dash: string; strokeWidth: number; infrastructure: boolean };
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
export type NoteBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  locked?: boolean;
};
export type MapData = { name: string; format: MapFormat; background: BackgroundShape[]; stops: Stop[]; routes: Route[]; backgroundImage?: BackgroundImage; notes: NoteBox[]; lineStyles: LineStyle[]; routeTypeStyles: RouteTypeStyle[] };

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
  imperial?: string;
  columns: number;
  rows: number;
  custom?: boolean;
  /** A proof sheet, not a finished board: true-scale wagons are sized from a target board instead. */
  testSheet?: boolean;
};

export const mapFormats: Record<MapFormat, MapFormatDefinition> = {
  "board-2x3": { label: "Standard board 2×3 · 790 × 525 mm", shortLabel: "Standard board 2×3", note: "Verified standard Ticket to Ride size", width: W, height: Math.round(W * 525 / 790), widthMm: 790, heightMm: 525, columns: 3, rows: 2 },
  "board-2x3-large": { label: "Large board 2×3 · 972 × 648 mm", shortLabel: "Large board 2×3", note: "Large Anniversary-style size", width: W, height: Math.round(W * 648 / 972), widthMm: 972, heightMm: 648, columns: 3, rows: 2 },
  "board-2x4": { label: "Extended board 2×4 · 1,053 × 526 mm", shortLabel: "Extended board 2×4", note: "Custom size using standard-size square panels", width: W, height: Math.round(W * 526 / 1053), widthMm: 1053, heightMm: 526, columns: 4, rows: 2, custom: true },
  a4: { label: "A4 test sheet · 297 × 210 mm", shortLabel: "A4 test sheet", note: "One landscape test sheet", width: W, height: Math.round(W * 210 / 297), widthMm: 297, heightMm: 210, columns: 1, rows: 1 , testSheet: true },
  a3: { label: "A3 test sheet · 420 × 297 mm", shortLabel: "A3 test sheet", note: "One landscape test sheet", width: W, height: Math.round(W * 297 / 420), widthMm: 420, heightMm: 297, columns: 1, rows: 1 , testSheet: true },
  "us-letter": { label: "US Letter test sheet · 11 × 8.5 in", shortLabel: "US Letter test sheet", note: "One landscape test sheet", width: W, height: Math.round(W * 215.9 / 279.4), widthMm: 279.4, heightMm: 215.9, imperial: "11 × 8.5 in", columns: 1, rows: 1 , testSheet: true },
};

// Footprint of a real plastic train and the spacing a real board gives it, in millimetres.
// `gap` and `endMargin` are not guesses: they come from a least-squares fit over all 101 routes of
// the published Ticket to Ride Europe map, where the distance between two city centres works out
// as 25.6 mm per wagon space plus 14.8 mm of margin at the ends. Scored against that model the
// real board lands between 97% and 106% at every route length, which is what makes it a usable
// reference for "is this route drawn about right". Change these if you measure your own set.
export const realWagon = { length: 20, width: 9, gap: 5.5, endMargin: 15 };

export const stopSizeMeta: Record<StopSize, { label: string; radius: number }> = {
  small: { label: "Small", radius: 6 },
  medium: { label: "Medium", radius: 9 },
  large: { label: "Large", radius: 13 },
};

export const stopSymbolMeta: Record<StopSymbol, { label: string }> = {
  none: { label: "No symbol" },
  dot: { label: "Dot" },
  dash: { label: "Dash" },
  cross: { label: "Cross (X)" },
  letter: { label: "Letter" },
};

export const stopTypeMeta: Record<StopType, { label: string; fill: string; stroke: string }> = {
  city: { label: "City stop", fill: "#fffaf0", stroke: "#721c24" },
  region: { label: "Regional stop", fill: "#fff4dc", stroke: "#b05b2a" },
  brt: { label: "Rapid transit", fill: "#d9f2ef", stroke: "#00877c" },
  rail: { label: "Railway station", fill: "#e8e9eb", stroke: "#292b2f" },
  ferry: { label: "Ferry port", fill: "#dceff8", stroke: "#23749b" },
  outing: { label: "Destination", fill: "#e8f0dc", stroke: "#53723b" },
};

export const defaultRouteTypeStyles: RouteTypeStyle[] = [
  // Card routes carry each route's own wagon colour, so these are told apart by width and dash.
  // `stroke` is only drawn when a type is marked as pre-built infrastructure.
  { id: "city", label: "City route", stroke: "#721c24", dash: "", strokeWidth: 3, infrastructure: false },
  { id: "region", label: "Regional route", stroke: "#b05b2a", dash: "", strokeWidth: 6, infrastructure: false },
  { id: "brt", label: "Rapid transit", stroke: "#00877c", dash: "2 5", strokeWidth: 4, infrastructure: false },
  { id: "ferry", label: "Ferry", stroke: "#23749b", dash: "10 6", strokeWidth: 3, infrastructure: false },
  { id: "rail", label: "Railway", stroke: "#292b2f", dash: "4 4", strokeWidth: 4, infrastructure: true },
  { id: "trail", label: "Trail", stroke: "#53723b", dash: "14 4 2 4", strokeWidth: 5, infrastructure: true },
];

export const routeColors: Record<string, string> = {
  neutral: "#f2ead8", red: "#cf3f3f", blue: "#3b72b9", green: "#4c8b58",
  yellow: "#e2b83b", black: "#3e4146", white: "#fffdf5", orange: "#da7a31", purple: "#8a5aa5",
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
};

export const initialMap: MapData = {
  name: "Example map",
  format: "board-2x3",
  notes: [
    {
      id: "example-note",
      x: 760,
      y: 60,
      width: 250,
      height: 110,
      text: "Evaluation note: use notes like this to record playtesting feedback. They show on screen and in print, but are not part of the finished map.",
    },
  ],
  lineStyles: [
    { id: "example-tunnel", label: "Tunnel", strokeWidth: 7, dash: "2 5" },
  ],
  routeTypeStyles: defaultRouteTypeStyles.map((style) => ({ ...style })),
  background: [
    {
      id: "example-lake",
      type: "area",
      label: "Lake",
      labelPoint: { x: 575, y: 320 },
      points: [{ x: 455, y: 205 }, { x: 620, y: 190 }, { x: 720, y: 300 }, { x: 665, y: 425 }, { x: 500, y: 445 }, { x: 410, y: 325 }],
      fill: "#b8ddea",
      stroke: "#4f8394",
      opacity: 0.65,
      strokeWidth: 3,
      locked: true,
    },
    {
      id: "example-highlands",
      type: "area",
      label: "Highlands",
      labelPoint: { x: 185, y: 545 },
      points: [{ x: 35, y: 445 }, { x: 205, y: 400 }, { x: 345, y: 500 }, { x: 300, y: 690 }, { x: 55, y: 690 }],
      fill: "#c9d9ad",
      stroke: "#718360",
      opacity: 0.55,
      strokeWidth: 3,
      locked: true,
    },
    {
      id: "example-river",
      type: "line",
      label: "River",
      labelPoint: { x: 790, y: 510 },
      points: [{ x: 30, y: 345 }, { x: 240, y: 330 }, { x: 420, y: 385 }, { x: 625, y: 465 }, { x: 830, y: 500 }, { x: 1070, y: 455 }],
      fill: "#000000",
      stroke: "#5b9db4",
      opacity: 0.75,
      strokeWidth: 10,
      locked: true,
    },
    {
      id: "example-north-label",
      type: "label",
      label: "North District",
      points: [{ x: 500, y: 75 }],
      fill: "#000000",
      stroke: "#71685c",
      opacity: 0.8,
      strokeWidth: 0,
      locked: true,
    },
  ],
  stops: [
    { id: "example-westport", name: "Westport", type: "city", x: 130, y: 205, symbol: "dot" },
    { id: "example-pine-hill", name: "Pine Hill", type: "outing", x: 280, y: 575, size: "small" },
    { id: "example-central", name: "Central", type: "rail", x: 420, y: 345 },
    { id: "example-lakeside", name: "Lakeside", type: "city", x: 640, y: 185 },
    { id: "example-old-town", name: "Old Town", type: "region", x: 690, y: 600 },
    { id: "example-harbour", name: "Harbour", type: "ferry", x: 875, y: 455, symbol: "letter", letter: "F" },
    { id: "example-eastgate", name: "Eastgate", type: "brt", x: 980, y: 210, size: "large" },
    { id: "example-quarry", name: "Quarry", type: "outing", x: 1010, y: 625, size: "small" },
  ],
  routes: [
    { id: "example-route-1", a: "example-westport", b: "example-central", length: 4, type: "city", color: "red", points: [{ x: 265, y: 235 }] },
    { id: "example-route-2", a: "example-westport", b: "example-pine-hill", length: 3, type: "region", color: "orange", points: [{ x: 170, y: 420 }] },
    { id: "example-route-3", a: "example-pine-hill", b: "example-central", length: 3, type: "trail", color: "neutral", points: [{ x: 350, y: 500 }] },
    { id: "example-route-4", a: "example-central", b: "example-lakeside", length: 3, type: "rail", color: "neutral", points: [{ x: 525, y: 225 }] },
    { id: "example-route-5", a: "example-central", b: "example-old-town", length: 4, type: "city", color: "blue", points: [{ x: 545, y: 485 }], lineStyle: "example-tunnel" },
    { id: "example-route-6", a: "example-lakeside", b: "example-eastgate", length: 4, type: "brt", color: "neutral", points: [{ x: 815, y: 165 }] },
    { id: "example-route-7", a: "example-lakeside", b: "example-harbour", length: 3, type: "ferry", color: "neutral", points: [{ x: 800, y: 270 }, { x: 855, y: 370 }], locomotiveSlots: [1], curved: true },
    { id: "example-route-8", a: "example-old-town", b: "example-harbour", length: 3, type: "region", color: "green", points: [{ x: 790, y: 585 }] },
    { id: "example-route-9", a: "example-harbour", b: "example-eastgate", length: 3, type: "city", color: "yellow", points: [{ x: 950, y: 335 }] },
    { id: "example-route-10", a: "example-old-town", b: "example-quarry", length: 2, type: "region", color: "purple", points: [{ x: 850, y: 645 }] },
    // A double route: same stops and type as route 1, different wagon colour, drawn alongside it.
    { id: "example-route-11", a: "example-westport", b: "example-central", length: 4, type: "city", color: "black", points: [{ x: 265, y: 235 }] },
  ],
};
