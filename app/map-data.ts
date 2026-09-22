export type StopType = "city" | "region" | "brt" | "rail" | "ferry" | "outing";
export type RouteType = "city" | "region" | "brt" | "ferry" | "rail" | "trail";
export type BackgroundType = "area" | "line" | "label";
export type MapFormat = "board-2x3" | "board-2x3-large" | "board-2x4" | "a4" | "a3";
export type Point = { x: number; y: number };
export type Stop = Point & { id: string; name: string; type: StopType };
export type Route = { id: string; a: string; b: string; length: number; type: RouteType; color: string; points?: Point[] };
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
export type MapData = { name: string; format: MapFormat; background: BackgroundShape[]; stops: Stop[]; routes: Route[] };

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
  "board-2x3": { label: "Standard board 2×3 · 790 × 525 mm", shortLabel: "Standard board 2×3", note: "Verified standard Ticket to Ride size", width: W, height: Math.round(W * 525 / 790), widthMm: 790, heightMm: 525, columns: 3, rows: 2 },
  "board-2x3-large": { label: "Large board 2×3 · 972 × 648 mm", shortLabel: "Large board 2×3", note: "Large Anniversary-style size", width: W, height: Math.round(W * 648 / 972), widthMm: 972, heightMm: 648, columns: 3, rows: 2 },
  "board-2x4": { label: "Extended board 2×4 · 1,053 × 526 mm", shortLabel: "Extended board 2×4", note: "Custom size using standard-size square panels", width: W, height: Math.round(W * 526 / 1053), widthMm: 1053, heightMm: 526, columns: 4, rows: 2, custom: true },
  a4: { label: "A4 test sheet · 297 × 210 mm", shortLabel: "A4 test sheet", note: "One landscape test sheet", width: W, height: Math.round(W * 210 / 297), widthMm: 297, heightMm: 210, columns: 1, rows: 1 },
  a3: { label: "A3 test sheet · 420 × 297 mm", shortLabel: "A3 test sheet", note: "One landscape test sheet", width: W, height: Math.round(W * 297 / 420), widthMm: 420, heightMm: 297, columns: 1, rows: 1 },
};

export const stopTypeMeta: Record<StopType, { label: string; fill: string; stroke: string }> = {
  city: { label: "City stop", fill: "#fffaf0", stroke: "#721c24" },
  region: { label: "Regional stop", fill: "#fff4dc", stroke: "#b05b2a" },
  brt: { label: "Rapid transit", fill: "#d9f2ef", stroke: "#00877c" },
  rail: { label: "Railway station", fill: "#e8e9eb", stroke: "#292b2f" },
  ferry: { label: "Ferry port", fill: "#dceff8", stroke: "#23749b" },
  outing: { label: "Destination", fill: "#e8f0dc", stroke: "#53723b" },
};

export const routeTypeMeta: Record<RouteType, { label: string; stroke: string; dash?: string }> = {
  city: { label: "City route", stroke: "#721c24" },
  region: { label: "Regional route", stroke: "#b05b2a" },
  brt: { label: "Rapid transit", stroke: "#00877c" },
  ferry: { label: "Ferry", stroke: "#23749b", dash: "10 7" },
  rail: { label: "Railway", stroke: "#292b2f", dash: "3 6" },
  trail: { label: "Trail", stroke: "#53723b", dash: "11 6" },
};

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
};

export const initialMap: MapData = {
  name: "Example map",
  format: "board-2x3",
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
    { id: "example-westport", name: "Westport", type: "city", x: 130, y: 205 },
    { id: "example-pine-hill", name: "Pine Hill", type: "outing", x: 280, y: 575 },
    { id: "example-central", name: "Central", type: "rail", x: 420, y: 345 },
    { id: "example-lakeside", name: "Lakeside", type: "city", x: 640, y: 185 },
    { id: "example-old-town", name: "Old Town", type: "region", x: 690, y: 600 },
    { id: "example-harbour", name: "Harbour", type: "ferry", x: 875, y: 455 },
    { id: "example-eastgate", name: "Eastgate", type: "brt", x: 980, y: 210 },
  ],
  routes: [
    { id: "example-route-1", a: "example-westport", b: "example-central", length: 4, type: "city", color: "red", points: [{ x: 265, y: 235 }] },
    { id: "example-route-2", a: "example-westport", b: "example-pine-hill", length: 3, type: "region", color: "orange", points: [{ x: 170, y: 420 }] },
    { id: "example-route-3", a: "example-pine-hill", b: "example-central", length: 3, type: "trail", color: "neutral", points: [{ x: 350, y: 500 }] },
    { id: "example-route-4", a: "example-central", b: "example-lakeside", length: 3, type: "rail", color: "neutral", points: [{ x: 525, y: 225 }] },
    { id: "example-route-5", a: "example-central", b: "example-old-town", length: 4, type: "city", color: "blue", points: [{ x: 545, y: 485 }] },
    { id: "example-route-6", a: "example-lakeside", b: "example-eastgate", length: 4, type: "brt", color: "neutral", points: [{ x: 815, y: 165 }] },
    { id: "example-route-7", a: "example-lakeside", b: "example-harbour", length: 3, type: "ferry", color: "neutral", points: [{ x: 770, y: 315 }] },
    { id: "example-route-8", a: "example-old-town", b: "example-harbour", length: 3, type: "region", color: "green", points: [{ x: 790, y: 585 }] },
    { id: "example-route-9", a: "example-harbour", b: "example-eastgate", length: 3, type: "city", color: "yellow", points: [{ x: 950, y: 335 }] },
  ],
};
