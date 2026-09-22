"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BusFront, Check, ChevronDown, CircleDot, CircleHelp, Download, FileStack, Image as ImageIcon, Layers3, Link2, Lock, MapPinPlus, Minus, MousePointer2, Pencil, Plus, Printer, Redo2, RotateCcw, Save, StickyNote, TrainFront, Trash2, Undo2, Unlock, Upload } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { colorLabels, defaultRouteTypeStyles, emptyMap, initialMap, type LineStyle, mapFormats, type BackgroundImage, type BackgroundShape, type BackgroundType, type ImageCrop, type MapData, type MapFormat, type NoteBox, type Point, type Route, type RouteType, type RouteTypeStyle, routeColors, STORAGE_KEY, type Stop, type StopSize, stopSizeMeta, type StopSymbol, stopSymbolMeta, type StopType, stopTypeMeta, W } from "./map-data";

type Tool = "select" | "stop" | "route" | "background" | "note";
type Danger = "reset" | "delete" | "load-blank" | "load-example" | "import-background" | "import-network" | "import-image" | null;
type PendingImport = { kind: "background"; background: BackgroundShape[]; backgroundImage?: BackgroundImage } | { kind: "network"; stops: Stop[]; routes: Route[]; lineStyles: LineStyle[]; routeTypeStyles: RouteTypeStyle[] } | { kind: "image"; image: BackgroundImage };
const GUIDE_SEEN_KEY = `${STORAGE_KEY}-guide-seen`;
const MAX_IMAGE_WARN_BYTES = 2 * 1024 * 1024;

const cloneMap = (data: MapData): MapData => JSON.parse(JSON.stringify(data));
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

