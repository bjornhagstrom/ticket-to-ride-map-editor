"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BarChart3, BusFront, Check, ChevronDown, ChevronUp, Copy, GripVertical, CircleDot, CircleHelp, Crosshair, Download, FileStack, Image as ImageIcon, Layers3, Lightbulb, Link2, Lock, MapPinPlus, Maximize2, Minus, MousePointer2, Pencil, Plus, Printer, Redo2, RotateCcw, Ruler, Save, StickyNote, TrainFront, Trash2, Undo2, Unlock, Upload } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { colorLabels, defaultRouteTypeStyles, emptyMap, initialMap, type LineStyle, mapFormats, type BackgroundImage, type BackgroundShape, type BackgroundType, type ImageCrop, type MapData, type MapFormat, type NoteBox, type Point, realWagon, type Route, type RouteType, type RouteTypeStyle, routeColors, STORAGE_KEY, type Stop, type StopSize, stopSizeMeta, type StopSymbol, stopSymbolMeta, type StopType, stopTypeMeta, W } from "./map-data";

type Tool = "select" | "stop" | "route" | "background" | "note" | "measure";
type MeasureResult = { from: string; to: string; distance: number; routeIds: string[] } | { from: string; to: string; unreachable: true };
type Danger = "reset" | "delete" | "load-blank" | "load-example" | "import-background" | "import-network" | "import-image" | null;
type PendingImport = { kind: "background"; background: BackgroundShape[]; backgroundImage?: BackgroundImage } | { kind: "network"; stops: Stop[]; routes: Route[]; lineStyles: LineStyle[]; routeTypeStyles: RouteTypeStyle[] } | { kind: "image"; image: BackgroundImage };
const GUIDE_SEEN_KEY = `${STORAGE_KEY}-guide-seen`;
const MAX_IMAGE_WARN_BYTES = 2 * 1024 * 1024;
// Snapshots are geometry-only (see cloneForHistory), so a deep stack stays in the low megabytes
// even for a large map. Kept in memory for the session only, never written to local storage.
const HISTORY_LIMIT = 200;
const ROUTE_HINT_KEY = `${STORAGE_KEY}-route-hint`;
const ROUTE_HINT_X_KEY = `${STORAGE_KEY}-route-hint-x`;

const cloneMap = (data: MapData): MapData => JSON.parse(JSON.stringify(data));
// History snapshots deep-clone everything except the background image's base64 payload, which is
// re-attached by reference. Strings are immutable, so every snapshot shares one copy of the image
// instead of carrying its own — without this a single 2 MB image would cost 2 MB per undo step.
const cloneForHistory = (data: MapData): MapData => {
  const image = data.backgroundImage;
  if (!image) return cloneMap(data);
  const clone = cloneMap({ ...data, backgroundImage: { ...image, dataUrl: "" } });
  if (clone.backgroundImage) clone.backgroundImage.dataUrl = image.dataUrl;
  return clone;
};
const isMapFormat = (value: unknown): value is MapFormat => typeof value === "string" && value in mapFormats;
const clamp01 = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const normalizeBackgroundImage = (value: unknown): BackgroundImage | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Partial<BackgroundImage> & { crop?: Partial<ImageCrop> };
  if (typeof v.dataUrl !== "string" || !v.dataUrl.startsWith("data:image/")) return undefined;
  const naturalWidth = typeof v.naturalWidth === "number" && v.naturalWidth > 0 ? v.naturalWidth : 0;
  const naturalHeight = typeof v.naturalHeight === "number" && v.naturalHeight > 0 ? v.naturalHeight : 0;
  if (!naturalWidth || !naturalHeight) return undefined;
  return {
    dataUrl: v.dataUrl,
    naturalWidth,
    naturalHeight,
    x: typeof v.x === "number" ? v.x : 0,
    y: typeof v.y === "number" ? v.y : 0,
    width: typeof v.width === "number" && v.width > 0 ? v.width : naturalWidth,
    height: typeof v.height === "number" && v.height > 0 ? v.height : naturalHeight,
    rotation: typeof v.rotation === "number" ? v.rotation : 0,
    opacity: typeof v.opacity === "number" ? v.opacity : 1,
    crop: { top: clamp01(v.crop?.top), right: clamp01(v.crop?.right), bottom: clamp01(v.crop?.bottom), left: clamp01(v.crop?.left) },
    locked: Boolean(v.locked),
  };
};
const normalizeMap = (value: Partial<MapData>): MapData => ({
  name: typeof value.name === "string" ? value.name : "Imported map",
  format: isMapFormat(value.format) ? value.format : "board-2x3",
  background: Array.isArray(value.background) ? value.background : [],
  stops: Array.isArray(value.stops) ? value.stops : [],
  routes: Array.isArray(value.routes) ? value.routes : [],
  notes: Array.isArray(value.notes) ? value.notes : [],
  lineStyles: Array.isArray(value.lineStyles) ? value.lineStyles : [],
  routeTypeStyles: Array.isArray(value.routeTypeStyles) && value.routeTypeStyles.length ? value.routeTypeStyles : defaultRouteTypeStyles.map((style) => ({ ...style })),
  backgroundImage: normalizeBackgroundImage(value.backgroundImage),
});
const scalePointToHeight = (point: Point, fromHeight: number, toHeight: number): Point => ({ x: point.x, y: point.y * toHeight / fromHeight });
const scaleBackgroundToHeight = (shapes: BackgroundShape[], fromHeight: number, toHeight: number): BackgroundShape[] => shapes.map((shape) => ({ ...shape, points: shape.points.map((point) => scalePointToHeight(point, fromHeight, toHeight)), labelPoint: shape.labelPoint ? scalePointToHeight(shape.labelPoint, fromHeight, toHeight) : undefined }));
const scaleStopsToHeight = (stops: Stop[], fromHeight: number, toHeight: number): Stop[] => stops.map((stop) => ({ ...stop, ...scalePointToHeight(stop, fromHeight, toHeight) }));
const scaleRoutesToHeight = (routes: Route[], fromHeight: number, toHeight: number): Route[] => routes.map((route) => ({ ...route, points: route.points?.map((point) => scalePointToHeight(point, fromHeight, toHeight)) }));
const scaleImageToHeight = (image: BackgroundImage, fromHeight: number, toHeight: number): BackgroundImage => ({ ...image, y: image.y * toHeight / fromHeight, height: image.height * toHeight / fromHeight });
const scaleNotesToHeight = (notes: NoteBox[], fromHeight: number, toHeight: number): NoteBox[] => notes.map((note) => ({ ...note, y: note.y * toHeight / fromHeight, height: note.height * toHeight / fromHeight }));
const sourceHeight = (value: { format?: unknown }): number => mapFormats[isMapFormat(value.format) ? value.format : "board-2x3"].height;
const normalizeBackgroundFile = (value: { format?: unknown; background?: unknown; backgroundImage?: unknown }, toHeight: number): { background: BackgroundShape[]; backgroundImage?: BackgroundImage } => {
  const fromHeight = sourceHeight(value);
  const image = normalizeBackgroundImage(value.backgroundImage);
  return { background: scaleBackgroundToHeight(Array.isArray(value.background) ? value.background : [], fromHeight, toHeight), backgroundImage: image ? scaleImageToHeight(image, fromHeight, toHeight) : undefined };
};
const normalizeNetworkFile = (value: { format?: unknown; stops?: unknown; routes?: unknown; lineStyles?: unknown; routeTypeStyles?: unknown }, toHeight: number): { stops: Stop[]; routes: Route[]; lineStyles: LineStyle[]; routeTypeStyles: RouteTypeStyle[] } => { const fromHeight = sourceHeight(value); return { stops: scaleStopsToHeight(Array.isArray(value.stops) ? value.stops : [], fromHeight, toHeight), routes: scaleRoutesToHeight(Array.isArray(value.routes) ? value.routes : [], fromHeight, toHeight), lineStyles: Array.isArray(value.lineStyles) ? value.lineStyles : [], routeTypeStyles: Array.isArray(value.routeTypeStyles) && value.routeTypeStyles.length ? value.routeTypeStyles : defaultRouteTypeStyles.map((style) => ({ ...style })) }; };
const readBackgroundImage = (file: File): Promise<{ dataUrl: string; naturalWidth: number; naturalHeight: number }> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("Could not read the file"));
  reader.onload = () => {
    const dataUrl = String(reader.result);
    const probe = new Image();
    probe.onload = () => resolve({ dataUrl, naturalWidth: probe.naturalWidth, naturalHeight: probe.naturalHeight });
    probe.onerror = () => reject(new Error("Could not decode the image"));
    probe.src = dataUrl;
  };
  reader.readAsDataURL(file);
});
const stopById = (data: MapData, id: string) => data.stops.find((stop) => stop.id === id);
const pointsFor = (data: MapData, route: Route): Point[] => {
  const a = stopById(data, route.a);
  const b = stopById(data, route.b);
  return a && b ? [a, ...(route.points ?? []), b] : [];
};
const pathFromPoints = (points: Point[]) => points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
// A Catmull-Rom spline through every point, written out as cubic Béziers. The curve passes through
// each bend point, so dragging one still does exactly what it looks like it does.
const curveControls = (points: Point[], index: number) => {
  const p0 = points[index - 1] ?? points[index];
  const p1 = points[index];
  const p2 = points[index + 1];
  const p3 = points[index + 2] ?? p2;
  return {
    p1, p2,
    c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
    c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
  };
};
const curvedPath = (points: Point[]) => {
  if (points.length < 3) return pathFromPoints(points);
  let path = `M${points[0].x},${points[0].y}`;
  for (let index = 0; index < points.length - 1; index++) {
    const { c1, c2, p2 } = curveControls(points, index);
    path += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  }
  return path;
};
// Flatten the same curve into a dense polyline, so wagon slots and their angles follow the drawn
// line instead of the straight polyline underneath it.
const curvedSamples = (points: Point[], perSegment = 12): Point[] => {
  if (points.length < 3) return points;
  const samples: Point[] = [points[0]];
  for (let index = 0; index < points.length - 1; index++) {
    const { p1, c1, c2, p2 } = curveControls(points, index);
    for (let step = 1; step <= perSegment; step++) {
      const t = step / perSegment, u = 1 - t;
      samples.push({
        x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
        y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y,
      });
    }
  }
  return samples;
};

const samePair = (one: Route, other: Route) => (one.a === other.a && one.b === other.b) || (one.a === other.b && one.b === other.a);
function parallelPoints(data: MapData, route: Route): Point[] {
  const siblings = data.routes.filter((item) => samePair(item, route));
  const points = pointsFor(data, route);
  if (siblings.length < 2 || points.length < 2) return points;
  const index = siblings.findIndex((item) => item.id === route.id);
  const direction = route.a.localeCompare(route.b) <= 0 ? 1 : -1;
  const offset = (index - (siblings.length - 1) / 2) * 26 * direction;
  const shifted = (point: Point, from: Point, to: Point, distance: number) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: point.x - dy / length * distance, y: point.y + dx / length * distance };
  };
  // Every point moves sideways, bends included, so the lines of a double route follow each other
  // instead of meeting in the middle. Two siblings sharing the same bend points then run exactly
  // parallel; give one its own bends and they part company where you put them.
  const sideways = points.map((point, i) => shifted(point, points[i === 0 ? 0 : i - 1], points[i === points.length - 1 ? i : i + 1], offset));
  // Both lines still have to reach the same two stops, so they converge over a short run-in at
  // each end rather than along the whole first and last segment.
  const runIn = (from: Point, to: Point) => {
    const distance = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const t = Math.min(.35, Math.abs(offset) * 1.4 / distance);
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  };
  const last = points.length - 1;
  return [points[0], runIn(sideways[0], sideways[1]), ...sideways.slice(1, last), runIn(sideways[last], sideways[last - 1]), points[last]];
}

// How much room each route actually gives its wagons, against how much a real set needs. A route
// drawn much longer than its wagon count looks roomier on screen than the finished board plays;
// one drawn shorter cannot physically hold its own wagons.
export type RouteSpacing = { route: Route; drawnMm: number; neededMm: number; ratio: number; verdict: "short" | "long" | "ok" };
const SPACING_SHORT = 1, SPACING_LONG = 1.3;
function routeSpacing(data: MapData, scaleWidthMm: number): RouteSpacing[] {
  const unitMm = scaleWidthMm / W;
  const pitchMm = realWagon.length + realWagon.gap;
  const infrastructureTypes = new Set(data.routeTypeStyles.filter((style) => style.infrastructure).map((style) => style.id));
  return data.routes.filter((route) => !infrastructureTypes.has(route.type)).map((route) => {
    const geometry = parallelPoints(data, route);
    const points = route.curved && geometry.length > 2 ? curvedSamples(geometry) : geometry;
    const drawnMm = (polylineLength(points) || 1) * unitMm;
    const neededMm = route.length * pitchMm;
    const ratio = drawnMm / neededMm;
    return { route, drawnMm, neededMm, ratio, verdict: ratio < SPACING_SHORT ? "short" : ratio > SPACING_LONG ? "long" : "ok" } as RouteSpacing;
  });
}
const orient = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const intersects = (a: Point, b: Point, c: Point, d: Point) => {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
};
function crossingPairs(data: MapData) {
  const infrastructureTypes = new Set(data.routeTypeStyles.filter((style) => style.infrastructure).map((style) => style.id));
  const routes = data.routes.filter((route) => !infrastructureTypes.has(route.type));
  const found: Array<[Route, Route]> = [];
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
    const a = routes[i], b = routes[j];
    if ([a.a, a.b].some((id) => id === b.a || id === b.b)) continue;
    const ap = pointsFor(data, a), bp = pointsFor(data, b);
    let hit = false;
    for (let x = 0; x < ap.length - 1 && !hit; x++) for (let y = 0; y < bp.length - 1; y++) if (intersects(ap[x], ap[x + 1], bp[y], bp[y + 1])) { hit = true; break; }
    if (hit) found.push([a, b]);
  }
  return found;
}
type NetworkEdge = { to: string; weight: number; routeId: string };
function buildAdjacency(data: MapData): Map<string, NetworkEdge[]> {
  const adjacency = new Map<string, NetworkEdge[]>();
  for (const stop of data.stops) adjacency.set(stop.id, []);
  for (const route of data.routes) {
    if (!adjacency.has(route.a) || !adjacency.has(route.b)) continue;
    adjacency.get(route.a)!.push({ to: route.b, weight: route.length, routeId: route.id });
    adjacency.get(route.b)!.push({ to: route.a, weight: route.length, routeId: route.id });
  }
  return adjacency;
}
type NetworkStats = { neighbours: Map<string, number>; links: Map<string, number>; hubDegree: Map<string, number> };
function networkStats(data: MapData): NetworkStats {
  const neighbourSets = new Map<string, Set<string>>();
  const links = new Map<string, number>();
  for (const stop of data.stops) { neighbourSets.set(stop.id, new Set()); links.set(stop.id, 0); }
  for (const route of data.routes) {
    if (!neighbourSets.has(route.a) || !neighbourSets.has(route.b)) continue;
    neighbourSets.get(route.a)!.add(route.b);
    neighbourSets.get(route.b)!.add(route.a);
    links.set(route.a, (links.get(route.a) ?? 0) + 1);
    links.set(route.b, (links.get(route.b) ?? 0) + 1);
  }
  const neighbours = new Map<string, number>();
  const hubDegree = new Map<string, number>();
  for (const stop of data.stops) {
    const n = neighbourSets.get(stop.id)!.size;
    const l = links.get(stop.id) ?? 0;
    neighbours.set(stop.id, n);
    hubDegree.set(stop.id, n + l);
  }
  return { neighbours, links, hubDegree };
}
function shortestPath(adjacency: Map<string, NetworkEdge[]>, fromId: string, toId: string): { distance: number; routeIds: string[] } | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, { stopId: string; routeId: string }>();
  const visited = new Set<string>();
  for (const id of adjacency.keys()) dist.set(id, Infinity);
  if (!dist.has(fromId)) return null;
  dist.set(fromId, 0);
  for (;;) {
    let current: string | null = null;
    let currentDist = Infinity;
    for (const [id, d] of dist) if (!visited.has(id) && d < currentDist) { current = id; currentDist = d; }
    if (current === null || current === toId) break;
    visited.add(current);
    for (const edge of adjacency.get(current) ?? []) {
      if (visited.has(edge.to)) continue;
      const next = currentDist + edge.weight;
      if (next < (dist.get(edge.to) ?? Infinity)) { dist.set(edge.to, next); prev.set(edge.to, { stopId: current, routeId: edge.routeId }); }
    }
  }
  const total = dist.get(toId);
  if (total === undefined || total === Infinity) return null;
  const routeIds: string[] = [];
  let cursor = toId;
  while (cursor !== fromId) {
    const step = prev.get(cursor);
    if (!step) return null;
    routeIds.unshift(step.routeId);
    cursor = step.stopId;
  }
  return { distance: total, routeIds };
}
type ColourLengthTable = { lengths: number[]; colours: string[]; counts: Map<number, Map<string, number>>; colourTotals: Map<string, number>; lengthTotals: Map<number, number>; grandTotal: number };
function colourLengthTable(data: MapData): ColourLengthTable {
  const infrastructureTypes = new Set(data.routeTypeStyles.filter((style) => style.infrastructure).map((style) => style.id));
  const cardRoutes = data.routes.filter((route) => !infrastructureTypes.has(route.type));
  const colours = Object.keys(routeColors);
  const lengths = Array.from(new Set(cardRoutes.map((route) => route.length))).sort((a, b) => a - b);
  const counts = new Map<number, Map<string, number>>();
  const colourTotals = new Map<string, number>(colours.map((c) => [c, 0]));
  const lengthTotals = new Map<number, number>(lengths.map((l) => [l, 0]));
  for (const length of lengths) counts.set(length, new Map(colours.map((c) => [c, 0])));
  for (const route of cardRoutes) {
    const row = counts.get(route.length);
    if (!row) continue;
    row.set(route.color, (row.get(route.color) ?? 0) + 1);
    colourTotals.set(route.color, (colourTotals.get(route.color) ?? 0) + 1);
    lengthTotals.set(route.length, (lengthTotals.get(route.length) ?? 0) + 1);
  }
  return { lengths, colours, counts, colourTotals, lengthTotals, grandTotal: cardRoutes.length };
}
const pairKey = (a: string, b: string) => [a, b].sort().join("::");
function averageLengthPerDistance(data: MapData): number {
  let totalLength = 0, totalDistance = 0;
  for (const route of data.routes) {
    const a = stopById(data, route.a), b = stopById(data, route.b);
    if (!a || !b) continue;
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    if (distance > 0) { totalLength += route.length; totalDistance += distance; }
  }
  return totalDistance > 0 ? totalLength / totalDistance : 0.01;
}
function leastUsedColourAtLength(table: ColourLengthTable, length: number): string {
  const row = table.counts.get(length);
  let best = table.colours[0] ?? "neutral", bestCount = Infinity;
  for (const colour of table.colours) {
    const count = row?.get(colour) ?? 0;
    if (count < bestCount) { bestCount = count; best = colour; }
  }
  return best;
}
function routeCrossesExisting(data: MapData, a: Point, b: Point, excludeStopIds: [string, string]): boolean {
  for (const route of data.routes) {
    if (excludeStopIds.includes(route.a) || excludeStopIds.includes(route.b)) continue;
    const points = pointsFor(data, route);
    for (let i = 0; i < points.length - 1; i++) if (intersects(a, b, points[i], points[i + 1])) return true;
  }
  return false;
}
type RouteSuggestion = { a: string; b: string; aName: string; bName: string; distance: number; suggestedLength: number; suggestedColor: string; hubSum: number };
function suggestRoutes(data: MapData, stats: NetworkStats, colourTable: ColourLengthTable, k = 5, maxSuggestions = 8): RouteSuggestion[] {
  const existingPairs = new Set(data.routes.map((route) => pairKey(route.a, route.b)));
  const seen = new Set<string>();
  const candidates: Array<{ a: Stop; b: Stop; distance: number }> = [];
  for (const stop of data.stops) {
    const nearest = data.stops
      .filter((other) => other.id !== stop.id)
      .map((other) => ({ other, distance: Math.hypot(other.x - stop.x, other.y - stop.y) }))
      .sort((x, y) => x.distance - y.distance)
      .slice(0, k);
    for (const { other, distance } of nearest) {
      const key = pairKey(stop.id, other.id);
      if (existingPairs.has(key) || seen.has(key)) continue;
      seen.add(key);
      candidates.push({ a: stop, b: other, distance });
    }
  }
  const lengthPerUnit = averageLengthPerDistance(data);
  const scored = candidates
    .filter((candidate) => !routeCrossesExisting(data, candidate.a, candidate.b, [candidate.a.id, candidate.b.id]))
    .map((candidate) => {
      const suggestedLength = Math.max(1, Math.min(8, Math.round(candidate.distance * lengthPerUnit) || 1));
      return {
        a: candidate.a.id, b: candidate.b.id, aName: candidate.a.name, bName: candidate.b.name,
        distance: candidate.distance, suggestedLength, suggestedColor: leastUsedColourAtLength(colourTable, suggestedLength),
        hubSum: (stats.hubDegree.get(candidate.a.id) ?? 0) + (stats.hubDegree.get(candidate.b.id) ?? 0),
      };
    });
  scored.sort((x, y) => x.hubSum - y.hubSum || x.distance - y.distance);
  return scored.slice(0, maxSuggestions);
}
function pointAlong(points: Point[], fraction: number): Point & { angle: number } {
  const lengths = points.slice(1).map((q, i) => Math.hypot(q.x - points[i].x, q.y - points[i].y));
  const total = lengths.reduce((a, b) => a + b, 0);
  let target = total * fraction;
  for (let i = 0; i < lengths.length; i++) {
    if (target <= lengths[i]) {
      const t = lengths[i] ? target / lengths[i] : 0;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t, angle: Math.atan2(points[i + 1].y - points[i].y, points[i + 1].x - points[i].x) * 180 / Math.PI };
    }
    target -= lengths[i];
  }
  return { ...(points.at(-1) ?? { x: 0, y: 0 }), angle: 0 };
}
const polylineLength = (points: Point[]) => points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
function formatTimestamp(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
function canvasPoint(svg: SVGSVGElement, clientX: number, clientY: number, height: number): Point {
  const rect = svg.getBoundingClientRect();
  return { x: Math.max(18, Math.min(W - 18, (clientX - rect.left) * W / rect.width)), y: Math.max(18, Math.min(height - 18, (clientY - rect.top) * height / rect.height)) };
}
function automaticLabelPoint(shape: BackgroundShape, height: number): Point {
  if (!shape.points.length) return { x: W / 2, y: height / 2 };
  return {
    x: shape.points.reduce((sum, point) => sum + point.x, 0) / shape.points.length,
    y: shape.points.reduce((sum, point) => sum + point.y, 0) / shape.points.length,
  };
}

export function MapEditor() {
  const [data, setData] = useState<MapData>(emptyMap);
  const [ready, setReady] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [saved, setSaved] = useState(true);
  const [tool, setTool] = useState<Tool>("select");
  const [stopType, setStopType] = useState<StopType>("city");
  const [stopSize, setStopSize] = useState<StopSize>("medium");
  const [routeType, setRouteType] = useState<RouteType>("city");
  const [routeColor, setRouteColor] = useState("neutral");
  const [routeLineStyle, setRouteLineStyle] = useState<string | undefined>(undefined);
  const [stopSymbol, setStopSymbol] = useState<StopSymbol>("none");
  const [stopLetter, setStopLetter] = useState("");
  const [backgroundType, setBackgroundType] = useState<BackgroundType>("area");
  const [backgroundFill, setBackgroundFill] = useState("#b8ddea");
  const [backgroundStroke, setBackgroundStroke] = useState("#4f8394");
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [routeStart, setRouteStart] = useState<string | null>(null);
  const [trueScale, setTrueScale] = useState(false);
  const [routeHintOpen, setRouteHintOpen] = useState(true);
  const [linkParallel, setLinkParallel] = useState(true);
  // Collapsing the help is a lasting preference, not a per-selection one: reopening it on the next
  // route you click would defeat the point of hiding it.
  const [routeHintX, setRouteHintX] = useState(0);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(ROUTE_HINT_KEY) === "closed") setRouteHintOpen(false);
      const x = Number(window.localStorage.getItem(ROUTE_HINT_X_KEY));
      if (Number.isFinite(x) && x) setRouteHintX(x);
    } catch { /* private mode */ }
  }, []);
  const moveRouteHint = (value: number) => {
    setRouteHintX(value);
    try { window.localStorage.setItem(ROUTE_HINT_X_KEY, String(Math.round(value))); } catch { /* private mode */ }
  };
  const toggleRouteHint = () => setRouteHintOpen((open) => {
    try { window.localStorage.setItem(ROUTE_HINT_KEY, open ? "closed" : "open"); } catch { /* private mode */ }
    return !open;
  });
  const [scaleTarget, setScaleTarget] = useState<MapFormat>("board-2x3");
  const [measureStart, setMeasureStart] = useState<string | null>(null);
  const [measureResult, setMeasureResult] = useState<MeasureResult | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedStop, setSelectedStop] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [selectedBackground, setSelectedBackground] = useState<string | null>(null);
  const [imageSelected, setImageSelected] = useState(false);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [past, setPast] = useState<MapData[]>([]);
  const [future, setFuture] = useState<MapData[]>([]);
  const [danger, setDanger] = useState<Danger>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const dragStopRef = useRef<string | null>(null);
  const dragWaypointRef = useRef<{ routeId: string; index: number } | null>(null);
  const dragBackgroundPointRef = useRef<{ shapeId: string; index: number } | null>(null);
  const dragBackgroundLabelRef = useRef<string | null>(null);
  const dragImageRef = useRef<{ mode: "move"; offsetX: number; offsetY: number } | { mode: "scale" | "rotate" } | null>(null);
  const dragNoteRef = useRef<{ id: string; mode: "move"; offsetX: number; offsetY: number } | { id: string; mode: "resize" } | null>(null);
  const dragSnapshotRef = useRef<MapData | null>(null);
  const draggedRef = useRef(false);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  const fileRef = useRef<HTMLInputElement>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const format = mapFormats[data.format];
  const panelWidthMm = Math.round(format.widthMm / format.columns);
  const panelHeightMm = Math.round(format.heightMm / format.rows);

  useEffect(() => { queueMicrotask(() => { try { const stored = localStorage.getItem(STORAGE_KEY); if (stored) { setData(normalizeMap(JSON.parse(stored))); localStorage.setItem(GUIDE_SEEN_KEY, "1"); } else if (!localStorage.getItem(GUIDE_SEEN_KEY)) setShowGuide(true); } catch { /* ignore invalid local state */ } setReady(true); }); }, []);
  useEffect(() => { if (!ready) return; localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); const timer = window.setTimeout(() => setSaved(true), 0); return () => window.clearTimeout(timer); }, [data, ready]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = event.target as HTMLElement | null;
      // Leave the browser's own text undo alone while typing in a field.
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      event.preventDefault();
      if (key === "y" || event.shiftKey) redoRef.current(); else undoRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // A test sheet is a shrunken proof of a real board, so wagons are sized from the board it stands
  // in for and then shrink with the print. A board format is measured against itself.
  const scaleWidthMm = mapFormats[data.format].testSheet ? mapFormats[scaleTarget].widthMm : mapFormats[data.format].widthMm;
  const crossings = useMemo(() => crossingPairs(data), [data]);
  // Routes drawn too short to hold their own wagons at real component size.
  const spacing = useMemo(() => routeSpacing(data, scaleWidthMm), [data, scaleWidthMm]);
  const tightRoutes = spacing.filter((item) => item.verdict === "short");
  const looseRoutes = spacing.filter((item) => item.verdict === "long");
  const adjacency = useMemo(() => buildAdjacency(data), [data]);
  const stats = useMemo(() => networkStats(data), [data]);
  const colourTable = useMemo(() => colourLengthTable(data), [data]);
  const lowConnectionStops = useMemo(() => data.stops.filter((stop) => (stats.neighbours.get(stop.id) ?? 0) < 2), [data.stops, stats]);
  const avgHubDegree = data.stops.length ? Array.from(stats.hubDegree.values()).reduce((sum, value) => sum + value, 0) / data.stops.length : 0;
  const suggestions = useMemo(() => suggestRoutes(data, stats, colourTable), [data, stats, colourTable]);
  const selectedS = data.stops.find((stop) => stop.id === selectedStop);
  const selectedR = data.routes.find((route) => route.id === selectedRoute);
  // Put the shape hint on whichever edge of the board the selected route is furthest from,
  // so it never covers the bend points you are about to drag.
  const selectedRouteHasSlots = Boolean(selectedR) && !(data.routeTypeStyles.find((style) => style.id === selectedR?.type)?.infrastructure ?? false);
  const routeHintAtTop = selectedR ? (() => {
    const points = pointsFor(data, selectedR);
    if (!points.length) return false;
    return points.reduce((sum, point) => sum + point.y, 0) / points.length > format.height / 2;
  })() : false;
  const selectedB = data.background.find((shape) => shape.id === selectedBackground);
  const selectedN = data.notes.find((note) => note.id === selectedNote);
  const change = (fn: (draft: MapData) => MapData) => setData((previous) => { setPast((history) => [...history, cloneForHistory(previous)].slice(-HISTORY_LIMIT)); setFuture([]); setSaved(false); return fn(cloneMap(previous)); });
  const pushHistory = (snapshot: MapData) => { setPast((history) => [...history, snapshot].slice(-HISTORY_LIMIT)); setFuture([]); setSaved(false); };
  const beginDrag = () => { dragSnapshotRef.current = cloneForHistory(data); draggedRef.current = false; };
  const clearSelection = () => { setSelectedStop(null); setSelectedRoute(null); setSelectedBackground(null); setImageSelected(false); setSelectedNote(null); };
  const chooseImage = () => { setImageSelected(true); setSelectedStop(null); setSelectedRoute(null); setSelectedBackground(null); setSelectedNote(null); setTool("select"); };
  const chooseNote = (id: string) => { setSelectedNote(id); setSelectedStop(null); setSelectedRoute(null); setSelectedBackground(null); setImageSelected(false); setTool("select"); };
  const selectTool = (next: Tool) => {
    setTool(next);
    setRouteStart(null);
    setDraftPoints([]);
    setMeasureStart(null);
    if (next === "measure") setMeasureResult(null);
    if (next !== "select") clearSelection();
  };
  const undo = () => { const previous = past.at(-1); if (!previous) return; setFuture((items) => [cloneForHistory(data), ...items]); setData(previous); setPast((items) => items.slice(0, -1)); clearSelection(); };
  const redo = () => { const next = future[0]; if (!next) return; setPast((items) => [...items, cloneForHistory(data)]); setData(next); setFuture((items) => items.slice(1)); clearSelection(); };
  undoRef.current = undo;
  redoRef.current = redo;

  const hasContent = data.stops.length > 0 || data.routes.length > 0 || data.background.length > 0 || data.notes.length > 0 || Boolean(data.backgroundImage);
  const dismissGuide = () => { try { localStorage.setItem(GUIDE_SEEN_KEY, "1"); } catch { /* ignore unavailable storage */ } setShowGuide(false); };
  const applyGuideChoice = (map: MapData) => { change(() => cloneMap(map)); clearSelection(); setDraftPoints([]); setTool("select"); dismissGuide(); setDanger(null); };
  const chooseFromGuide = (kind: "blank" | "example") => {
    if (hasContent) { setDanger(kind === "blank" ? "load-blank" : "load-example"); return; }
    applyGuideChoice(kind === "blank" ? emptyMap : initialMap);
  };

  const chooseStop = (id: string) => {
    if (tool === "route") {
      if (!routeStart) { setRouteStart(id); return; }
      if (routeStart === id) { setRouteStart(null); return; }
      change((draft) => { draft.routes.push({ id: `r-${Date.now()}`, a: routeStart, b: id, length: 2, type: routeType, color: routeColor, lineStyle: routeLineStyle }); return draft; });
      setRouteStart(null);
      return;
    }
    if (tool === "measure") {
      if (!measureStart) { setMeasureStart(id); setMeasureResult(null); return; }
      if (measureStart === id) { setMeasureStart(null); return; }
      const path = shortestPath(adjacency, measureStart, id);
      setMeasureResult(path ? { from: measureStart, to: id, distance: path.distance, routeIds: path.routeIds } : { from: measureStart, to: id, unreachable: true });
      setMeasureStart(null);
      return;
    }
    setSelectedStop(id); setSelectedRoute(null); setSelectedBackground(null);
  };
  const finishBackground = () => {
    const minimum = backgroundType === "area" ? 3 : 2;
    if (draftPoints.length < minimum) return;
    const id = `bg-${Date.now()}`;
    const shape: BackgroundShape = { id, type: backgroundType, label: backgroundType === "area" ? "Area" : "Boundary", points: draftPoints, fill: backgroundFill, stroke: backgroundStroke, opacity: .65, strokeWidth: 3 };
    change((draft) => { draft.background.push(shape); return draft; });
    setDraftPoints([]); setSelectedBackground(id); setSelectedStop(null); setSelectedRoute(null); setTool("select");
  };
  const onCanvasDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const target = event.target as SVGElement;
    if (target !== event.currentTarget && !target.classList.contains("map-bg")) return;
    const point = canvasPoint(event.currentTarget, event.clientX, event.clientY, format.height);
    if (tool === "stop") {
      change((draft) => { draft.stops.push({ id: `s-${Date.now()}`, name: "New stop", type: stopType, size: stopSize, symbol: stopSymbol, letter: stopSymbol === "letter" ? stopLetter || "A" : undefined, ...point }); return draft; });
      return;
    }
    if (tool === "background") {
      if (backgroundType === "label") {
        const id = `bg-${Date.now()}`;
        change((draft) => { draft.background.push({ id, type: "label", label: "Label", points: [point], fill: "#000000", stroke: backgroundStroke, opacity: 1, strokeWidth: 0 }); return draft; });
        setSelectedBackground(id); setTool("select");
      } else setDraftPoints((points) => [...points, point]);
      return;
    }
    if (tool === "note") {
      const id = `note-${Date.now()}`;
      const width = 220, height = 110;
      change((draft) => { draft.notes.push({ id, x: point.x - width / 2, y: point.y - height / 2, width, height, text: "Evaluation note" }); return draft; });
      chooseNote(id);
      return;
    }
    clearSelection();
  };
  const onCanvasMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = canvasPoint(event.currentTarget, event.clientX, event.clientY, format.height);
    if (dragNoteRef.current || dragImageRef.current || dragBackgroundLabelRef.current || dragBackgroundPointRef.current || dragWaypointRef.current || dragStopRef.current) draggedRef.current = true;
    if (dragNoteRef.current) {
      const drag = dragNoteRef.current;
      setData((current) => ({
        ...current,
        notes: current.notes.map((note) => {
          if (note.id !== drag.id) return note;
          if (drag.mode === "move") return { ...note, x: point.x - drag.offsetX, y: point.y - drag.offsetY };
          return { ...note, width: Math.max(90, point.x - note.x), height: Math.max(50, point.y - note.y) };
        }),
      }));
      setSaved(false); return;
    }
    if (dragImageRef.current) {
      const drag = dragImageRef.current;
      setData((current) => {
        const img = current.backgroundImage;
        if (!img) return current;
        if (drag.mode === "move") return { ...current, backgroundImage: { ...img, x: point.x - drag.offsetX, y: point.y - drag.offsetY } };
        if (drag.mode === "scale") return { ...current, backgroundImage: { ...img, width: Math.max(20, point.x - img.x), height: Math.max(20, point.y - img.y) } };
        const cx = img.x + img.width / 2, cy = img.y + img.height / 2;
        const rotation = Math.atan2(point.y - cy, point.x - cx) * 180 / Math.PI + 90;
        return { ...current, backgroundImage: { ...img, rotation } };
      });
      setSaved(false); return;
    }
    if (dragBackgroundLabelRef.current) {
      const shapeId = dragBackgroundLabelRef.current;
      setData((current) => ({ ...current, background: current.background.map((shape) => shape.id === shapeId ? { ...shape, labelPoint: point } : shape) }));
      setSaved(false); return;
    }
    if (dragBackgroundPointRef.current) {
      const target = dragBackgroundPointRef.current;
      setData((current) => ({ ...current, background: current.background.map((shape) => shape.id === target.shapeId ? { ...shape, points: shape.points.map((item, index) => index === target.index ? point : item) } : shape) }));
      setSaved(false); return;
    }
    if (dragWaypointRef.current) {
      const target = dragWaypointRef.current;
      setData((current) => {
        const dragged = current.routes.find((route) => route.id === target.routeId);
        const linked = new Set((dragged && linkParallel ? current.routes.filter((route) => samePair(route, dragged)) : dragged ? [dragged] : []).map((route) => route.id));
        return { ...current, routes: current.routes.map((route) => linked.has(route.id) && (route.points?.length ?? 0) > target.index ? { ...route, points: (route.points ?? []).map((item, index) => index === target.index ? point : item) } : route) };
      });
      setSaved(false); return;
    }
    if (!dragStopRef.current) return;
    setData((current) => ({ ...current, stops: current.stops.map((stop) => stop.id === dragStopRef.current ? { ...stop, ...point } : stop) }));
    setSaved(false);
  };
  const stopDragging = () => {
    // Only a drag that actually moved something becomes an undo step — a plain click to select
    // sets the same refs and should not fill the history with no-ops.
    if (draggedRef.current && dragSnapshotRef.current) pushHistory(dragSnapshotRef.current);
    dragSnapshotRef.current = null;
    draggedRef.current = false;
    dragStopRef.current = null; dragWaypointRef.current = null; dragBackgroundPointRef.current = null; dragBackgroundLabelRef.current = null; dragImageRef.current = null; dragNoteRef.current = null;
  };
  const deleteSelected = () => {
    change((draft) => {
      if (imageSelected) draft.backgroundImage = undefined;
      if (selectedNote) draft.notes = draft.notes.filter((note) => note.id !== selectedNote);
      if (selectedBackground) draft.background = draft.background.filter((shape) => shape.id !== selectedBackground);
      if (selectedRoute) draft.routes = draft.routes.filter((route) => route.id !== selectedRoute);
      if (selectedStop) { draft.stops = draft.stops.filter((stop) => stop.id !== selectedStop); draft.routes = draft.routes.filter((route) => route.a !== selectedStop && route.b !== selectedStop); }
      return draft;
    });
    clearSelection(); setDanger(null);
  };
  const toggleLocomotiveSlot = (routeId: string, index: number) => {
    change((draft) => {
      const route = draft.routes.find((item) => item.id === routeId);
      if (!route) return draft;
      const slots = new Set(route.locomotiveSlots ?? []);
      if (slots.has(index)) slots.delete(index); else slots.add(index);
      route.locomotiveSlots = [...slots].sort((a, b) => a - b);
      return draft;
    });
  };

  // A classic double route: a second line between the same two stops, in a colour that pair does
  // not use yet. Both lines are drawn side by side automatically by parallelPoints.
  const addParallelRoute = (routeId: string) => {
    const id = `r-${Date.now()}`;
    change((draft) => {
      const source = draft.routes.find((item) => item.id === routeId);
      if (!source) return draft;
      const siblings = draft.routes.filter((item) => samePair(item, source));
      const used = new Set(siblings.map((item) => item.color));
      const colour = Object.keys(routeColors).find((key) => key !== "neutral" && !used.has(key)) ?? source.color;
      draft.routes.push({ ...source, id, color: colour, points: source.points?.map((point) => ({ ...point })) });
      return draft;
    });
    setSelectedRoute(id);
  };
  // Bending one line of a double route normally has to move the other with it, or the two stop
  // being parallel the moment you shape them. Unticking the link is how you split them up.
  const bendTargets = (draft: MapData, routeId: string) => {
    const route = draft.routes.find((item) => item.id === routeId);
    if (!route) return [];
    if (!linkParallel) return [route];
    return draft.routes.filter((item) => samePair(item, route));
  };
  const straightenRoute = (routeId: string) => change((draft) => { for (const route of bendTargets(draft, routeId)) route.points = undefined; return draft; });
  const setRouteCurved = (routeId: string, curved: boolean) => change((draft) => { for (const route of bendTargets(draft, routeId)) route.curved = curved || undefined; return draft; });
  const insertRouteBend = (routeId: string, index: number, point: Point) => change((draft) => { for (const route of bendTargets(draft, routeId)) { const points = [...(route.points ?? [])]; points.splice(index, 0, { ...point }); route.points = points; } return draft; });
  const removeRouteBend = (routeId: string, index: number) => change((draft) => { for (const route of bendTargets(draft, routeId)) { if (!route.points) continue; const points = route.points.filter((_, item) => item !== index); route.points = points.length ? points : undefined; } return draft; });
  const assignRouteLineStyle = (routeId: string, styleId: string | undefined) => change((draft) => { const route = draft.routes.find((item) => item.id === routeId); if (route) route.lineStyle = styleId; return draft; });
  const addSuggestedRoute = (suggestion: RouteSuggestion) => change((draft) => { draft.routes.push({ id: `r-${Date.now()}`, a: suggestion.a, b: suggestion.b, length: suggestion.suggestedLength, type: routeType, color: suggestion.suggestedColor }); return draft; });
  const addLineStyleToRoute = (routeId: string) => { const id = `style-${Date.now()}`; change((draft) => { draft.lineStyles.push({ id, label: "New style", strokeWidth: 6, dash: "10 6" }); const route = draft.routes.find((item) => item.id === routeId); if (route) route.lineStyle = id; return draft; }); };
  const createLineStyle = (): string => { const id = `style-${Date.now()}`; change((draft) => { draft.lineStyles.push({ id, label: "New style", strokeWidth: 6, dash: "10 6" }); return draft; }); return id; };
  const updateLineStyle = (styleId: string, values: Partial<LineStyle>) => change((draft) => { const style = draft.lineStyles.find((item) => item.id === styleId); if (style) Object.assign(style, values); return draft; });
  const deleteLineStyle = (styleId: string) => { change((draft) => { draft.lineStyles = draft.lineStyles.filter((item) => item.id !== styleId); draft.routes = draft.routes.map((route) => route.lineStyle === styleId ? { ...route, lineStyle: undefined } : route); return draft; }); setRouteLineStyle((current) => current === styleId ? undefined : current); };
  const newRouteTypeStyle = (): RouteTypeStyle => ({ id: `type-${Date.now()}`, label: "New type", stroke: "#736d64", dash: "", strokeWidth: 3, infrastructure: false });
  const createRouteType = (): string => { const style = newRouteTypeStyle(); change((draft) => { draft.routeTypeStyles.push(style); return draft; }); return style.id; };
  const addRouteTypeToRoute = (routeId: string) => { const style = newRouteTypeStyle(); change((draft) => { draft.routeTypeStyles.push(style); const route = draft.routes.find((item) => item.id === routeId); if (route) route.type = style.id; return draft; }); };
  const updateRouteType = (typeId: string, values: Partial<RouteTypeStyle>) => change((draft) => { const style = draft.routeTypeStyles.find((item) => item.id === typeId); if (style) Object.assign(style, values); return draft; });
  const deleteRouteType = (typeId: string) => {
    if (data.routes.some((route) => route.type === typeId) || data.routeTypeStyles.length <= 1) return;
    change((draft) => { draft.routeTypeStyles = draft.routeTypeStyles.filter((item) => item.id !== typeId); return draft; });
    if (routeType === typeId) setRouteType(data.routeTypeStyles.find((style) => style.id !== typeId)?.id ?? typeId);
  };
  const downloadJson = (payload: unknown, filenameBase: string) => { const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${filenameBase.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "map"}-${formatTimestamp()}.json`; link.click(); URL.revokeObjectURL(url); };
  const exportMap = () => downloadJson({ kind: "map", ...data }, data.name);
  const exportBackground = () => downloadJson({ kind: "background", format: data.format, background: data.background, backgroundImage: data.backgroundImage }, `${data.name} background`);
  const exportNetwork = () => downloadJson({ kind: "network", format: data.format, stops: data.stops, routes: data.routes, lineStyles: data.lineStyles, routeTypeStyles: data.routeTypeStyles }, `${data.name} network`);
  const applyBackgroundImport = (background: BackgroundShape[], backgroundImage?: BackgroundImage) => { change((draft) => ({ ...draft, background, backgroundImage })); clearSelection(); setDanger(null); setPendingImport(null); };
  const applyNetworkImport = (stops: Stop[], routes: Route[], lineStyles: LineStyle[], routeTypeStyles: RouteTypeStyle[]) => { change((draft) => ({ ...draft, stops, routes, lineStyles, routeTypeStyles })); clearSelection(); setDanger(null); setPendingImport(null); };
  const applyImageImport = (image: BackgroundImage) => { change((draft) => ({ ...draft, backgroundImage: image })); chooseImage(); setDanger(null); setPendingImport(null); };
  const importMap = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result));
        if (raw && raw.kind === "background") {
          const { background, backgroundImage } = normalizeBackgroundFile(raw, format.height);
          if (data.background.length || data.backgroundImage) { setPendingImport({ kind: "background", background, backgroundImage }); setDanger("import-background"); }
          else applyBackgroundImport(background, backgroundImage);
          return;
        }
        if (raw && raw.kind === "network") {
          const { stops, routes, lineStyles, routeTypeStyles } = normalizeNetworkFile(raw, format.height);
          if (data.stops.length || data.routes.length) { setPendingImport({ kind: "network", stops, routes, lineStyles, routeTypeStyles }); setDanger("import-network"); }
          else applyNetworkImport(stops, routes, lineStyles, routeTypeStyles);
          return;
        }
        const incoming = normalizeMap(raw);
        change(() => incoming);
        clearSelection();
      } catch { window.alert("The file could not be read as a map project."); }
    };
    reader.readAsText(file);
  };
  const importBackgroundImage = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { window.alert("Please choose a PNG, JPEG or WebP image."); return; }
    if (file.size > MAX_IMAGE_WARN_BYTES) toast.warning(`This image is about ${(file.size / (1024 * 1024)).toFixed(1)} MB. The saved map file will be large.`);
    try {
      const { dataUrl, naturalWidth, naturalHeight } = await readBackgroundImage(file);
      const scale = Math.min((W * 0.9) / naturalWidth, (format.height * 0.9) / naturalHeight, 1);
      const width = naturalWidth * scale;
      const height = naturalHeight * scale;
      const image: BackgroundImage = { dataUrl, naturalWidth, naturalHeight, x: (W - width) / 2, y: (format.height - height) / 2, width, height, rotation: 0, opacity: 1, crop: { top: 0, right: 0, bottom: 0, left: 0 } };
      if (data.backgroundImage) { setPendingImport({ kind: "image", image }); setDanger("import-image"); }
      else applyImageImport(image);
    } catch { window.alert("The image could not be read."); }
  };
  const changeFormat = (nextFormat: MapFormat) => {
    if (nextFormat === data.format) return;
    change((draft) => {
      const fromHeight = mapFormats[draft.format].height;
      const toHeight = mapFormats[nextFormat].height;
      draft.stops = scaleStopsToHeight(draft.stops, fromHeight, toHeight);
      draft.routes = scaleRoutesToHeight(draft.routes, fromHeight, toHeight);
      draft.background = scaleBackgroundToHeight(draft.background, fromHeight, toHeight);
      draft.backgroundImage = draft.backgroundImage ? scaleImageToHeight(draft.backgroundImage, fromHeight, toHeight) : draft.backgroundImage;
      draft.notes = scaleNotesToHeight(draft.notes, fromHeight, toHeight);
      draft.format = nextFormat;
      return draft;
    });
    setDraftPoints([]);
    clearSelection();
  };

  return <TooltipProvider delayDuration={0} disableHoverableContent><main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><BusFront /></span><div><p>Ticket to Ride</p><h1>Map editor – Print and draw</h1></div></div>
      <div className="map-title"><Label htmlFor="map-name" className="sr-only">Map name</Label><Input id="map-name" value={data.name} onChange={(event) => change((draft) => ({ ...draft, name: event.target.value }))} /><span className="save-state"><Check />{saved ? "Saved locally" : "Saving…"}</span></div>
      <div className="header-actions"><Button variant="outline" size="sm" onClick={() => setShowGuide(true)}><CircleHelp />Help</Button><Button variant="ghost" size="icon" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={!past.length} onClick={undo}><Undo2 /></Button><Button variant="ghost" size="icon" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!future.length} onClick={redo}><Redo2 /></Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm"><Upload />Import</Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onClick={() => fileRef.current?.click()}><Upload />Map project</DropdownMenuItem><DropdownMenuItem onClick={() => imageFileRef.current?.click()}><ImageIcon />Background image</DropdownMenuItem></DropdownMenuContent></DropdownMenu><input ref={fileRef} hidden type="file" accept="application/json" onChange={(event) => { importMap(event.target.files?.[0]); event.target.value = ""; }} /><input ref={imageFileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { importBackgroundImage(event.target.files?.[0]); event.target.value = ""; }} /><Button variant="outline" size="sm" onClick={() => window.print()}><Printer />Print {format.shortLabel}</Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm"><Download />Export</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={exportMap}><Download />Full map</DropdownMenuItem><DropdownMenuItem onClick={exportBackground}><Layers3 />Background only</DropdownMenuItem><DropdownMenuItem onClick={exportNetwork}><Link2 />Network only</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
    </header>
    <div className="workspace">
      <aside className="tools-panel panel">
        <div className="panel-heading"><span>Tools</span><small>Work directly on the map</small></div>
        <div className="tool-row">{toolDefinitions.map((item) => <ToolButton key={item.id} active={tool === item.id} icon={item.icon} title={item.title} note={item.note} onClick={() => selectTool(item.id)} />)}</div>
        <div className="tool-panel">
          {tool === "route" && <p className="tool-status">{routeStart ? `Start: ${stopById(data, routeStart)?.name} · now click the destination stop` : "Click two stops to connect them."}</p>}
          {tool === "measure" && <p className="tool-status">{measureStart ? `From ${stopById(data, measureStart)?.name} · now click the destination stop` : measureResult ? ("unreachable" in measureResult ? `${stopById(data, measureResult.from)?.name} → ${stopById(data, measureResult.to)?.name}: no connected path` : `${stopById(data, measureResult.from)?.name} → ${stopById(data, measureResult.to)?.name}: ${measureResult.distance} wagon spaces`) : "Click two stops for the shortest path."}</p>}
          {tool === "stop" && <div className="tool-options"><div className="grid-two"><div><Label>Stop type</Label><NativeSelect value={stopType} onChange={(event) => setStopType(event.target.value as StopType)}>{Object.entries(stopTypeMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div><div><Label>Stop size</Label><NativeSelect value={stopSize} onChange={(event) => setStopSize(event.target.value as StopSize)}>{Object.entries(stopSizeMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div></div><div className="grid-two"><div><Label>Symbol</Label><NativeSelect value={stopSymbol} onChange={(event) => setStopSymbol(event.target.value as StopSymbol)}>{Object.entries(stopSymbolMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div>{stopSymbol === "letter" && <div><Label>Letter</Label><Input maxLength={2} value={stopLetter} onChange={(event) => setStopLetter(event.target.value)} /></div>}</div></div>}
          {tool === "route" && <div className="tool-options"><RouteTypeEditor typeId={routeType} routeTypeStyles={data.routeTypeStyles} routes={data.routes} onSelectType={setRouteType} onCreateType={() => setRouteType(createRouteType())} onUpdateType={updateRouteType} onDeleteType={deleteRouteType} /><div><Label>Colour</Label><NativeSelect value={routeColor} onChange={(event) => setRouteColor(event.target.value)}>{Object.keys(routeColors).map((key) => <NativeSelectOption key={key} value={key}>{colorLabels[key]}</NativeSelectOption>)}</NativeSelect></div><LineStylePicker value={routeLineStyle} lineStyles={data.lineStyles} onChange={setRouteLineStyle} onCreate={() => setRouteLineStyle(createLineStyle())} onUpdate={updateLineStyle} onDelete={deleteLineStyle} helper="New routes you draw will use this style. Change it anytime for an existing route from its Properties panel." /></div>}
          {tool === "background" && <div className="tool-options background-tools"><div className="image-import-row"><Label>Background image</Label><div className="image-import-buttons"><Button size="sm" variant="outline" onClick={() => imageFileRef.current?.click()}><ImageIcon />{data.backgroundImage ? "Replace image" : "Import image"}</Button>{data.backgroundImage && <Button size="sm" variant="ghost" onClick={() => { chooseImage(); setDanger("delete"); }}><Trash2 />Remove</Button>}</div></div><Label>Object</Label><NativeSelect value={backgroundType} onChange={(event) => { setBackgroundType(event.target.value as BackgroundType); setDraftPoints([]); }}><NativeSelectOption value="area">Area</NativeSelectOption><NativeSelectOption value="line">Line</NativeSelectOption><NativeSelectOption value="label">Label</NativeSelectOption></NativeSelect>{backgroundType !== "label" && <><div className="colour-row"><label>Fill <input type="color" value={backgroundFill} onChange={(event) => setBackgroundFill(event.target.value)} disabled={backgroundType === "line"} /></label><label>Outline <input type="color" value={backgroundStroke} onChange={(event) => setBackgroundStroke(event.target.value)} /></label></div><p className="helper">Click to add points. Finish when the shape is ready.</p><div className="draft-actions"><Button size="sm" disabled={draftPoints.length < (backgroundType === "area" ? 3 : 2)} onClick={finishBackground}>Finish shape</Button><Button size="sm" variant="ghost" disabled={!draftPoints.length} onClick={() => setDraftPoints([])}>Cancel</Button></div></>}</div>}
        </div>
        <div className="format-control"><Label htmlFor="map-format">Board format</Label><NativeSelect id="map-format" value={data.format} onChange={(event) => changeFormat(event.target.value as MapFormat)}>{Object.entries(mapFormats).map(([key, item]) => <NativeSelectOption key={key} value={key}>{item.label}</NativeSelectOption>)}</NativeSelect><dl className="format-measurements"><div><dt>Finished size</dt><dd>{format.widthMm.toLocaleString("en-GB")} × {format.heightMm.toLocaleString("en-GB")} mm{format.imperial ? ` (${format.imperial})` : ""}</dd></div>{format.columns > 1 && <div><dt>Panel size</dt><dd>about {panelWidthMm} × {panelHeightMm} mm</dd></div>}</dl><p>{format.note}{format.custom ? ". This is not a verified commercial Ticket to Ride size" : ""}. Changing format keeps objects in the same relative positions.</p></div>
        <div className="scale-control">
          <label className="checkbox-row"><input type="checkbox" checked={trueScale} onChange={(event) => setTrueScale(event.target.checked)} />True-scale wagons</label>
          {format.testSheet && <div><Label htmlFor="scale-target">Printed as a proof of</Label><NativeSelect id="scale-target" value={scaleTarget} onChange={(event) => setScaleTarget(event.target.value as MapFormat)}>{Object.entries(mapFormats).filter(([, item]) => !item.testSheet).map(([key, item]) => <NativeSelectOption key={key} value={key}>{item.shortLabel}</NativeSelectOption>)}</NativeSelect></div>}
          <p className="helper">Sizes the wagon spaces from a real {realWagon.length} × {realWagon.width} mm train on a {scaleWidthMm.toLocaleString("en-GB")} mm board{format.testSheet ? `, shrunk with the sheet to about ${(realWagon.length / scaleWidthMm * format.widthMm).toFixed(1)} mm each in print` : ", so printing this format at full size gives real-size wagons"}. {tightRoutes.length || looseRoutes.length ? `${[tightRoutes.length && `${tightRoutes.length} too short`, looseRoutes.length && `${looseRoutes.length} roomier than needed`].filter(Boolean).join(", ")} — see Analyze balance.` : "Every route is drawn about the length its wagon count needs."}</p>
        </div>
        <Tooltip><TooltipTrigger asChild>
          <div className={cn("crossing-card", crossings.length && "has-warning")} tabIndex={0}><div className="crossing-icon">{crossings.length ? <AlertTriangle /> : <Check />}</div><div><strong>{crossings.length ? `${crossings.length} crossing${crossings.length === 1 ? "" : "s"}` : "No crossings"}</strong><p>{crossings.length ? "between buildable routes" : "The route network is geometrically clean"}</p></div></div>
        </TooltipTrigger><TooltipContent side="right" className="balance-tooltip">
          <p><strong>Crossings</strong> are places where two buildable routes pass over each other without meeting at a stop.</p>
          <p>Aim for zero. On a printed board a crossing is ambiguous: players can&apos;t tell which line a marked wagon space belongs to, and it usually means the geometry needs a stop at the junction or a route routed around.</p>
          <p>Drag a stop, or add a bend point to a selected route, to pull the lines apart. Pre-built infrastructure routes are ignored here, since those are drawn as continuous lines that nobody claims.</p>
        </TooltipContent></Tooltip>
        {data.stops.length > 0 && <Tooltip><TooltipTrigger asChild>
          <div className={cn("crossing-card", lowConnectionStops.length && "has-warning")} tabIndex={0}><div className="crossing-icon">{lowConnectionStops.length ? <AlertTriangle /> : <Check />}</div><div><strong>{lowConnectionStops.length ? `${lowConnectionStops.length} low-connection stop${lowConnectionStops.length === 1 ? "" : "s"}` : "Well connected"}</strong><p>avg hub degree {avgHubDegree.toFixed(1)}{lowConnectionStops.length ? " · some stops are dead ends" : ""}</p></div></div>
        </TooltipTrigger><TooltipContent side="right" className="balance-tooltip">
          <p><strong>Hub degree</strong> is a stop&apos;s direct neighbours plus the routes touching it, so a stop on two routes scores 4. Two parallel routes to the same neighbour count twice.</p>
          <p>Aim to give every stop at least two neighbours — a stop on a single route is a dead end that one player can block off. Across a whole map, an average of roughly 4–6 gives players choices without turning the board into a mesh.</p>
          <p>Drawing and deleting routes moves it; placing stops you never connect drags the average down.</p>
        </TooltipContent></Tooltip>}
        {data.stops.length > 0 && <Button variant="outline" size="sm" className="analyze-button" onClick={() => setShowAnalysis(true)}><BarChart3 />Analyze balance</Button>}
        {data.stops.length > 1 && <Button variant="outline" size="sm" className="analyze-button" onClick={() => setShowSuggestions(true)}><Lightbulb />Suggest routes</Button>}
        <div className="legend"><p className="eyebrow">Stop types</p>{Object.entries(stopTypeMeta).map(([key, meta]) => <div key={key}><i style={{ background: meta.fill, borderColor: meta.stroke }} />{meta.label}</div>)}</div>
        <Button variant="ghost" className="reset-button" onClick={() => setDanger("reset")}><RotateCcw />Clear map</Button>
      </aside>
      <section className="map-wrap">
        <div className="map-status"><Badge variant="secondary">{format.shortLabel}</Badge><Badge variant="secondary">{format.widthMm.toLocaleString("en-GB")} × {format.heightMm.toLocaleString("en-GB")} mm</Badge><Badge variant="secondary">{data.stops.length} stops</Badge><Badge variant="secondary">{data.routes.length} routes</Badge><Badge variant="secondary">{data.background.length} background objects</Badge>{data.notes.length > 0 && <Badge variant="secondary">{data.notes.length} note{data.notes.length === 1 ? "" : "s"}</Badge>}<span>Everything is stored in the exported map file</span></div>
        {selectedR && routeHintAtTop && <RouteHint atTop locomotives={selectedRouteHasSlots} open={routeHintOpen} onToggle={toggleRouteHint} offsetX={routeHintX} onOffsetChange={moveRouteHint} />}
        <svg className={cn("map-canvas", `tool-${tool}`)} style={{ aspectRatio: `${W} / ${format.height}` }} viewBox={`0 0 ${W} ${format.height}`} onPointerDown={onCanvasDown} onPointerMove={onCanvasMove} onPointerUp={stopDragging} onPointerLeave={stopDragging}>
          <MapArtwork data={data} tool={tool} trueScale={trueScale} scaleWidthMm={scaleWidthMm} selectedRoute={selectedRoute} selectedStop={selectedStop} selectedBackground={selectedBackground} imageSelected={imageSelected} selectedNote={selectedNote} routeStart={routeStart} draft={{ type: backgroundType, points: draftPoints, fill: backgroundFill, stroke: backgroundStroke }} onRoute={(id) => { setSelectedRoute(id); setSelectedStop(null); setSelectedBackground(null); setSelectedNote(null); setTool("select"); }} onRouteSlot={toggleLocomotiveSlot} onRouteBendInsert={insertRouteBend} onRouteBendRemove={removeRouteBend} onStop={(id) => { chooseStop(id); if (tool === "select") { beginDrag(); dragStopRef.current = id; } }} onWaypoint={(routeId, index) => { beginDrag(); dragWaypointRef.current = { routeId, index }; }} onBackground={(id) => { setSelectedBackground(id); setSelectedRoute(null); setSelectedStop(null); setSelectedNote(null); setTool("select"); }} onBackgroundPoint={(shapeId, index) => { beginDrag(); dragBackgroundPointRef.current = { shapeId, index }; }} onBackgroundLabel={(shapeId) => { beginDrag(); dragBackgroundLabelRef.current = shapeId; }} onImageSelect={chooseImage} onImageMove={(point) => { chooseImage(); const img = data.backgroundImage; if (img) { beginDrag(); dragImageRef.current = { mode: "move", offsetX: point.x - img.x, offsetY: point.y - img.y }; } }} onImageScale={() => { beginDrag(); dragImageRef.current = { mode: "scale" }; }} onImageRotate={() => { beginDrag(); dragImageRef.current = { mode: "rotate" }; }} onNoteSelect={chooseNote} onNoteMove={(id, point) => { chooseNote(id); const note = data.notes.find((item) => item.id === id); if (note) { beginDrag(); dragNoteRef.current = { id, mode: "move", offsetX: point.x - note.x, offsetY: point.y - note.y }; } }} onNoteResize={(id) => { beginDrag(); dragNoteRef.current = { id, mode: "resize" }; }} />
        </svg>
        {selectedR && !routeHintAtTop && <RouteHint atTop={false} locomotives={selectedRouteHasSlots} open={routeHintOpen} onToggle={toggleRouteHint} offsetX={routeHintX} onOffsetChange={moveRouteHint} />}
      </section>
      <aside className="properties panel">
        <div className="panel-heading"><span>Properties</span><small>{imageSelected ? "Background image selected" : selectedN ? "Note selected" : selectedB ? "Background object selected" : selectedR ? "Route selected" : selectedS ? "Stop selected" : "Select an object on the map"}</small></div>
        {!imageSelected && !selectedN && !selectedB && !selectedR && !selectedS && <div className="empty-state"><CircleDot /><p>Edit names, types, colours, geometry and route length here.</p></div>}
        {selectedN && <NoteProperties note={selectedN} change={change} onDelete={() => setDanger("delete")} />}
        {imageSelected && data.backgroundImage && <BackgroundImageProperties image={data.backgroundImage} formatHeight={format.height} change={change} onDelete={() => setDanger("delete")} />}
        {selectedB && <BackgroundProperties shape={selectedB} change={change} onDelete={() => setDanger("delete")} />}
        {selectedS && <StopProperties stop={selectedS} change={change} onDelete={() => setDanger("delete")} />}
        {selectedR && <RouteProperties route={selectedR} stops={data.stops} routes={data.routes} lineStyles={data.lineStyles} routeTypeStyles={data.routeTypeStyles} change={change} onDelete={() => setDanger("delete")} onCreateStyle={addLineStyleToRoute} onUpdateStyle={updateLineStyle} onDeleteStyle={deleteLineStyle} onSetStyle={assignRouteLineStyle} onCreateType={addRouteTypeToRoute} onUpdateType={updateRouteType} onDeleteType={deleteRouteType} onAddParallel={addParallelRoute} onStraighten={straightenRoute} onSetCurved={setRouteCurved} linkParallel={linkParallel} onLinkParallel={setLinkParallel} />}
      </aside>
    </div>
    <AlertDialog open={danger !== null} onOpenChange={(open) => { if (!open) { setDanger(null); setPendingImport(null); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{danger === "reset" ? "Clear the entire map?" : danger === "load-blank" ? "Replace the current map with a blank one?" : danger === "load-example" ? "Replace the current map with the example?" : danger === "import-background" ? "Replace the background?" : danger === "import-network" ? "Replace stops and routes?" : danger === "import-image" ? "Replace the background image?" : "Delete the selected object?"}</AlertDialogTitle><AlertDialogDescription>{danger === "reset" ? "All locally stored background objects, stops and routes will be removed. Export the map first if you want to keep it." : danger === "load-blank" ? "Your current background objects, stops and routes will be replaced with a blank map. Export the map first if you want to keep your work." : danger === "load-example" ? "Your current background objects, stops and routes will be replaced with the neutral example map. Export the map first if you want to keep your work." : danger === "import-background" ? "The imported background, including any background image, will replace the current one. Stops and routes are kept as they are." : danger === "import-network" ? "The imported stops and routes will replace the current network. Background objects are kept as they are." : danger === "import-image" ? "The new image will replace the current background image." : selectedStop ? "The stop and all connected routes will be deleted." : "The selected object will be deleted."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (danger === "reset") { change(() => cloneMap(emptyMap)); clearSelection(); setDanger(null); } else if (danger === "load-blank") applyGuideChoice(emptyMap); else if (danger === "load-example") applyGuideChoice(initialMap); else if (danger === "import-background" && pendingImport?.kind === "background") applyBackgroundImport(pendingImport.background, pendingImport.backgroundImage); else if (danger === "import-network" && pendingImport?.kind === "network") applyNetworkImport(pendingImport.stops, pendingImport.routes, pendingImport.lineStyles, pendingImport.routeTypeStyles); else if (danger === "import-image" && pendingImport?.kind === "image") applyImageImport(pendingImport.image); else deleteSelected(); }}>Continue</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <WelcomeGuide open={showGuide} onOpenChange={(open) => !open && dismissGuide()} onChooseBlank={() => chooseFromGuide("blank")} onChooseExample={() => chooseFromGuide("example")} />
    <AnalysisDialog open={showAnalysis} onOpenChange={setShowAnalysis} data={data} stats={stats} colourTable={colourTable} spacing={spacing} scaleWidthMm={scaleWidthMm} />
    <SuggestionsDialog open={showSuggestions} onOpenChange={setShowSuggestions} suggestions={suggestions} onAdd={addSuggestedRoute} />
    <PrintPages data={data} trueScale={trueScale} scaleWidthMm={scaleWidthMm} />
  </main></TooltipProvider>;
}

function WelcomeGuide({ open, onOpenChange, onChooseBlank, onChooseExample }: { open: boolean; onOpenChange: (open: boolean) => void; onChooseBlank: () => void; onChooseExample: () => void }) {
  const steps: Array<{ icon: React.ReactNode; title: string; text: string }> = [
    { icon: <FileStack />, title: "Choose a board format", text: "Pick a standard, large or extended board, or an A4/A3 test sheet sized for your printer." },
    { icon: <Layers3 />, title: "Draw a background", text: "Sketch areas, boundaries and labels behind the network to show land, water and regions." },
    { icon: <MapPinPlus />, title: "Add stops and connect routes", text: "Place stations and draw the routes that link them, with a length, type and colour." },
    { icon: <Save />, title: "Save locally, export a backup", text: "The map saves automatically in this browser. Export a JSON backup regularly, since browser storage is not portable." },
    { icon: <Printer />, title: "Print it out and play on paper", text: "This editor does not play the game for you. Print the finished map, gather around it, and use coloured pens to mark the routes each player builds instead of placing plastic trains." },
  ];
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="welcome-guide">
      <DialogHeader><DialogTitle>Welcome to the map editor</DialogTitle><DialogDescription>This tool is for testing and developing new maps and expansions for Ticket to Ride. Design a custom map, then print it and play with pens instead of plastic trains.</DialogDescription></DialogHeader>
      <ol className="guide-steps">{steps.map((step) => <li key={step.title}><span className="guide-step-icon">{step.icon}</span><div><strong>{step.title}</strong><p>{step.text}</p></div></li>)}</ol>
      <DialogFooter>
        <Button variant="outline" onClick={onChooseExample}><Pencil />Load the example map</Button>
        <Button onClick={onChooseBlank}>Start with a blank map</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function AnalysisDialog({ open, onOpenChange, data, stats, colourTable, spacing, scaleWidthMm }: { open: boolean; onOpenChange: (open: boolean) => void; data: MapData; stats: NetworkStats; colourTable: ColourLengthTable; spacing: RouteSpacing[]; scaleWidthMm: number }) {
  const stopName = (id: string) => data.stops.find((stop) => stop.id === id)?.name ?? "";
  const sortedStops = [...data.stops].sort((a, b) => (stats.hubDegree.get(b.id) ?? 0) - (stats.hubDegree.get(a.id) ?? 0));
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="analysis-dialog">
      <DialogHeader><DialogTitle>Map balance</DialogTitle><DialogDescription>A quick read on how evenly connected and coloured the network is.</DialogDescription></DialogHeader>
      <div className="analysis-section">
        <h3>Hub degree per stop</h3>
        <p className="helper">Neighbours + weighted links (parallel routes between the same pair count extra). Higher means more central; sorted from most to least connected.</p>
        {sortedStops.length === 0 ? <p className="helper">No stops yet.</p> : <div className="analysis-table-scroll"><table className="analysis-table">
          <thead><tr><th>Stop</th><th>Neighbours</th><th>Links</th><th>Hub degree</th></tr></thead>
          <tbody>{sortedStops.map((stop) => <tr key={stop.id} className={cn((stats.neighbours.get(stop.id) ?? 0) < 2 && "analysis-warning-row")}><td>{stop.name}</td><td>{stats.neighbours.get(stop.id) ?? 0}</td><td>{stats.links.get(stop.id) ?? 0}</td><td>{stats.hubDegree.get(stop.id) ?? 0}</td></tr>)}</tbody>
        </table></div>}
      </div>
      <div className="analysis-section">
        <h3>Room per wagon</h3>
        <p className="helper">How long each route is drawn against the {realWagon.length + realWagon.gap} mm a real wagon space needs on a {scaleWidthMm.toLocaleString("en-GB")} mm board. Under 100% the wagons do not fit; well over means the line looks roomier on screen than the finished board plays.</p>
        {spacing.length === 0 ? <p className="helper">No card routes yet.</p> : <div className="analysis-table-scroll"><table className="analysis-table">
          <thead><tr><th>Route</th><th>Wagons</th><th>Drawn</th><th>Needs</th><th>Room</th></tr></thead>
          <tbody>{[...spacing].sort((a, b) => a.ratio - b.ratio).map((item) => <tr key={item.route.id} className={cn(item.verdict !== "ok" && "analysis-warning-row")}>
            <td>{stopName(item.route.a)} → {stopName(item.route.b)}</td>
            <td>{item.route.length}</td>
            <td>{Math.round(item.drawnMm)} mm</td>
            <td>{Math.round(item.neededMm)} mm</td>
            <td>{Math.round(item.ratio * 100)}%{item.verdict === "short" ? " · too short" : item.verdict === "long" ? " · roomy" : ""}</td>
          </tr>)}</tbody>
        </table></div>}
      </div>
      <div className="analysis-section">
        <h3>Colour × length distribution</h3>
        <p className="helper">Counts card-route colours by length. Pre-built infrastructure routes (no train cards) are excluded.</p>
        {colourTable.grandTotal === 0 ? <p className="helper">No card routes yet.</p> : <div className="analysis-table-scroll"><table className="analysis-table">
          <thead><tr><th>Length</th>{colourTable.colours.map((colour) => <th key={colour}>{colorLabels[colour]}</th>)}<th>Total</th></tr></thead>
          <tbody>
            {colourTable.lengths.map((length) => <tr key={length}><td>{length}</td>{colourTable.colours.map((colour) => <td key={colour}>{colourTable.counts.get(length)?.get(colour) ?? 0}</td>)}<td>{colourTable.lengthTotals.get(length) ?? 0}</td></tr>)}
            <tr className="analysis-total-row"><td>Total</td>{colourTable.colours.map((colour) => <td key={colour}>{colourTable.colourTotals.get(colour) ?? 0}</td>)}<td>{colourTable.grandTotal}</td></tr>
          </tbody>
        </table></div>}
      </div>
    </DialogContent>
  </Dialog>;
}

function SuggestionsDialog({ open, onOpenChange, suggestions, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; suggestions: RouteSuggestion[]; onAdd: (suggestion: RouteSuggestion) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="analysis-dialog">
      <DialogHeader><DialogTitle>Suggested routes</DialogTitle><DialogDescription>Geometrically nearby stop pairs with no route yet, that don't cross existing routes, prioritised for the least-connected stops. Length and colour are starting guesses — adjust them afterwards like any other route.</DialogDescription></DialogHeader>
      {suggestions.length === 0 ? <p className="helper">No good candidates right now — every nearby stop pair is already connected, would cross an existing route, or there aren't enough stops yet.</p> : <ul className="suggestion-list">
        {suggestions.map((suggestion) => <li key={`${suggestion.a}-${suggestion.b}`} className="suggestion-row">
          <div><strong>{suggestion.aName} ↔ {suggestion.bName}</strong><p className="helper">Suggested length {suggestion.suggestedLength} · {colorLabels[suggestion.suggestedColor]}</p></div>
          <Button size="sm" onClick={() => onAdd(suggestion)}><Plus />Add</Button>
        </li>)}
      </ul>}
    </DialogContent>
  </Dialog>;
}

function PrintPages({ data, trueScale, scaleWidthMm }: { data: MapData; trueScale: boolean; scaleWidthMm: number }) {
  const format = mapFormats[data.format];
  const panels = Array.from({ length: format.columns * format.rows }, (_, index) => ({ column: index % format.columns, row: Math.floor(index / format.columns) }));
  return <div className={cn("print-pages", `format-${data.format}`)} aria-hidden="true">{panels.map(({ column, row }, index) => {
    const panelWidth = W / format.columns;
    const panelHeight = format.height / format.rows;
    const printedPanelScale = Math.round(190 / (format.widthMm / format.columns) * 100);
    const panelName = format.columns === 1 ? `${format.shortLabel} · ${format.widthMm} × ${format.heightMm} mm${format.imperial ? ` (${format.imperial})` : ""}` : `Panel ${index + 1} of ${panels.length} · row ${row + 1}, column ${column + 1} · A4 proof at about ${printedPanelScale}%`;
    return <section className="print-page" key={`${column}-${row}`}><div className="print-caption"><strong>{data.name}</strong><span>{panelName}</span></div><svg viewBox={`${column * panelWidth} ${row * panelHeight} ${panelWidth} ${panelHeight}`}><MapArtwork data={data} trueScale={trueScale} scaleWidthMm={scaleWidthMm} print /></svg></section>;
  })}</div>;
}

const dashPresets: Array<{ value: string; label: string }> = [
  { value: "", label: "Solid" },
  { value: "4 4", label: "Fine dashes" },
  { value: "10 6", label: "Dashes" },
  { value: "2 5", label: "Dotted" },
  { value: "14 4 2 4", label: "Dash-dot" },
];
// An imported map may carry a dash pattern we have no preset for; keep it selectable rather than
// silently showing "Solid" and overwriting it the moment the user touches the field.
const dashOptions = (current: string) => dashPresets.some((preset) => preset.value === current)
  ? dashPresets
  : [...dashPresets, { value: current, label: `Custom (${current})` }];

function StopProperties({ stop, change, onDelete }: { stop: Stop; change: (fn: (draft: MapData) => MapData) => void; onDelete: () => void }) {
  const update = (values: Partial<Stop>) => change((draft) => { const item = stopById(draft, stop.id); if (item) Object.assign(item, values); return draft; });
  const symbol = stop.symbol ?? "none";
  return <div className="property-form">
    <div><Label htmlFor="stop-name">Name</Label><Input id="stop-name" value={stop.name} onChange={(event) => update({ name: event.target.value })} /></div>
    <div className="grid-two">
      <div><Label>Stop type</Label><NativeSelect value={stop.type} onChange={(event) => update({ type: event.target.value as StopType })}>{Object.entries(stopTypeMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div>
      <div><Label>Stop size</Label><NativeSelect value={stop.size ?? "medium"} onChange={(event) => update({ size: event.target.value as StopSize })}>{Object.entries(stopSizeMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div>
    </div>
    <p className="helper">Size can carry meaning in some expansions, such as marking major cities.</p>
    <div className="grid-two">
      <div><Label>Symbol</Label><NativeSelect value={symbol} onChange={(event) => update({ symbol: event.target.value as StopSymbol, letter: event.target.value === "letter" ? (stop.letter || "A") : stop.letter })}>{Object.entries(stopSymbolMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div>
      {symbol === "letter" && <div><Label>Letter</Label><Input maxLength={2} value={stop.letter ?? ""} onChange={(event) => update({ letter: event.target.value })} /></div>}
    </div>
    <p className="helper">Mark a stop with a symbol or short code for rules of your own, independent of its type.</p>
    <Button variant="destructive" onClick={onDelete}><Trash2 />Delete stop</Button>
    <p className="delete-note">Connected routes will also be deleted.</p>
  </div>;
}

function RouteTypeEditor({ typeId, routeTypeStyles, routes, onSelectType, onCreateType, onUpdateType, onDeleteType }: { typeId: string; routeTypeStyles: RouteTypeStyle[]; routes: Route[]; onSelectType: (typeId: string) => void; onCreateType: () => void; onUpdateType: (typeId: string, values: Partial<RouteTypeStyle>) => void; onDeleteType: (typeId: string) => void }) {
  const style = routeTypeStyles.find((item) => item.id === typeId);
  // A type's own colour only shows on pre-built infrastructure. Everything a player claims with
  // train cards takes its colour from the route, so types are told apart by thickness and dash.
  const colourApplies = routeTypeStyles.find((item) => item.id === typeId)?.infrastructure ?? false;
  const usageCount = style ? routes.filter((route) => route.type === style.id).length : 0;
  return <div className="line-style-section">
    <Label>Route type</Label>
    <div className="line-style-row">
      <NativeSelect value={typeId} onChange={(event) => onSelectType(event.target.value)}>
        {routeTypeStyles.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.label}</NativeSelectOption>)}
      </NativeSelect>
      <Button size="sm" variant="outline" onClick={onCreateType}>New type</Button>
    </div>
    {style && <div className="line-style-editor">
      <div><Label>Type name</Label><Input value={style.label} onChange={(event) => onUpdateType(style.id, { label: event.target.value })} /></div>
      {colourApplies ? <div><Label>Line colour</Label><input className="colour-input" type="color" value={style.stroke} onChange={(event) => onUpdateType(style.id, { stroke: event.target.value })} /></div> : <p className="helper">Every route keeps its own wagon colour, so a type is told apart by thickness and dash pattern — not by colour.</p>}
      <div><Label>Thickness · {style.strokeWidth}px</Label><input className="range-input" type="range" min="2" max="14" value={style.strokeWidth} onChange={(event) => onUpdateType(style.id, { strokeWidth: Number(event.target.value) })} /></div>
      <div><Label>Dash pattern</Label><NativeSelect value={style.dash} onChange={(event) => onUpdateType(style.id, { dash: event.target.value })}>{dashOptions(style.dash).map((preset) => <NativeSelectOption key={preset.value} value={preset.value}>{preset.label}</NativeSelectOption>)}</NativeSelect></div>
      <label className="checkbox-row"><input type="checkbox" checked={style.infrastructure} onChange={(event) => onUpdateType(style.id, { infrastructure: event.target.checked })} />Pre-built infrastructure (no train cards or wagon slots)</label>
      <Button size="sm" variant="ghost" disabled={usageCount > 0 || routeTypeStyles.length <= 1} onClick={() => onDeleteType(style.id)}>{usageCount > 0 ? `In use by ${usageCount} route${usageCount === 1 ? "" : "s"}` : "Delete this type"}</Button>
    </div>}
  </div>;
}

function LineStylePicker({ value, lineStyles, onChange, onCreate, onUpdate, onDelete, helper }: { value: string | undefined; lineStyles: LineStyle[]; onChange: (styleId: string | undefined) => void; onCreate: () => void; onUpdate: (styleId: string, values: Partial<LineStyle>) => void; onDelete: (styleId: string) => void; helper: string }) {
  const activeStyle = lineStyles.find((style) => style.id === value);
  return <div className="line-style-section">
    <Label>Special rule style</Label>
    <div className="line-style-row">
      <NativeSelect value={value ?? ""} onChange={(event) => onChange(event.target.value || undefined)}>
        <NativeSelectOption value="">Default appearance</NativeSelectOption>
        {lineStyles.map((style) => <NativeSelectOption key={style.id} value={style.id}>{style.label}</NativeSelectOption>)}
      </NativeSelect>
      <Button size="sm" variant="outline" onClick={onCreate}>New style</Button>
    </div>
    <p className="helper">{helper}</p>
    {activeStyle && <div className="line-style-editor">
      <div><Label>Style name</Label><Input value={activeStyle.label} onChange={(event) => onUpdate(activeStyle.id, { label: event.target.value })} /></div>
      <div><Label>Thickness · {activeStyle.strokeWidth}px</Label><input className="range-input" type="range" min="2" max="14" value={activeStyle.strokeWidth} onChange={(event) => onUpdate(activeStyle.id, { strokeWidth: Number(event.target.value) })} /></div>
      <div><Label>Dash pattern</Label><NativeSelect value={activeStyle.dash} onChange={(event) => onUpdate(activeStyle.id, { dash: event.target.value })}>{dashPresets.map((preset) => <NativeSelectOption key={preset.label} value={preset.value}>{preset.label}</NativeSelectOption>)}</NativeSelect></div>
      <Button size="sm" variant="ghost" onClick={() => onDelete(activeStyle.id)}>Delete this style</Button>
    </div>}
  </div>;
}

function RouteProperties({ route, stops, routes, lineStyles, routeTypeStyles, change, onDelete, onCreateStyle, onUpdateStyle, onDeleteStyle, onSetStyle, onCreateType, onUpdateType, onDeleteType, onAddParallel, onStraighten, onSetCurved, linkParallel, onLinkParallel }: { route: Route; onStraighten: (routeId: string) => void; onSetCurved: (routeId: string, curved: boolean) => void; linkParallel: boolean; onLinkParallel: (value: boolean) => void; stops: Stop[]; routes: Route[]; lineStyles: LineStyle[]; routeTypeStyles: RouteTypeStyle[]; change: (fn: (draft: MapData) => MapData) => void; onDelete: () => void; onAddParallel: (routeId: string) => void; onCreateStyle: (routeId: string) => void; onUpdateStyle: (styleId: string, values: Partial<LineStyle>) => void; onDeleteStyle: (styleId: string) => void; onSetStyle: (routeId: string, styleId: string | undefined) => void; onCreateType: (routeId: string) => void; onUpdateType: (typeId: string, values: Partial<RouteTypeStyle>) => void; onDeleteType: (typeId: string) => void }) {
  const update = (values: Partial<Route>) => change((draft) => { const item = draft.routes.find((entry) => entry.id === route.id); if (item) Object.assign(item, values); return draft; });
  const infrastructure = routeTypeStyles.find((style) => style.id === route.type)?.infrastructure ?? false;
  const parallelCount = routes.filter((item) => samePair(item, route)).length;
  const stopName = (id: string) => stops.find((stop) => stop.id === id)?.name ?? "";
  return <div className="property-form">
    <div className="route-names"><span>{stopName(route.a)}</span><ChevronDown /><span>{stopName(route.b)}</span></div>
    <div className="parallel-controls">
      <Label>Parallel lines · {parallelCount} between these stops</Label>
      <Button size="sm" variant="outline" onClick={() => onAddParallel(route.id)}><Copy />Add parallel route</Button>
      <p className="helper">A double route: a second line between the same two stops, in its own colour. Both lines are drawn side by side.</p>
    </div>
    <RouteTypeEditor typeId={route.type} routeTypeStyles={routeTypeStyles} routes={routes} onSelectType={(typeId) => update({ type: typeId })} onCreateType={() => onCreateType(route.id)} onUpdateType={onUpdateType} onDeleteType={onDeleteType} />
    {!infrastructure && <>
      <div><Label>Colour</Label><NativeSelect value={route.color} onChange={(event) => update({ color: event.target.value })}>{Object.keys(routeColors).map((key) => <NativeSelectOption key={key} value={key}>{colorLabels[key]}</NativeSelectOption>)}</NativeSelect></div>
      <div><Label>Vehicle spaces</Label><div className="length-stepper"><Button variant="outline" size="icon" aria-label="Decrease" disabled={route.length <= 1} onClick={() => update({ length: Math.max(1, route.length - 1), locomotiveSlots: route.locomotiveSlots?.filter((index) => index < route.length - 1) })}><Minus /></Button><strong>{route.length}</strong><Button variant="outline" size="icon" aria-label="Increase" disabled={route.length >= 8} onClick={() => update({ length: Math.min(8, route.length + 1) })}><Plus /></Button></div><p className="helper">The change is shown directly on the route.</p></div>
      <div><Label>Locomotives required · {route.locomotiveSlots?.length ?? 0} of {route.length}</Label><p className="helper">Click a wagon slot directly on the selected route to toggle it.</p>{Boolean(route.locomotiveSlots?.length) && <Button size="sm" variant="ghost" onClick={() => update({ locomotiveSlots: [] })}><TrainFront />Clear locomotives</Button>}</div>
    </>}
    <div className="bend-controls">
      <Label>Shape · {route.points?.length ?? 0} bend point{(route.points?.length ?? 0) === 1 ? "" : "s"}</Label>
      <p className="helper">Click a + beside the selected route to add a bend between any two wagon spaces, drag a bend to move it, double-click it to remove it.</p>
      <label className="checkbox-row"><input type="checkbox" checked={Boolean(route.curved)} onChange={(event) => onSetCurved(route.id, event.target.checked)} />Draw as a smooth curve</label>
      {parallelCount > 1 && <label className="checkbox-row"><input type="checkbox" checked={linkParallel} onChange={(event) => onLinkParallel(event.target.checked)} />Shape the parallel line{parallelCount > 2 ? "s" : ""} together with this one</label>}
      {Boolean(route.points?.length) && <Button size="sm" variant="ghost" onClick={() => onStraighten(route.id)}>Straighten route</Button>}
    </div>
    <LineStylePicker value={route.lineStyle} lineStyles={lineStyles} onChange={(styleId) => onSetStyle(route.id, styleId)} onCreate={() => onCreateStyle(route.id)} onUpdate={onUpdateStyle} onDelete={onDeleteStyle} helper="Give this one route a thicker or dashed line to flag it individually, on top of its type's appearance." />
    <Button variant="destructive" onClick={onDelete}><Trash2 />Delete route</Button>
  </div>;
}

function NoteProperties({ note, change, onDelete }: { note: NoteBox; change: (fn: (draft: MapData) => MapData) => void; onDelete: () => void }) {
  const update = (values: Partial<NoteBox>) => change((draft) => { const item = draft.notes.find((entry) => entry.id === note.id); if (item) Object.assign(item, values); return draft; });
  return <div className="property-form">
    <div><Label htmlFor="note-text">Evaluation note</Label><Textarea id="note-text" rows={5} value={note.text} onChange={(event) => update({ text: event.target.value })} /></div>
    <p className="helper">Shown on screen and in print, for reviewers evaluating the map. Drag the corner handle on the map to resize it.</p>
    <Button variant="outline" onClick={() => update({ locked: !note.locked })}>{note.locked ? <Unlock /> : <Lock />}{note.locked ? "Unlock note" : "Lock note"}</Button>
    <Button variant="destructive" onClick={onDelete}><Trash2 />Delete note</Button>
  </div>;
}

function BackgroundProperties({ shape, change, onDelete }: { shape: BackgroundShape; change: (fn: (draft: MapData) => MapData) => void; onDelete: () => void }) {
  const update = (values: Partial<BackgroundShape>) => change((draft) => { const item = draft.background.find((entry) => entry.id === shape.id); if (item) Object.assign(item, values); return draft; });
  return <div className="property-form"><div><Label htmlFor="background-label">Label</Label><Input id="background-label" value={shape.label} onChange={(event) => update({ label: event.target.value })} /></div>{shape.type === "area" && <div><Label>Fill colour</Label><input className="colour-input" type="color" value={shape.fill} onChange={(event) => update({ fill: event.target.value })} /></div>}<div><Label>{shape.type === "label" ? "Text colour" : "Line colour"}</Label><input className="colour-input" type="color" value={shape.stroke} onChange={(event) => update({ stroke: event.target.value })} /></div><div><Label>Opacity · {Math.round(shape.opacity * 100)}%</Label><input className="range-input" type="range" min="0.1" max="1" step="0.05" value={shape.opacity} onChange={(event) => update({ opacity: Number(event.target.value) })} /></div>{shape.type !== "label" && <><div><Label>Line width</Label><Input type="number" min="1" max="16" value={shape.strokeWidth} onChange={(event) => update({ strokeWidth: Math.max(1, Math.min(16, Number(event.target.value))) })} /></div><Button variant="outline" onClick={() => update({ labelPoint: undefined })}>Reset label position</Button><p className="helper label-helper">Drag the green handle to position the label freely.</p></>}<Button variant="outline" onClick={() => update({ locked: !shape.locked })}>{shape.locked ? <Unlock /> : <Lock />}{shape.locked ? "Unlock geometry" : "Lock geometry"}</Button><Button variant="destructive" onClick={onDelete}><Trash2 />Delete background object</Button></div>;
}

function MapArtwork({ data, tool = "select", trueScale = false, scaleWidthMm = 790, selectedRoute, selectedStop, selectedBackground, imageSelected, selectedNote, routeStart, draft, onRoute, onRouteSlot, onRouteBendInsert, onRouteBendRemove, onStop, onWaypoint, onBackground, onBackgroundPoint, onBackgroundLabel, onImageSelect, onImageMove, onImageScale, onImageRotate, onNoteSelect, onNoteMove, onNoteResize, print = false }: { data: MapData; tool?: Tool; trueScale?: boolean; scaleWidthMm?: number; selectedRoute?: string | null; selectedStop?: string | null; selectedBackground?: string | null; imageSelected?: boolean; selectedNote?: string | null; routeStart?: string | null; draft?: { type: BackgroundType; points: Point[]; fill: string; stroke: string }; onRoute?: (id: string) => void; onRouteSlot?: (routeId: string, index: number) => void; onRouteBendInsert?: (routeId: string, index: number, point: Point) => void; onRouteBendRemove?: (routeId: string, index: number) => void; onStop?: (id: string) => void; onWaypoint?: (routeId: string, index: number) => void; onBackground?: (id: string) => void; onBackgroundPoint?: (shapeId: string, index: number) => void; onBackgroundLabel?: (shapeId: string) => void; onImageSelect?: () => void; onImageMove?: (point: Point) => void; onImageScale?: () => void; onImageRotate?: () => void; onNoteSelect?: (id: string) => void; onNoteMove?: (id: string, point: Point) => void; onNoteResize?: (id: string) => void; print?: boolean }) {
  const format = mapFormats[data.format];
  return <>
    <defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0L0 0 0 24" fill="none" stroke="#6b675f" strokeOpacity=".11" /></pattern><filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity=".18" /></filter></defs>
    <rect className="map-bg" width={W} height={format.height} fill="#f7f1e5" /><rect className="map-bg" width={W} height={format.height} fill="url(#grid)" />
    {data.backgroundImage && <BackgroundImageObject image={data.backgroundImage} height={format.height} selected={Boolean(imageSelected)} print={print} tool={tool} onSelect={onImageSelect} onMove={onImageMove} onScale={onImageScale} onRotate={onImageRotate} />}
    {data.background.map((shape) => <BackgroundObject key={shape.id} shape={shape} height={format.height} selected={shape.id === selectedBackground} print={print} tool={tool} onSelect={onBackground} onPoint={onBackgroundPoint} onLabel={onBackgroundLabel} />)}
    {!print && draft && draft.points.length > 0 && <g className="background-draft">{draft.type === "area" ? <polygon points={draft.points.map((p) => `${p.x},${p.y}`).join(" ")} fill={draft.fill} fillOpacity=".35" stroke={draft.stroke} /> : <polyline points={draft.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={draft.stroke} />}{draft.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="6" />)}</g>}
    {data.routes.map((route) => { const typeStyle = data.routeTypeStyles.find((item) => item.id === route.type) ?? { id: route.type, label: route.type, stroke: "#736d64", dash: "", strokeWidth: 3, infrastructure: false }; const style = route.lineStyle ? data.lineStyles.find((item) => item.id === route.lineStyle) : undefined; const geometry = parallelPoints(data, route); const curved = Boolean(route.curved) && geometry.length > 2; const path = curved ? curvedPath(geometry) : pathFromPoints(geometry); const points = curved ? curvedSamples(geometry) : geometry; const infrastructure = typeStyle.infrastructure; const routeColor = infrastructure ? typeStyle.stroke : route.color === "neutral" ? "#736d64" : routeColors[route.color]; const routeSelected = route.id === selectedRoute; const unitMm = scaleWidthMm / W; const pitch = (realWagon.length + realWagon.gap) / unitMm; const slotW = trueScale ? realWagon.length / unitMm : 24; const slotH = trueScale ? realWagon.width / unitMm : 12; const pathLength = polylineLength(points) || 1; const span = route.length * pitch; const tight = trueScale && span > pathLength; return <g key={route.id} className={cn("route-group", routeSelected && "selected", style && "custom-style", tight && "too-tight")} onPointerDown={onRoute ? (event) => { event.stopPropagation(); onRoute(route.id); } : undefined}><path d={path} className="route-hit" /><path d={path} className={cn("route-guide", infrastructure && "infrastructure")} fill="none" stroke={routeColor} strokeWidth={style ? style.strokeWidth : typeStyle.strokeWidth} strokeDasharray={style ? style.dash : typeStyle.dash} strokeLinecap="round" strokeLinejoin="round" />{!infrastructure && Array.from({ length: route.length }, (_, index) => { const fraction = trueScale ? Math.min(1, Math.max(0, ((pathLength - span) / 2 + pitch * (index + .5)) / pathLength)) : (index + .5) / route.length; const position = pointAlong(points, fraction); const isLocomotive = route.locomotiveSlots?.includes(index); const interactive = !print && routeSelected; return <g key={index} className={cn("wagon-slot", isLocomotive && "locomotive")} transform={`translate(${position.x},${position.y}) rotate(${position.angle})`} filter={print ? undefined : "url(#shadow)"} onPointerDown={interactive ? (event) => { event.stopPropagation(); onRouteSlot?.(route.id, index); } : undefined}><rect className="wagon-slot-outline" x={-slotW / 2 - 1} y={-slotH / 2 - 1} width={slotW + 2} height={slotH + 2} rx="4" /><rect x={-slotW / 2} y={-slotH / 2} width={slotW} height={slotH} rx="3" fill="#fffaf0" stroke={routeColor} strokeWidth="3" />{isLocomotive && <g className="locomotive-icon" transform={`scale(${slotW / 24})`}><rect x={-8} y={-3.5} width="11" height="7" rx="1.5" /><rect x={2} y={-1.5} width="4.5" height="5" rx="1" /><rect x={-2.5} y={-6.5} width="2.5" height="3.5" /><circle cx={-4.5} cy={4} r="1.6" /><circle cx={1.5} cy={4} r="1.6" /></g>}</g>; })}</g>; })}
    {data.stops.map((stop) => { const meta = stopTypeMeta[stop.type]; const active = stop.id === selectedStop || stop.id === routeStart; const radius = stopSizeMeta[stop.size ?? "medium"].radius; return <g key={stop.id} className={cn("stop", active && "active")} transform={`translate(${stop.x},${stop.y})`} onPointerDown={onStop ? (event) => { event.stopPropagation(); onStop(stop.id); } : undefined}><circle r={active ? radius + 3 : radius} fill={meta.fill} stroke={meta.stroke} strokeWidth={active ? 4 : 3} />{stop.type === "rail" && <rect x={-4} y={-4} width="8" height="8" fill={meta.stroke} />}<StopSymbolGlyph stop={stop} radius={radius} color={meta.stroke} /><text x={stop.x > 900 ? -14 : 14} y={stop.y > format.height - 100 ? -13 : -12} textAnchor={stop.x > 900 ? "end" : "start"}>{stop.name}</text></g>; })}
    {data.notes.map((note) => <NoteBoxObject key={note.id} note={note} height={format.height} selected={note.id === selectedNote} print={print} tool={tool} onSelect={onNoteSelect} onMove={onNoteMove} onResize={onNoteResize} />)}
    {!print && selectedRoute && (() => {
      const route = data.routes.find((item) => item.id === selectedRoute);
      if (!route) return null;
      const base = pointsFor(data, route);
      return <>
        {base.slice(0, -1).map((from, index) => {
          const to = base[index + 1];
          const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
          const dx = to.x - from.x, dy = to.y - from.y;
          const length = Math.hypot(dx, dy) || 1;
          // Sit the + beside the line so it doesn't fight with the wagon slot underneath it.
          const handle = { x: mid.x - dy / length * 17, y: mid.y + dx / length * 17 };
          return <g key={`insert-${index}`} className="bend-insert-handle" transform={`translate(${handle.x},${handle.y})`} onPointerDown={(event) => { event.stopPropagation(); onRouteBendInsert?.(route.id, index, mid); }}><circle className="point-hit" r="15" /><circle r="8" /><path d="M-4,0 H4 M0,-4 V4" /></g>;
        })}
        {route.points?.map((point, index) => <g key={index} className="waypoint-handle" transform={`translate(${point.x},${point.y})`} onPointerDown={(event) => { event.stopPropagation(); onWaypoint?.(selectedRoute, index); }} onDoubleClick={(event) => { event.stopPropagation(); onRouteBendRemove?.(route.id, index); }}><circle className="waypoint-hit" r="19" /><rect x="-8" y="-8" width="16" height="16" rx="3" transform="rotate(45)" /><circle r="3" /></g>)}
      </>;
    })()}
    {format.columns > 1 && <g className="fold-guides">{Array.from({ length: format.columns - 1 }, (_, index) => <line key={`v-${index}`} x1={W * (index + 1) / format.columns} y1="0" x2={W * (index + 1) / format.columns} y2={format.height} />)}{Array.from({ length: format.rows - 1 }, (_, index) => <line key={`h-${index}`} x1="0" y1={format.height * (index + 1) / format.rows} x2={W} y2={format.height * (index + 1) / format.rows} />)}</g>}
  </>;
}

function BackgroundImageObject({ image, height, selected, print, tool, onSelect, onMove, onScale, onRotate }: { image: BackgroundImage; height: number; selected: boolean; print: boolean; tool: Tool; onSelect?: () => void; onMove?: (point: Point) => void; onScale?: () => void; onRotate?: () => void }) {
  const cx = image.x + image.width / 2;
  const cy = image.y + image.height / 2;
  const cropX = image.crop.left * image.naturalWidth;
  const cropY = image.crop.top * image.naturalHeight;
  const cropWidth = Math.max(1, image.naturalWidth * (1 - image.crop.left - image.crop.right));
  const cropHeight = Math.max(1, image.naturalHeight * (1 - image.crop.top - image.crop.bottom));
  return <g className={cn("background-image", selected && "selected", image.locked && "locked")} opacity={image.opacity} transform={`rotate(${image.rotation} ${cx} ${cy})`} onPointerDown={!print && tool === "select" ? (event) => { event.stopPropagation(); onSelect?.(); if (!image.locked) { const svg = event.currentTarget.ownerSVGElement; if (svg) onMove?.(canvasPoint(svg, event.clientX, event.clientY, height)); } } : undefined}>
    <svg x={image.x} y={image.y} width={image.width} height={image.height} viewBox={`${cropX} ${cropY} ${cropWidth} ${cropHeight}`} preserveAspectRatio="none"><image href={image.dataUrl} width={image.naturalWidth} height={image.naturalHeight} preserveAspectRatio="none" /></svg>
    {!print && selected && <rect className="image-bounds" x={image.x} y={image.y} width={image.width} height={image.height} fill="none" />}
    {!print && selected && !image.locked && <>
      <line className="image-rotate-guide" x1={cx} y1={image.y} x2={cx} y2={image.y - 30} />
      <g className="image-scale-handle" transform={`translate(${image.x + image.width},${image.y + image.height})`} onPointerDown={(event) => { event.stopPropagation(); onScale?.(); }}><circle className="point-hit" r="18" /><rect x="-7" y="-7" width="14" height="14" rx="2" /></g>
      <g className="image-rotate-handle" transform={`translate(${cx},${image.y - 30})`} onPointerDown={(event) => { event.stopPropagation(); onRotate?.(); }}><circle className="point-hit" r="18" /><circle r="7" /></g>
    </>}
  </g>;
}

function BackgroundImageProperties({ image, formatHeight, change, onDelete }: { image: BackgroundImage; formatHeight: number; change: (fn: (draft: MapData) => MapData) => void; onDelete: () => void }) {
  const update = (values: Partial<BackgroundImage>) => change((draft) => { if (draft.backgroundImage) Object.assign(draft.backgroundImage, values); return draft; });
  const updateCrop = (edge: keyof ImageCrop, percent: number) => change((draft) => { if (draft.backgroundImage) draft.backgroundImage.crop = { ...draft.backgroundImage.crop, [edge]: Math.max(0, Math.min(45, percent)) / 100 }; return draft; });
  const center = () => update({ x: (W - image.width) / 2, y: (formatHeight - image.height) / 2 });
  const fitToPage = () => {
    const scale = Math.min((W * 0.9) / image.naturalWidth, (formatHeight * 0.9) / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    update({ width, height, x: (W - width) / 2, y: (formatHeight - height) / 2 });
  };
  return <div className="property-form">
    <div className="image-fit-actions"><Button size="sm" variant="outline" onClick={center}><Crosshair />Center</Button><Button size="sm" variant="outline" onClick={fitToPage}><Maximize2 />Fit to page</Button></div>
    <p className="helper">Fit to page leaves a small margin on every side, since most printers cannot print all the way to the edge.</p>
    <div><Label>Opacity · {Math.round(image.opacity * 100)}%</Label><input className="range-input" type="range" min="0.1" max="1" step="0.05" value={image.opacity} onChange={(event) => update({ opacity: Number(event.target.value) })} /></div>
    <div><Label>Rotation · {Math.round(image.rotation)}°</Label><input className="range-input" type="range" min="-180" max="180" step="1" value={image.rotation} onChange={(event) => update({ rotation: Number(event.target.value) })} /></div>
    <div className="crop-controls">
      <Label>Crop</Label>
      <div className="grid-two">
        <div><Label>Top · {Math.round(image.crop.top * 100)}%</Label><input className="range-input" type="range" min="0" max="45" value={Math.round(image.crop.top * 100)} onChange={(event) => updateCrop("top", Number(event.target.value))} /></div>
        <div><Label>Right · {Math.round(image.crop.right * 100)}%</Label><input className="range-input" type="range" min="0" max="45" value={Math.round(image.crop.right * 100)} onChange={(event) => updateCrop("right", Number(event.target.value))} /></div>
        <div><Label>Bottom · {Math.round(image.crop.bottom * 100)}%</Label><input className="range-input" type="range" min="0" max="45" value={Math.round(image.crop.bottom * 100)} onChange={(event) => updateCrop("bottom", Number(event.target.value))} /></div>
        <div><Label>Left · {Math.round(image.crop.left * 100)}%</Label><input className="range-input" type="range" min="0" max="45" value={Math.round(image.crop.left * 100)} onChange={(event) => updateCrop("left", Number(event.target.value))} /></div>
      </div>
    </div>
    <Button variant="outline" onClick={() => update({ locked: !image.locked })}>{image.locked ? <Unlock /> : <Lock />}{image.locked ? "Unlock image" : "Lock image"}</Button>
    <Button variant="destructive" onClick={onDelete}><Trash2 />Remove image</Button>
  </div>;
}

function NoteBoxObject({ note, height, selected, print, tool, onSelect, onMove, onResize }: { note: NoteBox; height: number; selected: boolean; print: boolean; tool: Tool; onSelect?: (id: string) => void; onMove?: (id: string, point: Point) => void; onResize?: (id: string) => void }) {
  return <g className={cn("note-box", selected && "selected", note.locked && "locked")} transform={`translate(${note.x},${note.y})`} onPointerDown={!print && tool === "select" ? (event) => { event.stopPropagation(); onSelect?.(note.id); if (!note.locked) { const svg = event.currentTarget.ownerSVGElement; if (svg) onMove?.(note.id, canvasPoint(svg, event.clientX, event.clientY, height)); } } : undefined}>
    <rect className="note-box-bg" width={note.width} height={note.height} rx="8" />
    <foreignObject x="0" y="0" width={note.width} height={note.height}><div {...{ xmlns: "http://www.w3.org/1999/xhtml" }} className="note-box-text">{note.text}</div></foreignObject>
    {!print && selected && !note.locked && <g className="note-resize-handle" transform={`translate(${note.width},${note.height})`} onPointerDown={(event) => { event.stopPropagation(); onResize?.(note.id); }}><circle className="point-hit" r="18" /><rect x="-7" y="-7" width="14" height="14" rx="2" /></g>}
  </g>;
}

function BackgroundObject({ shape, height, selected, print, tool, onSelect, onPoint, onLabel }: { shape: BackgroundShape; height: number; selected: boolean; print: boolean; tool: Tool; onSelect?: (id: string) => void; onPoint?: (id: string, index: number) => void; onLabel?: (id: string) => void }) {
  const points = shape.points.map((point) => `${point.x},${point.y}`).join(" ");
  const anchor = shape.type === "label" ? shape.points[0] : (shape.labelPoint ?? automaticLabelPoint(shape, height));
  const labelAtRightEdge = Boolean(anchor && anchor.x > W - 140);
  const handleX = anchor ? Math.max(18, Math.min(W - 18, anchor.x)) : 0;
  const handleY = anchor ? Math.max(24, Math.min(height - 18, anchor.y)) : 0;
  const labelX = Math.max(18, Math.min(W - 18, handleX + (labelAtRightEdge ? -12 : 12)));
  const labelY = Math.max(24, Math.min(height - 18, handleY - 12));
  const labelAnchor = labelAtRightEdge ? "end" : "start";
  return <g className={cn("background-object", selected && "selected", shape.locked && "locked")} onPointerDown={onSelect && tool === "select" ? (event) => { event.stopPropagation(); onSelect(shape.id); } : undefined}>
    {shape.type === "area" && <polygon points={points} fill={shape.fill} fillOpacity={shape.opacity} stroke={shape.stroke} strokeOpacity={shape.opacity} strokeWidth={shape.strokeWidth} />}
    {shape.type === "line" && <polyline points={points} fill="none" stroke={shape.stroke} strokeOpacity={shape.opacity} strokeWidth={shape.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />}
    {shape.type === "label" && anchor && <text x={labelX} y={labelY} textAnchor={labelAnchor} fill={shape.stroke} fillOpacity={shape.opacity}>{shape.label}</text>}
    {shape.type !== "label" && shape.label && anchor && <text x={labelX} y={labelY} textAnchor={labelAnchor} fill={shape.stroke} fillOpacity={Math.min(1, shape.opacity + .25)}>{shape.label}</text>}
    {!print && selected && !shape.locked && shape.points.map((point, index) => <g key={index} className="background-point" transform={`translate(${point.x},${point.y})`} onPointerDown={(event) => { event.stopPropagation(); onPoint?.(shape.id, index); }}><circle className="point-hit" r="18" /><circle r="7" /></g>)}
    {!print && selected && !shape.locked && shape.type !== "label" && anchor && <g className="background-label-handle" transform={`translate(${handleX},${handleY})`} onPointerDown={(event) => { event.stopPropagation(); onLabel?.(shape.id); }}><circle className="point-hit" r="20" /><rect x="-7" y="-7" width="14" height="14" rx="2" transform="rotate(45)" /></g>}
  </g>;
}

function StopSymbolGlyph({ stop, radius, color }: { stop: Stop; radius: number; color: string }) {
  const symbol = stop.symbol ?? "none";
  if (symbol === "dot") return <circle className="stop-symbol" r={radius * .38} fill={color} />;
  if (symbol === "dash") return <rect className="stop-symbol" x={-radius * .62} y={-1.4} width={radius * 1.24} height="2.8" rx="1.4" fill={color} />;
  if (symbol === "cross") return <g className="stop-symbol" stroke={color} strokeWidth="2.2" strokeLinecap="round"><line x1={-radius * .55} y1={-radius * .55} x2={radius * .55} y2={radius * .55} /><line x1={-radius * .55} y1={radius * .55} x2={radius * .55} y2={-radius * .55} /></g>;
  if (symbol === "letter") return <text className="stop-symbol stop-letter" textAnchor="middle" dominantBaseline="central" fontSize={radius * 1.15} fill={color}>{(stop.letter || "A").slice(0, 2).toUpperCase()}</text>;
  return null;
}

const toolDefinitions: Array<{ id: Tool; icon: React.ReactNode; title: string; note: string }> = [
  { id: "select", icon: <MousePointer2 />, title: "Select & move", note: "Click anything on the map to select it, then edit it in the Properties panel or drag it somewhere else." },
  { id: "stop", icon: <MapPinPlus />, title: "Add stop", note: "Click the map to place a stop, using the type, size and symbol set below." },
  { id: "route", icon: <Link2 />, title: "Draw route", note: "Click two stops to connect them, using the route type, colour and special-rule style set below." },
  { id: "background", icon: <Layers3 />, title: "Draw background", note: "Draw areas, boundaries and labels behind the network, or import a background map image." },
  { id: "note", icon: <StickyNote />, title: "Add note", note: "Click the map to drop an evaluation note. Notes show on screen and in print, but aren't part of the map itself." },
  { id: "measure", icon: <Ruler />, title: "Measure distance", note: "Click two stops to see the shortest path between them, counted in wagon spaces rather than straight-line distance." },
];

// A zero-height sticky slot so the hint stays in view even when the board is taller than the
// window, without pushing the canvas around when a route is selected.
function RouteHint({ atTop, locomotives, open, onToggle, offsetX, onOffsetChange }: { atTop: boolean; locomotives: boolean; open: boolean; onToggle: () => void; offsetX: number; onOffsetChange: (value: number) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startOffset: number } | null>(null);
  // Only the grip is draggable; the rest of the box stays click-through so the map underneath
  // keeps working.
  const grip = {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startOffset: offsetX };
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const box = boxRef.current;
      const scrollport = box?.parentElement?.parentElement;
      const limit = box && scrollport ? Math.max(0, (scrollport.clientWidth - box.offsetWidth) / 2 - 6) : 0;
      onOffsetChange(Math.max(-limit, Math.min(limit, drag.startOffset + event.clientX - drag.startX)));
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    },
  };
  // The collapsed bar can be parked further out than the expanded box fits, so re-clamp whenever
  // the box changes size or the window does.
  useEffect(() => {
    const clamp = () => {
      const box = boxRef.current;
      const scrollport = box?.parentElement?.parentElement;
      if (!box || !scrollport) return;
      const limit = Math.max(0, (scrollport.clientWidth - box.offsetWidth) / 2 - 6);
      if (Math.abs(offsetX) > limit) onOffsetChange(Math.max(-limit, Math.min(limit, offsetX)));
    };
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [open, offsetX, onOffsetChange]);
  const shift = { transform: `translateX(${offsetX}px)` };
  return <div className={cn("route-hint-slot", atTop && "at-top", !open && "collapsed")}>
    {open
      ? <div className="route-hint" ref={boxRef} style={shift}>
        <span className="route-hint-grip" title="Drag to move the box sideways" {...grip}><GripVertical /></span>
        <button type="button" className="route-hint-toggle" onClick={onToggle} aria-label="Collapse the route help"><ChevronDown /></button>
        <strong>Editing this route</strong>
        <span>Click a <b>+</b> to add a bend point anywhere along it · drag a bend point to move it · <b>double-click a bend point to remove it</b> · tick <b>Draw as a smooth curve</b> under Properties to bend it into an arc{locomotives ? <> · <b>click a wagon space to mark it as needing a locomotive</b>, and click it again to clear it</> : null}</span>
      </div>
      : <div className="route-hint-bar" ref={boxRef} style={shift}>
        <span className="route-hint-grip" title="Drag to move the bar sideways" {...grip}><GripVertical /></span>
        <button type="button" onClick={onToggle}><ChevronUp />Editing this route · show the shortcuts</button>
      </div>}
  </div>;
}

function ToolButton({ active, icon, title, note, onClick }: { active: boolean; icon: React.ReactNode; title: string; note: string; onClick: () => void }) {
  return <Tooltip><TooltipTrigger asChild>
    <button type="button" className={cn("tool-button", active && "active")} onClick={onClick} aria-label={title} aria-pressed={active}>{icon}</button>
  </TooltipTrigger><TooltipContent side="bottom" sideOffset={6} className="tool-tooltip"><strong>{title}</strong><span>{note}</span></TooltipContent></Tooltip>;
}