function parallelPoints(data: MapData, route: Route): Point[] {
  const siblings = data.routes.filter((item) => (item.a === route.a && item.b === route.b) || (item.a === route.b && item.b === route.a));
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
  if (points.length === 2) {
    const [a, b] = points;
    const nearA = { x: a.x + (b.x - a.x) * .16, y: a.y + (b.y - a.y) * .16 };
    const nearB = { x: a.x + (b.x - a.x) * .84, y: a.y + (b.y - a.y) * .84 };
    return [a, shifted(nearA, a, b, offset), shifted(nearB, a, b, offset), b];
  }
  return points.map((point, i) => i === 0 || i === points.length - 1 ? point : shifted(point, points[i - 1], points[i + 1], offset));
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
  const dragImageRef = useRef<"move" | "scale" | "rotate" | null>(null);
  const dragNoteRef = useRef<{ id: string; mode: "move" | "resize" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const format = mapFormats[data.format];
  const panelWidthMm = Math.round(format.widthMm / format.columns);
  const panelHeightMm = Math.round(format.heightMm / format.rows);

  useEffect(() => { queueMicrotask(() => { try { const stored = localStorage.getItem(STORAGE_KEY); if (stored) { setData(normalizeMap(JSON.parse(stored))); localStorage.setItem(GUIDE_SEEN_KEY, "1"); } else if (!localStorage.getItem(GUIDE_SEEN_KEY)) setShowGuide(true); } catch { /* ignore invalid local state */ } setReady(true); }); }, []);
  useEffect(() => { if (!ready) return; localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); const timer = window.setTimeout(() => setSaved(true), 0); return () => window.clearTimeout(timer); }, [data, ready]);

  const crossings = useMemo(() => crossingPairs(data), [data]);
  const selectedS = data.stops.find((stop) => stop.id === selectedStop);
  const selectedR = data.routes.find((route) => route.id === selectedRoute);
  const selectedB = data.background.find((shape) => shape.id === selectedBackground);
  const selectedN = data.notes.find((note) => note.id === selectedNote);
  const change = (fn: (draft: MapData) => MapData) => setData((previous) => { setPast((history) => [...history, cloneMap(previous)].slice(-40)); setFuture([]); setSaved(false); return fn(cloneMap(previous)); });
  const clearSelection = () => { setSelectedStop(null); setSelectedRoute(null); setSelectedBackground(null); setImageSelected(false); setSelectedNote(null); };
  const chooseImage = () => { setImageSelected(true); setSelectedStop(null); setSelectedRoute(null); setSelectedBackground(null); setSelectedNote(null); setTool("select"); };
  const chooseNote = (id: string) => { setSelectedNote(id); setSelectedStop(null); setSelectedRoute(null); setSelectedBackground(null); setImageSelected(false); setTool("select"); };
  const undo = () => { const previous = past.at(-1); if (!previous) return; setFuture((items) => [cloneMap(data), ...items]); setData(previous); setPast((items) => items.slice(0, -1)); clearSelection(); };
  const redo = () => { const next = future[0]; if (!next) return; setPast((items) => [...items, cloneMap(data)]); setData(next); setFuture((items) => items.slice(1)); clearSelection(); };

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
    if (dragNoteRef.current) {
      const { id, mode } = dragNoteRef.current;
      setData((current) => ({
        ...current,
        notes: current.notes.map((note) => {
          if (note.id !== id) return note;
          if (mode === "move") return { ...note, x: point.x - note.width / 2, y: point.y - note.height / 2 };
          return { ...note, width: Math.max(90, point.x - note.x), height: Math.max(50, point.y - note.y) };
        }),
      }));
      setSaved(false); return;
    }
    if (dragImageRef.current) {
      const mode = dragImageRef.current;
      setData((current) => {
        const img = current.backgroundImage;
        if (!img) return current;
        if (mode === "move") return { ...current, backgroundImage: { ...img, x: point.x - img.width / 2, y: point.y - img.height / 2 } };
        if (mode === "scale") return { ...current, backgroundImage: { ...img, width: Math.max(20, point.x - img.x), height: Math.max(20, point.y - img.y) } };
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
      setData((current) => ({ ...current, routes: current.routes.map((route) => route.id === target.routeId ? { ...route, points: (route.points ?? []).map((item, index) => index === target.index ? point : item) } : route) }));
      setSaved(false); return;
    }
    if (!dragStopRef.current) return;
    setData((current) => ({ ...current, stops: current.stops.map((stop) => stop.id === dragStopRef.current ? { ...stop, ...point } : stop) }));
    setSaved(false);
  };
  const stopDragging = () => { dragStopRef.current = null; dragWaypointRef.current = null; dragBackgroundPointRef.current = null; dragBackgroundLabelRef.current = null; dragImageRef.current = null; dragNoteRef.current = null; };
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
  const assignRouteLineStyle = (routeId: string, styleId: string | undefined) => change((draft) => { const route = draft.routes.find((item) => item.id === routeId); if (route) route.lineStyle = styleId; return draft; });
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

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><BusFront /></span><div><p>Ticket to Ride</p><h1>Map editor</h1></div></div>
      <div className="map-title"><Label htmlFor="map-name" className="sr-only">Map name</Label><Input id="map-name" value={data.name} onChange={(event) => change((draft) => ({ ...draft, name: event.target.value }))} /><span className="save-state"><Check />{saved ? "Saved locally" : "Saving…"}</span></div>
      <div className="header-actions"><Button variant="outline" size="sm" onClick={() => setShowGuide(true)}><CircleHelp />Help</Button><Button variant="ghost" size="icon" aria-label="Undo" disabled={!past.length} onClick={undo}><Undo2 /></Button><Button variant="ghost" size="icon" aria-label="Redo" disabled={!future.length} onClick={redo}><Redo2 /></Button><Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload />Import</Button><input ref={fileRef} hidden type="file" accept="application/json" onChange={(event) => { importMap(event.target.files?.[0]); event.target.value = ""; }} /><Button variant="outline" size="sm" onClick={() => window.print()}><Printer />Print {format.shortLabel}</Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm"><Download />Export</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={exportMap}><Download />Full map</DropdownMenuItem><DropdownMenuItem onClick={exportBackground}><Layers3 />Background only</DropdownMenuItem><DropdownMenuItem onClick={exportNetwork}><Link2 />Network only</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
    </header>
    <div className="workspace">
      <aside className="tools-panel panel">
        <div className="panel-heading"><span>Tools</span><small>Work directly on the map</small></div>
        <div className="tool-list">
          <ToolButton active={tool === "select"} icon={<MousePointer2 />} title="Select & move" note="Edit stops, routes and shapes" onClick={() => { setTool("select"); setRouteStart(null); setDraftPoints([]); }} />
          <ToolButton active={tool === "stop"} icon={<MapPinPlus />} title="Add stop" note="Click the map to place it" onClick={() => { setTool("stop"); setRouteStart(null); setDraftPoints([]); }} />
          {tool === "stop" && <div className="tool-options"><div className="grid-two"><div><Label>Stop type</Label><NativeSelect value={stopType} onChange={(event) => setStopType(event.target.value as StopType)}>{Object.entries(stopTypeMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div><div><Label>Stop size</Label><NativeSelect value={stopSize} onChange={(event) => setStopSize(event.target.value as StopSize)}>{Object.entries(stopSizeMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div></div><div className="grid-two"><div><Label>Symbol</Label><NativeSelect value={stopSymbol} onChange={(event) => setStopSymbol(event.target.value as StopSymbol)}>{Object.entries(stopSymbolMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div>{stopSymbol === "letter" && <div><Label>Letter</Label><Input maxLength={2} value={stopLetter} onChange={(event) => setStopLetter(event.target.value)} /></div>}</div></div>}
          <ToolButton active={tool === "route"} icon={<Link2 />} title="Draw route" note={routeStart ? `Start: ${stopById(data, routeStart)?.name} · choose end` : "Click two stops"} onClick={() => { setTool("route"); setRouteStart(null); setDraftPoints([]); }} />
          {tool === "route" && <div className="tool-options"><RouteTypeEditor typeId={routeType} routeTypeStyles={data.routeTypeStyles} routes={data.routes} onSelectType={setRouteType} onCreateType={() => setRouteType(createRouteType())} onUpdateType={updateRouteType} onDeleteType={deleteRouteType} /><div><Label>Colour</Label><NativeSelect value={routeColor} onChange={(event) => setRouteColor(event.target.value)}>{Object.keys(routeColors).map((key) => <NativeSelectOption key={key} value={key}>{colorLabels[key]}</NativeSelectOption>)}</NativeSelect></div><LineStylePicker value={routeLineStyle} lineStyles={data.lineStyles} onChange={setRouteLineStyle} onCreate={() => setRouteLineStyle(createLineStyle())} onUpdate={updateLineStyle} onDelete={deleteLineStyle} helper="New routes you draw will use this style. Change it anytime for an existing route from its Properties panel." /></div>}
          <ToolButton active={tool === "background"} icon={<Layers3 />} title="Draw background" note="Areas, boundaries and labels" onClick={() => { setTool("background"); setRouteStart(null); clearSelection(); }} />
          {tool === "background" && <div className="tool-options background-tools"><div className="image-import-row"><Label>Background image</Label><div className="image-import-buttons"><Button size="sm" variant="outline" onClick={() => imageFileRef.current?.click()}><ImageIcon />{data.backgroundImage ? "Replace image" : "Import image"}</Button>{data.backgroundImage && <Button size="sm" variant="ghost" onClick={() => { chooseImage(); setDanger("delete"); }}><Trash2 />Remove</Button>}</div><input ref={imageFileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { importBackgroundImage(event.target.files?.[0]); event.target.value = ""; }} /></div><Label>Object</Label><NativeSelect value={backgroundType} onChange={(event) => { setBackgroundType(event.target.value as BackgroundType); setDraftPoints([]); }}><NativeSelectOption value="area">Area</NativeSelectOption><NativeSelectOption value="line">Line</NativeSelectOption><NativeSelectOption value="label">Label</NativeSelectOption></NativeSelect>{backgroundType !== "label" && <><div className="colour-row"><label>Fill <input type="color" value={backgroundFill} onChange={(event) => setBackgroundFill(event.target.value)} disabled={backgroundType === "line"} /></label><label>Outline <input type="color" value={backgroundStroke} onChange={(event) => setBackgroundStroke(event.target.value)} /></label></div><p className="helper">Click to add points. Finish when the shape is ready.</p><div className="draft-actions"><Button size="sm" disabled={draftPoints.length < (backgroundType === "area" ? 3 : 2)} onClick={finishBackground}>Finish shape</Button><Button size="sm" variant="ghost" disabled={!draftPoints.length} onClick={() => setDraftPoints([])}>Cancel</Button></div></>}</div>}
          <ToolButton active={tool === "note"} icon={<StickyNote />} title="Add note" note="Click the map to place an evaluation note" onClick={() => { setTool("note"); setRouteStart(null); clearSelection(); }} />
        </div>
        <div className="format-control"><Label htmlFor="map-format">Board format</Label><NativeSelect id="map-format" value={data.format} onChange={(event) => changeFormat(event.target.value as MapFormat)}>{Object.entries(mapFormats).map(([key, item]) => <NativeSelectOption key={key} value={key}>{item.label}</NativeSelectOption>)}</NativeSelect><dl className="format-measurements"><div><dt>Finished size</dt><dd>{format.widthMm.toLocaleString("en-GB")} × {format.heightMm.toLocaleString("en-GB")} mm{format.imperial ? ` (${format.imperial})` : ""}</dd></div>{format.columns > 1 && <div><dt>Panel size</dt><dd>about {panelWidthMm} × {panelHeightMm} mm</dd></div>}</dl><p>{format.note}{format.custom ? ". This is not a verified commercial Ticket to Ride size" : ""}. Changing format keeps objects in the same relative positions.</p></div>
        <div className={cn("crossing-card", crossings.length && "has-warning")}><div className="crossing-icon">{crossings.length ? <AlertTriangle /> : <Check />}</div><div><strong>{crossings.length ? `${crossings.length} crossing${crossings.length === 1 ? "" : "s"}` : "No crossings"}</strong><p>{crossings.length ? "between buildable routes" : "The route network is geometrically clean"}</p></div></div>
        <div className="legend"><p className="eyebrow">Stop types</p>{Object.entries(stopTypeMeta).map(([key, meta]) => <div key={key}><i style={{ background: meta.fill, borderColor: meta.stroke }} />{meta.label}</div>)}</div>
        <Button variant="ghost" className="reset-button" onClick={() => setDanger("reset")}><RotateCcw />Clear map</Button>
      </aside>
      <section className="map-wrap">
        <div className="map-status"><Badge variant="secondary">{format.shortLabel}</Badge><Badge variant="secondary">{format.widthMm.toLocaleString("en-GB")} × {format.heightMm.toLocaleString("en-GB")} mm</Badge><Badge variant="secondary">{data.stops.length} stops</Badge><Badge variant="secondary">{data.routes.length} routes</Badge><Badge variant="secondary">{data.background.length} background objects</Badge>{data.notes.length > 0 && <Badge variant="secondary">{data.notes.length} note{data.notes.length === 1 ? "" : "s"}</Badge>}<span>Everything is stored in the exported map file</span></div>
        <svg className={cn("map-canvas", `tool-${tool}`)} style={{ aspectRatio: `${W} / ${format.height}` }} viewBox={`0 0 ${W} ${format.height}`} onPointerDown={onCanvasDown} onPointerMove={onCanvasMove} onPointerUp={stopDragging} onPointerLeave={stopDragging}>
          <MapArtwork data={data} selectedRoute={selectedRoute} selectedStop={selectedStop} selectedBackground={selectedBackground} imageSelected={imageSelected} selectedNote={selectedNote} routeStart={routeStart} draft={{ type: backgroundType, points: draftPoints, fill: backgroundFill, stroke: backgroundStroke }} onRoute={(id) => { setSelectedRoute(id); setSelectedStop(null); setSelectedBackground(null); setSelectedNote(null); setTool("select"); }} onRouteSlot={toggleLocomotiveSlot} onStop={(id) => { chooseStop(id); if (tool === "select") dragStopRef.current = id; }} onWaypoint={(routeId, index) => { dragWaypointRef.current = { routeId, index }; }} onBackground={(id) => { setSelectedBackground(id); setSelectedRoute(null); setSelectedStop(null); setSelectedNote(null); setTool("select"); }} onBackgroundPoint={(shapeId, index) => { dragBackgroundPointRef.current = { shapeId, index }; }} onBackgroundLabel={(shapeId) => { dragBackgroundLabelRef.current = shapeId; }} onImageSelect={chooseImage} onImageMove={() => { chooseImage(); dragImageRef.current = "move"; }} onImageScale={() => { dragImageRef.current = "scale"; }} onImageRotate={() => { dragImageRef.current = "rotate"; }} onNoteSelect={chooseNote} onNoteMove={(id) => { chooseNote(id); dragNoteRef.current = { id, mode: "move" }; }} onNoteResize={(id) => { dragNoteRef.current = { id, mode: "resize" }; }} />
        </svg>
      </section>
      <aside className="properties panel">
        <div className="panel-heading"><span>Properties</span><small>{imageSelected ? "Background image selected" : selectedN ? "Note selected" : selectedB ? "Background object selected" : selectedR ? "Route selected" : selectedS ? "Stop selected" : "Select an object on the map"}</small></div>
        {!imageSelected && !selectedN && !selectedB && !selectedR && !selectedS && <div className="empty-state"><CircleDot /><p>Edit names, types, colours, geometry and route length here.</p></div>}
        {selectedN && <NoteProperties note={selectedN} change={change} onDelete={() => setDanger("delete")} />}
        {imageSelected && data.backgroundImage && <BackgroundImageProperties image={data.backgroundImage} change={change} onDelete={() => setDanger("delete")} />}
        {selectedB && <BackgroundProperties shape={selectedB} change={change} onDelete={() => setDanger("delete")} />}
        {selectedS && <StopProperties stop={selectedS} change={change} onDelete={() => setDanger("delete")} />}
        {selectedR && <RouteProperties route={selectedR} stops={data.stops} routes={data.routes} lineStyles={data.lineStyles} routeTypeStyles={data.routeTypeStyles} change={change} onDelete={() => setDanger("delete")} onCreateStyle={addLineStyleToRoute} onUpdateStyle={updateLineStyle} onDeleteStyle={deleteLineStyle} onSetStyle={assignRouteLineStyle} onCreateType={addRouteTypeToRoute} onUpdateType={updateRouteType} onDeleteType={deleteRouteType} />}
      </aside>
    </div>
    <AlertDialog open={danger !== null} onOpenChange={(open) => { if (!open) { setDanger(null); setPendingImport(null); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{danger === "reset" ? "Clear the entire map?" : danger === "load-blank" ? "Replace the current map with a blank one?" : danger === "load-example" ? "Replace the current map with the example?" : danger === "import-background" ? "Replace the background?" : danger === "import-network" ? "Replace stops and routes?" : danger === "import-image" ? "Replace the background image?" : "Delete the selected object?"}</AlertDialogTitle><AlertDialogDescription>{danger === "reset" ? "All locally stored background objects, stops and routes will be removed. Export the map first if you want to keep it." : danger === "load-blank" ? "Your current background objects, stops and routes will be replaced with a blank map. Export the map first if you want to keep your work." : danger === "load-example" ? "Your current background objects, stops and routes will be replaced with the neutral example map. Export the map first if you want to keep your work." : danger === "import-background" ? "The imported background, including any background image, will replace the current one. Stops and routes are kept as they are." : danger === "import-network" ? "The imported stops and routes will replace the current network. Background objects are kept as they are." : danger === "import-image" ? "The new image will replace the current background image." : selectedStop ? "The stop and all connected routes will be deleted." : "The selected object will be deleted."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (danger === "reset") { change(() => cloneMap(emptyMap)); clearSelection(); setDanger(null); } else if (danger === "load-blank") applyGuideChoice(emptyMap); else if (danger === "load-example") applyGuideChoice(initialMap); else if (danger === "import-background" && pendingImport?.kind === "background") applyBackgroundImport(pendingImport.background, pendingImport.backgroundImage); else if (danger === "import-network" && pendingImport?.kind === "network") applyNetworkImport(pendingImport.stops, pendingImport.routes, pendingImport.lineStyles, pendingImport.routeTypeStyles); else if (danger === "import-image" && pendingImport?.kind === "image") applyImageImport(pendingImport.image); else deleteSelected(); }}>Continue</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <WelcomeGuide open={showGuide} onOpenChange={(open) => !open && dismissGuide()} onChooseBlank={() => chooseFromGuide("blank")} onChooseExample={() => chooseFromGuide("example")} />
    <PrintPages data={data} />
  </main>;
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

function PrintPages({ data }: { data: MapData }) {
  const format = mapFormats[data.format];
  const panels = Array.from({ length: format.columns * format.rows }, (_, index) => ({ column: index % format.columns, row: Math.floor(index / format.columns) }));
  return <div className={cn("print-pages", `format-${data.format}`)} aria-hidden="true">{panels.map(({ column, row }, index) => {
    const panelWidth = W / format.columns;
    const panelHeight = format.height / format.rows;
    const printedPanelScale = Math.round(190 / (format.widthMm / format.columns) * 100);
    const panelName = format.columns === 1 ? `${format.shortLabel} · ${format.widthMm} × ${format.heightMm} mm${format.imperial ? ` (${format.imperial})` : ""}` : `Panel ${index + 1} of ${panels.length} · row ${row + 1}, column ${column + 1} · A4 proof at about ${printedPanelScale}%`;
    return <section className="print-page" key={`${column}-${row}`}><div className="print-caption"><strong>{data.name}</strong><span>{panelName}</span></div><svg viewBox={`${column * panelWidth} ${row * panelHeight} ${panelWidth} ${panelHeight}`}><MapArtwork data={data} print /></svg></section>;
  })}</div>;
}

const dashPresets: Array<{ value: string; label: string }> = [
  { value: "", label: "Solid" },
  { value: "4 4", label: "Fine dashes" },
  { value: "10 6", label: "Dashes" },
  { value: "2 5", label: "Dotted" },
  { value: "14 4 2 4", label: "Dash-dot" },
];

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
  const colourApplies = typeId !== "city" && typeId !== "region";
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
      {colourApplies ? <div><Label>Line colour</Label><input className="colour-input" type="color" value={style.stroke} onChange={(event) => onUpdateType(style.id, { stroke: event.target.value })} /></div> : <p className="helper">City and region routes use each route&apos;s own colour instead of the type&apos;s colour.</p>}
      <div><Label>Thickness · {style.strokeWidth}px</Label><input className="range-input" type="range" min="2" max="14" value={style.strokeWidth} onChange={(event) => onUpdateType(style.id, { strokeWidth: Number(event.target.value) })} /></div>
      <div><Label>Dash pattern</Label><NativeSelect value={style.dash} onChange={(event) => onUpdateType(style.id, { dash: event.target.value })}>{dashPresets.map((preset) => <NativeSelectOption key={preset.label} value={preset.value}>{preset.label}</NativeSelectOption>)}</NativeSelect></div>
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

function RouteProperties({ route, stops, routes, lineStyles, routeTypeStyles, change, onDelete, onCreateStyle, onUpdateStyle, onDeleteStyle, onSetStyle, onCreateType, onUpdateType, onDeleteType }: { route: Route; stops: Stop[]; routes: Route[]; lineStyles: LineStyle[]; routeTypeStyles: RouteTypeStyle[]; change: (fn: (draft: MapData) => MapData) => void; onDelete: () => void; onCreateStyle: (routeId: string) => void; onUpdateStyle: (styleId: string, values: Partial<LineStyle>) => void; onDeleteStyle: (styleId: string) => void; onSetStyle: (routeId: string, styleId: string | undefined) => void; onCreateType: (routeId: string) => void; onUpdateType: (typeId: string, values: Partial<RouteTypeStyle>) => void; onDeleteType: (typeId: string) => void }) {
  const update = (values: Partial<Route>) => change((draft) => { const item = draft.routes.find((entry) => entry.id === route.id); if (item) Object.assign(item, values); return draft; });
  const infrastructure = routeTypeStyles.find((style) => style.id === route.type)?.infrastructure ?? false;
  const stopName = (id: string) => stops.find((stop) => stop.id === id)?.name ?? "";
  return <div className="property-form">
    <div className="route-names"><span>{stopName(route.a)}</span><ChevronDown /><span>{stopName(route.b)}</span></div>
    <RouteTypeEditor typeId={route.type} routeTypeStyles={routeTypeStyles} routes={routes} onSelectType={(typeId) => update({ type: typeId })} onCreateType={() => onCreateType(route.id)} onUpdateType={onUpdateType} onDeleteType={onDeleteType} />
    {!infrastructure && <>
      <div><Label>Colour</Label><NativeSelect value={route.color} onChange={(event) => update({ color: event.target.value })}>{Object.keys(routeColors).map((key) => <NativeSelectOption key={key} value={key}>{colorLabels[key]}</NativeSelectOption>)}</NativeSelect></div>
      <div><Label>Vehicle spaces</Label><div className="length-stepper"><Button variant="outline" size="icon" aria-label="Decrease" disabled={route.length <= 1} onClick={() => update({ length: Math.max(1, route.length - 1), locomotiveSlots: route.locomotiveSlots?.filter((index) => index < route.length - 1) })}><Minus /></Button><strong>{route.length}</strong><Button variant="outline" size="icon" aria-label="Increase" disabled={route.length >= 8} onClick={() => update({ length: Math.min(8, route.length + 1) })}><Plus /></Button></div><p className="helper">The change is shown directly on the route.</p></div>
      <div><Label>Locomotives required · {route.locomotiveSlots?.length ?? 0} of {route.length}</Label><p className="helper">Click a wagon slot directly on the selected route to toggle it.</p>{Boolean(route.locomotiveSlots?.length) && <Button size="sm" variant="ghost" onClick={() => update({ locomotiveSlots: [] })}><TrainFront />Clear locomotives</Button>}</div>
    </>}
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

function MapArtwork({ data, selectedRoute, selectedStop, selectedBackground, imageSelected, selectedNote, routeStart, draft, onRoute, onRouteSlot, onStop, onWaypoint, onBackground, onBackgroundPoint, onBackgroundLabel, onImageSelect, onImageMove, onImageScale, onImageRotate, onNoteSelect, onNoteMove, onNoteResize, print = false }: { data: MapData; selectedRoute?: string | null; selectedStop?: string | null; selectedBackground?: string | null; imageSelected?: boolean; selectedNote?: string | null; routeStart?: string | null; draft?: { type: BackgroundType; points: Point[]; fill: string; stroke: string }; onRoute?: (id: string) => void; onRouteSlot?: (routeId: string, index: number) => void; onStop?: (id: string) => void; onWaypoint?: (routeId: string, index: number) => void; onBackground?: (id: string) => void; onBackgroundPoint?: (shapeId: string, index: number) => void; onBackgroundLabel?: (shapeId: string) => void; onImageSelect?: () => void; onImageMove?: () => void; onImageScale?: () => void; onImageRotate?: () => void; onNoteSelect?: (id: string) => void; onNoteMove?: (id: string) => void; onNoteResize?: (id: string) => void; print?: boolean }) {
  const format = mapFormats[data.format];
  return <>
    <defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0L0 0 0 24" fill="none" stroke="#6b675f" strokeOpacity=".11" /></pattern><filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity=".18" /></filter></defs>
    <rect className="map-bg" width={W} height={format.height} fill="#f7f1e5" /><rect className="map-bg" width={W} height={format.height} fill="url(#grid)" />
    {data.backgroundImage && <BackgroundImageObject image={data.backgroundImage} selected={Boolean(imageSelected)} print={print} onSelect={onImageSelect} onMove={onImageMove} onScale={onImageScale} onRotate={onImageRotate} />}
    {data.background.map((shape) => <BackgroundObject key={shape.id} shape={shape} height={format.height} selected={shape.id === selectedBackground} print={print} onSelect={onBackground} onPoint={onBackgroundPoint} onLabel={onBackgroundLabel} />)}
    {!print && draft && draft.points.length > 0 && <g className="background-draft">{draft.type === "area" ? <polygon points={draft.points.map((p) => `${p.x},${p.y}`).join(" ")} fill={draft.fill} fillOpacity=".35" stroke={draft.stroke} /> : <polyline points={draft.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={draft.stroke} />}{draft.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="6" />)}</g>}
    {data.routes.map((route) => { const typeStyle = data.routeTypeStyles.find((item) => item.id === route.type) ?? { id: route.type, label: route.type, stroke: "#736d64", dash: "", strokeWidth: 3, infrastructure: false }; const style = route.lineStyle ? data.lineStyles.find((item) => item.id === route.lineStyle) : undefined; const points = parallelPoints(data, route); const path = pathFromPoints(points); const infrastructure = typeStyle.infrastructure; const routeColor = route.type === "city" || route.type === "region" ? (route.color === "neutral" ? "#736d64" : routeColors[route.color]) : typeStyle.stroke; const routeSelected = route.id === selectedRoute; return <g key={route.id} className={cn("route-group", routeSelected && "selected", style && "custom-style")} onPointerDown={onRoute ? (event) => { event.stopPropagation(); onRoute(route.id); } : undefined}><path d={path} className="route-hit" /><path d={path} className={cn("route-guide", infrastructure && "infrastructure")} fill="none" stroke={routeColor} strokeWidth={style ? style.strokeWidth : typeStyle.strokeWidth} strokeDasharray={style ? style.dash : typeStyle.dash} strokeLinecap="round" strokeLinejoin="round" />{!infrastructure && Array.from({ length: route.length }, (_, index) => { const position = pointAlong(points, (index + .5) / route.length); const isLocomotive = route.locomotiveSlots?.includes(index); const interactive = !print && routeSelected; return <g key={index} className={cn("wagon-slot", isLocomotive && "locomotive")} transform={`translate(${position.x},${position.y}) rotate(${position.angle})`} filter={print ? undefined : "url(#shadow)"} onPointerDown={interactive ? (event) => { event.stopPropagation(); onRouteSlot?.(route.id, index); } : undefined}><rect className="wagon-slot-outline" x={-13} y={-7} width="26" height="14" rx="4" /><rect x={-12} y={-6} width="24" height="12" rx="3" fill="#fffaf0" stroke={routeColor} strokeWidth="3" />{isLocomotive && <g className="locomotive-icon"><rect x={-8} y={-3.5} width="11" height="7" rx="1.5" /><rect x={2} y={-1.5} width="4.5" height="5" rx="1" /><rect x={-2.5} y={-6.5} width="2.5" height="3.5" /><circle cx={-4.5} cy={4} r="1.6" /><circle cx={1.5} cy={4} r="1.6" /></g>}</g>; })}</g>; })}
    {data.stops.map((stop) => { const meta = stopTypeMeta[stop.type]; const active = stop.id === selectedStop || stop.id === routeStart; const radius = stopSizeMeta[stop.size ?? "medium"].radius; return <g key={stop.id} className={cn("stop", active && "active")} transform={`translate(${stop.x},${stop.y})`} onPointerDown={onStop ? (event) => { event.stopPropagation(); onStop(stop.id); } : undefined}><circle r={active ? radius + 3 : radius} fill={meta.fill} stroke={meta.stroke} strokeWidth={active ? 4 : 3} />{stop.type === "rail" && <rect x={-4} y={-4} width="8" height="8" fill={meta.stroke} />}<StopSymbolGlyph stop={stop} radius={radius} color={meta.stroke} /><text x={stop.x > 900 ? -14 : 14} y={stop.y > format.height - 100 ? -13 : -12} textAnchor={stop.x > 900 ? "end" : "start"}>{stop.name}</text></g>; })}
    {data.notes.map((note) => <NoteBoxObject key={note.id} note={note} selected={note.id === selectedNote} print={print} onSelect={onNoteSelect} onMove={onNoteMove} onResize={onNoteResize} />)}
    {!print && selectedRoute && data.routes.find((route) => route.id === selectedRoute)?.points?.map((point, index) => <g key={index} className="waypoint-handle" transform={`translate(${point.x},${point.y})`} onPointerDown={(event) => { event.stopPropagation(); onWaypoint?.(selectedRoute, index); }}><circle className="waypoint-hit" r="19" /><rect x="-8" y="-8" width="16" height="16" rx="3" transform="rotate(45)" /><circle r="3" /></g>)}
    {format.columns > 1 && <g className="fold-guides">{Array.from({ length: format.columns - 1 }, (_, index) => <line key={`v-${index}`} x1={W * (index + 1) / format.columns} y1="0" x2={W * (index + 1) / format.columns} y2={format.height} />)}{Array.from({ length: format.rows - 1 }, (_, index) => <line key={`h-${index}`} x1="0" y1={format.height * (index + 1) / format.rows} x2={W} y2={format.height * (index + 1) / format.rows} />)}</g>}
  </>;
}

function BackgroundImageObject({ image, selected, print, onSelect, onMove, onScale, onRotate }: { image: BackgroundImage; selected: boolean; print: boolean; onSelect?: () => void; onMove?: () => void; onScale?: () => void; onRotate?: () => void }) {
  const cx = image.x + image.width / 2;
  const cy = image.y + image.height / 2;
  const cropX = image.crop.left * image.naturalWidth;
  const cropY = image.crop.top * image.naturalHeight;
  const cropWidth = Math.max(1, image.naturalWidth * (1 - image.crop.left - image.crop.right));
  const cropHeight = Math.max(1, image.naturalHeight * (1 - image.crop.top - image.crop.bottom));
  return <g className={cn("background-image", selected && "selected", image.locked && "locked")} opacity={image.opacity} transform={`rotate(${image.rotation} ${cx} ${cy})`} onPointerDown={!print ? (event) => { event.stopPropagation(); onSelect?.(); if (!image.locked) onMove?.(); } : undefined}>
    <svg x={image.x} y={image.y} width={image.width} height={image.height} viewBox={`${cropX} ${cropY} ${cropWidth} ${cropHeight}`} preserveAspectRatio="none"><image href={image.dataUrl} width={image.naturalWidth} height={image.naturalHeight} preserveAspectRatio="none" /></svg>
    {!print && selected && <rect className="image-bounds" x={image.x} y={image.y} width={image.width} height={image.height} fill="none" />}
    {!print && selected && !image.locked && <>
      <line className="image-rotate-guide" x1={cx} y1={image.y} x2={cx} y2={image.y - 30} />
      <g className="image-scale-handle" transform={`translate(${image.x + image.width},${image.y + image.height})`} onPointerDown={(event) => { event.stopPropagation(); onScale?.(); }}><circle className="point-hit" r="18" /><rect x="-7" y="-7" width="14" height="14" rx="2" /></g>
      <g className="image-rotate-handle" transform={`translate(${cx},${image.y - 30})`} onPointerDown={(event) => { event.stopPropagation(); onRotate?.(); }}><circle className="point-hit" r="18" /><circle r="7" /></g>
    </>}
  </g>;
}

function BackgroundImageProperties({ image, change, onDelete }: { image: BackgroundImage; change: (fn: (draft: MapData) => MapData) => void; onDelete: () => void }) {
  const update = (values: Partial<BackgroundImage>) => change((draft) => { if (draft.backgroundImage) Object.assign(draft.backgroundImage, values); return draft; });
  const updateCrop = (edge: keyof ImageCrop, percent: number) => change((draft) => { if (draft.backgroundImage) draft.backgroundImage.crop = { ...draft.backgroundImage.crop, [edge]: Math.max(0, Math.min(45, percent)) / 100 }; return draft; });
  return <div className="property-form">
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

function NoteBoxObject({ note, selected, print, onSelect, onMove, onResize }: { note: NoteBox; selected: boolean; print: boolean; onSelect?: (id: string) => void; onMove?: (id: string) => void; onResize?: (id: string) => void }) {
  return <g className={cn("note-box", selected && "selected", note.locked && "locked")} transform={`translate(${note.x},${note.y})`} onPointerDown={!print ? (event) => { event.stopPropagation(); onSelect?.(note.id); if (!note.locked) onMove?.(note.id); } : undefined}>
    <rect className="note-box-bg" width={note.width} height={note.height} rx="8" />
    <foreignObject x="0" y="0" width={note.width} height={note.height}><div {...{ xmlns: "http://www.w3.org/1999/xhtml" }} className="note-box-text">{note.text}</div></foreignObject>
    {!print && selected && !note.locked && <g className="note-resize-handle" transform={`translate(${note.width},${note.height})`} onPointerDown={(event) => { event.stopPropagation(); onResize?.(note.id); }}><circle className="point-hit" r="18" /><rect x="-7" y="-7" width="14" height="14" rx="2" /></g>}
  </g>;
}

function BackgroundObject({ shape, height, selected, print, onSelect, onPoint, onLabel }: { shape: BackgroundShape; height: number; selected: boolean; print: boolean; onSelect?: (id: string) => void; onPoint?: (id: string, index: number) => void; onLabel?: (id: string) => void }) {
  const points = shape.points.map((point) => `${point.x},${point.y}`).join(" ");
  const anchor = shape.type === "label" ? shape.points[0] : (shape.labelPoint ?? automaticLabelPoint(shape, height));
  const labelAtRightEdge = Boolean(anchor && anchor.x > W - 140);
  const handleX = anchor ? Math.max(18, Math.min(W - 18, anchor.x)) : 0;
  const handleY = anchor ? Math.max(24, Math.min(height - 18, anchor.y)) : 0;
  const labelX = Math.max(18, Math.min(W - 18, handleX + (labelAtRightEdge ? -12 : 12)));
  const labelY = Math.max(24, Math.min(height - 18, handleY - 12));
  const labelAnchor = labelAtRightEdge ? "end" : "start";
  return <g className={cn("background-object", selected && "selected", shape.locked && "locked")} onPointerDown={onSelect ? (event) => { event.stopPropagation(); onSelect(shape.id); } : undefined}>
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

function ToolButton({ active, icon, title, note, onClick }: { active: boolean; icon: React.ReactNode; title: string; note: string; onClick: () => void }) { return <button className={cn("tool-button", active && "active")} onClick={onClick}><span>{icon}</span><div><strong>{title}</strong><small>{note}</small></div></button>; }
