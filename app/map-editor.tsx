"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BarChart3, Crosshair, BusFront, Check, ChevronDown, ChevronUp, GripVertical, CircleDot, CircleHelp, Download, Image as ImageIcon, Layers3, Lightbulb, Link2, MapPinPlus, MousePointer2, Printer, Redo2, RotateCcw, Ruler, StickyNote, Trash2, Undo2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { MapArtwork, type Tool } from "./map-artwork";
import { AnalysisDialog, SuggestionsDialog, WelcomeGuide } from "./map-dialogs";
import { BackgroundImageProperties, BackgroundProperties, LineStylePicker, NoteProperties, RouteProperties, RouteTypeEditor, StopProperties } from "./map-properties";
import { PrintPages } from "./map-print";
import { autoPlaceLabels, type RouteSuggestion, labelCovers, labelAngleOptions, routeSamplePoints, colourLengthTable, crossingPairs, buildAdjacency, networkStats, routeSpacing, shortestPath, suggestRoutes } from "./map-analysis";
import { canvasPoint, pointsFor, samePair, stopById } from "./map-geometry";
import { cloneForHistory, cloneMap, formatTimestamp, GUIDE_SEEN_KEY, HISTORY_LIMIT, MAX_IMAGE_WARN_BYTES, normalizeBackgroundFile, normalizeMap, normalizeNetworkFile, readBackgroundImage, rescaleMapToFormat, MAP_HINT_KEY, MAP_HINT_X_KEY } from "./map-storage";
import { colorLabels, emptyMap, initialMap, type LineStyle, DEFAULT_END_GAP_MM, mapFormats, type BackgroundImage, type BackgroundShape, type BackgroundType, type MapData, type MapFormat, type Point, realWagon, type Route, type RouteType, type RouteTypeStyle, routeColors, STORAGE_KEY, type Stop, type StopSize, stopSizeMeta, type StopSymbol, stopSymbolMeta, type StopType, stopTypeMeta, W } from "./map-data";

type MeasureResult = { from: string; to: string; distance: number; routeIds: string[] } | { from: string; to: string; unreachable: true };
type Danger = "reset" | "delete" | "load-blank" | "load-example" | "import-background" | "import-network" | "import-image" | null;
type PendingImport = { kind: "background"; background: BackgroundShape[]; backgroundImage?: BackgroundImage } | { kind: "network"; stops: Stop[]; routes: Route[]; lineStyles: LineStyle[]; routeTypeStyles: RouteTypeStyle[] } | { kind: "image"; image: BackgroundImage };
// Snapshots are geometry-only (see cloneForHistory), so a deep stack stays in the low megabytes
// even for a large map. Kept in memory for the session only, never written to local storage.

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
  const [routeCurved, setRouteCurved] = useState(true);
  const [routeLineStyle, setRouteLineStyle] = useState<string | undefined>(undefined);
  const [stopSymbol, setStopSymbol] = useState<StopSymbol>("none");
  const [stopLetter, setStopLetter] = useState("");
  const [backgroundType, setBackgroundType] = useState<BackgroundType>("area");
  const [backgroundFill, setBackgroundFill] = useState("#b8ddea");
  const [backgroundStroke, setBackgroundStroke] = useState("#4f8394");
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [routeStart, setRouteStart] = useState<string | null>(null);
  const [routeHintOpen, setRouteHintOpen] = useState(true);
  const [linkParallel, setLinkParallel] = useState(true);
  // Collapsing the help is a lasting preference, not a per-selection one: reopening it on the next
  // route you click would defeat the point of hiding it.
  const [routeHintX, setRouteHintX] = useState(0);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(MAP_HINT_KEY) === "closed") setRouteHintOpen(false);
      const x = Number(window.localStorage.getItem(MAP_HINT_X_KEY));
      if (Number.isFinite(x) && x) setRouteHintX(x);
    } catch { /* private mode */ }
  }, []);
  const moveRouteHint = (value: number) => {
    setRouteHintX(value);
    try { window.localStorage.setItem(MAP_HINT_X_KEY, String(Math.round(value))); } catch { /* private mode */ }
  };
  const toggleRouteHint = () => setRouteHintOpen((open) => {
    try { window.localStorage.setItem(MAP_HINT_KEY, open ? "closed" : "open"); } catch { /* private mode */ }
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
  const dragWaypointRef = useRef<{ routeId: string; index: number; grabOffset: Point } | null>(null);
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
  const routeSamples = useMemo(() => routeSamplePoints(data), [data]);
  const coveredNames = useMemo(() => data.stops.filter((stop) => labelCovers(data, stop, routeSamples)), [data, routeSamples]);

  const tightRoutes = spacing.filter((item) => item.verdict === "short");
  const looseRoutes = spacing.filter((item) => item.verdict === "long");
  const adjacency = useMemo(() => buildAdjacency(data), [data]);
  const stats = useMemo(() => networkStats(data), [data]);
  const colourTable = useMemo(() => colourLengthTable(data), [data]);
  const lowConnectionStops = useMemo(() => data.stops.filter((stop) => (stats.neighbours.get(stop.id) ?? 0) < 2), [data.stops, stats]);
  const avgHubDegree = data.stops.length ? Array.from(stats.hubDegree.values()).reduce((sum, value) => sum + value, 0) / data.stops.length : 0;
  const suggestions = useMemo(() => suggestRoutes(data, stats, colourTable), [data, stats, colourTable]);
  const selectedS = data.stops.find((stop) => stop.id === selectedStop);
  // For the selected stop: is its name on a route, which bearings are clear, and which is best.
  const selectedLabelState = useMemo(() => {
    if (!selectedS) return { covers: false, clear: [] as number[], best: 0 };
    const options = labelAngleOptions(data, selectedS, routeSamples);
    const clear = options.filter((option) => option.overlap === 0).map((option) => option.angle);
    const best = [...options].sort((a, b) => a.overlap - b.overlap)[0]?.angle ?? 0;
    return { covers: labelCovers(data, selectedS, routeSamples), clear, best };
  }, [data, routeSamples, selectedS]);
  const selectedR = data.routes.find((route) => route.id === selectedRoute);
  // Put the shape hint on whichever edge of the board the selected route is furthest from,
  // so it never covers the bend points you are about to drag.
  const selectedRouteHasSlots = Boolean(selectedR) && !(data.routeTypeStyles.find((style) => style.id === selectedR?.type)?.infrastructure ?? false);
  // Whichever object is selected gets the same box, on whichever edge of the board it is furthest
  // from, so it never covers what you are editing.
  const hint = (() => {
    const above = (y: number) => y > format.height / 2;
    if (selectedR) {
      const points = pointsFor(data, selectedR);
      const atTop = points.length ? above(points.reduce((sum, point) => sum + point.y, 0) / points.length) : false;
      return { atTop, title: "Editing this route", body: <>Click a <b>+</b> to add a bend point anywhere along it · drag a bend point to move it · <b>double-click a bend point to remove it</b> · tick <b>Draw as a smooth curve</b> under Properties to bend it into an arc{selectedRouteHasSlots ? <> · <b>click a wagon space to mark it as needing a locomotive</b>, and click it again to clear it</> : null}</> };
    }
    if (selectedS) return { atTop: above(selectedS.y), title: "Editing this stop", body: <>Drag the stop to move it, and every route into it follows · <b>hold Shift to drag it even when its position is locked</b> · turn its name out of the way with <b>Name position</b> under Properties · with the Draw route tool, click this stop and then another to connect them</> };
    return null;
  })();
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
      change((draft) => { draft.routes.push({ id: `r-${Date.now()}`, a: routeStart, b: id, length: 2, type: routeType, color: routeColor, lineStyle: routeLineStyle, curved: routeCurved ? undefined : false }); return draft; });
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
        const placed = { x: point.x - target.grabOffset.x, y: point.y - target.grabOffset.y };
      const dragged = current.routes.find((route) => route.id === target.routeId);
        const linked = new Set((dragged && linkParallel ? current.routes.filter((route) => samePair(route, dragged)) : dragged ? [dragged] : []).map((route) => route.id));
        return { ...current, routes: current.routes.map((route) => linked.has(route.id) && (route.points?.length ?? 0) > target.index ? { ...route, points: (route.points ?? []).map((item, index) => index === target.index ? placed : item) } : route) };
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
  const applyRouteCurve = (routeId: string, curved: boolean) => change((draft) => { for (const route of bendTargets(draft, routeId)) route.curved = curved ? undefined : false; return draft; });
  const tidyLabels = () => {
    const { placed, unresolved } = autoPlaceLabels(data);
    if (!placed.size && !unresolved.length) { toast.success("Every stop name is already clear of the routes."); return; }
    if (placed.size) change((draft) => { for (const stop of draft.stops) { const angle = placed.get(stop.id); if (angle !== undefined) stop.labelAngle = angle; } return draft; });
    const moved = `Moved ${placed.size} name${placed.size === 1 ? "" : "s"}, clear of the routes and of each other`;
    if (unresolved.length) {
      const names = unresolved.map((id) => stopById(data, id)?.name).filter(Boolean);
      toast.warning(`${moved}. ${unresolved.length} could not be placed: ${names.slice(0, 4).join(", ")}${names.length > 4 ? ` and ${names.length - 4} more` : ""}. Move the stop, bend the route away, or set those by hand.`);
    } else toast.success(`${moved}.`);
  };
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
      return rescaleMapToFormat(draft, nextFormat);
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
          {tool === "route" && <div className="tool-options"><RouteTypeEditor typeId={routeType} routeTypeStyles={data.routeTypeStyles} routes={data.routes} onSelectType={setRouteType} onCreateType={() => setRouteType(createRouteType())} onUpdateType={updateRouteType} onDeleteType={deleteRouteType} /><label className="checkbox-row"><input type="checkbox" checked={routeCurved} onChange={(event) => setRouteCurved(event.target.checked)} />Draw as a smooth curve</label><div><Label>Colour</Label><NativeSelect value={routeColor} onChange={(event) => setRouteColor(event.target.value)}>{Object.keys(routeColors).map((key) => <NativeSelectOption key={key} value={key}>{colorLabels[key]}</NativeSelectOption>)}</NativeSelect></div><LineStylePicker value={routeLineStyle} lineStyles={data.lineStyles} onChange={setRouteLineStyle} onCreate={() => setRouteLineStyle(createLineStyle())} onUpdate={updateLineStyle} onDelete={deleteLineStyle} helper="New routes you draw will use this style. Change it anytime for an existing route from its Properties panel." /></div>}
          {tool === "background" && <div className="tool-options background-tools"><div className="image-import-row"><Label>Background image</Label><div className="image-import-buttons"><Button size="sm" variant="outline" onClick={() => imageFileRef.current?.click()}><ImageIcon />{data.backgroundImage ? "Replace image" : "Import image"}</Button>{data.backgroundImage && <Button size="sm" variant="ghost" onClick={() => { chooseImage(); setDanger("delete"); }}><Trash2 />Remove</Button>}</div></div><Label>Object</Label><NativeSelect value={backgroundType} onChange={(event) => { setBackgroundType(event.target.value as BackgroundType); setDraftPoints([]); }}><NativeSelectOption value="area">Area</NativeSelectOption><NativeSelectOption value="line">Line</NativeSelectOption><NativeSelectOption value="label">Label</NativeSelectOption></NativeSelect>{backgroundType !== "label" && <><div className="colour-row"><label>Fill <input type="color" value={backgroundFill} onChange={(event) => setBackgroundFill(event.target.value)} disabled={backgroundType === "line"} /></label><label>Outline <input type="color" value={backgroundStroke} onChange={(event) => setBackgroundStroke(event.target.value)} /></label></div><p className="helper">Click to add points. Finish when the shape is ready.</p><div className="draft-actions"><Button size="sm" disabled={draftPoints.length < (backgroundType === "area" ? 3 : 2)} onClick={finishBackground}>Finish shape</Button><Button size="sm" variant="ghost" disabled={!draftPoints.length} onClick={() => setDraftPoints([])}>Cancel</Button></div></>}</div>}
        </div>
        <div className="format-control"><Label htmlFor="map-format">Board format</Label><NativeSelect id="map-format" value={data.format} onChange={(event) => changeFormat(event.target.value as MapFormat)}>{Object.entries(mapFormats).map(([key, item]) => <NativeSelectOption key={key} value={key}>{item.label}</NativeSelectOption>)}</NativeSelect><dl className="format-measurements"><div><dt>Finished size</dt><dd>{format.widthMm.toLocaleString("en-GB")} × {format.heightMm.toLocaleString("en-GB")} mm{format.imperial ? ` (${format.imperial})` : ""}</dd></div>{format.columns > 1 && <div><dt>Panel size</dt><dd>about {panelWidthMm} × {panelHeightMm} mm</dd></div>}</dl><p>{format.note}{format.custom ? ". This is not a verified commercial Ticket to Ride size" : ""}. Changing format keeps objects in the same relative positions.</p></div>
        <div className="spacing-control">
          <Label htmlFor="end-gap">Space at stops · {data.endGapMm ?? DEFAULT_END_GAP_MM} mm</Label>
          <input id="end-gap" className="range-input" type="range" min="0" max="30" step="1" value={data.endGapMm ?? DEFAULT_END_GAP_MM} onChange={(event) => change((draft) => { draft.endGapMm = Number(event.target.value); return draft; })} />
          <p className="helper">The default room left beyond a stop&apos;s own circle before the first wagon. A single stop can override it from its own panel, which is how the two ends of one line can differ. Past about 4 mm the wagons start losing their real spacing.</p>
        </div>
        <div className="scale-control">
          {format.testSheet && <div><Label htmlFor="scale-target">Printed as a proof of</Label><NativeSelect id="scale-target" value={scaleTarget} onChange={(event) => setScaleTarget(event.target.value as MapFormat)}>{Object.entries(mapFormats).filter(([, item]) => !item.testSheet).map(([key, item]) => <NativeSelectOption key={key} value={key}>{item.shortLabel}</NativeSelectOption>)}</NativeSelect></div>}
          <p className="helper">Wagon spaces are drawn at the size a real {realWagon.length} × {realWagon.width} mm train takes up on a {scaleWidthMm.toLocaleString("en-GB")} mm board{format.testSheet ? `, shrunk with the sheet to about ${(realWagon.length / scaleWidthMm * format.widthMm).toFixed(1)} mm each in print` : ", so printing this format at full size gives real-size wagons"}. {tightRoutes.length || looseRoutes.length ? `${[tightRoutes.length && `${tightRoutes.length} too short`, looseRoutes.length && `${looseRoutes.length} roomier than needed`].filter(Boolean).join(", ")} — see Analyze balance.` : "Every route is drawn about the length its wagon count needs."}</p>
        </div>
        {coveredNames.length > 0 && <Tooltip><TooltipTrigger asChild>
          <div className="crossing-card has-warning" tabIndex={0}><div className="crossing-icon"><AlertTriangle /></div><div><strong>{coveredNames.length} stop name{coveredNames.length === 1 ? "" : "s"} on a route</strong><p>{coveredNames.slice(0, 3).map((stop) => stop.name).join(", ")}{coveredNames.length > 3 ? ` and ${coveredNames.length - 3} more` : ""}</p></div></div>
        </TooltipTrigger><TooltipContent side="right" className="balance-tooltip">
          <p>A stop&apos;s name is drawn over a route line, which is hard to read in print.</p>
          <p>Select the stop and use <strong>Name position</strong> to turn the name around it. If the stop is so hemmed in that no position is clear, the panel says so — then move the stop, bend the route away, or accept it.</p>
          <p>Text width is estimated rather than measured, so this errs slightly on the cautious side.</p>
        </TooltipContent></Tooltip>}
        {coveredNames.length > 0 && <Button variant="outline" size="sm" className="analyze-button" onClick={tidyLabels}><Crosshair />Move names clear</Button>}
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
        {hint && hint.atTop && <MapHint atTop title={hint.title} open={routeHintOpen} onToggle={toggleRouteHint} offsetX={routeHintX} onOffsetChange={moveRouteHint}>{hint.body}</MapHint>}
        <svg className={cn("map-canvas", `tool-${tool}`)} style={{ aspectRatio: `${W} / ${format.height}` }} viewBox={`0 0 ${W} ${format.height}`} onPointerDown={onCanvasDown} onPointerMove={onCanvasMove} onPointerUp={stopDragging} onPointerLeave={stopDragging}>
          <MapArtwork data={data} tool={tool} scaleWidthMm={scaleWidthMm} selectedRoute={selectedRoute} selectedStop={selectedStop} selectedBackground={selectedBackground} imageSelected={imageSelected} selectedNote={selectedNote} routeStart={routeStart} draft={{ type: backgroundType, points: draftPoints, fill: backgroundFill, stroke: backgroundStroke }} onRoute={(id) => { setSelectedRoute(id); setSelectedStop(null); setSelectedBackground(null); setSelectedNote(null); setTool("select"); }} onRouteSlot={toggleLocomotiveSlot} onRouteBendInsert={insertRouteBend} onRouteBendRemove={removeRouteBend} onStop={(id, shiftHeld) => { chooseStop(id); if (tool === "select" && (shiftHeld || !stopById(data, id)?.locked)) { beginDrag(); dragStopRef.current = id; } }} onWaypoint={(routeId, index, grabOffset) => { beginDrag(); dragWaypointRef.current = { routeId, index, grabOffset }; }} onBackground={(id) => { setSelectedBackground(id); setSelectedRoute(null); setSelectedStop(null); setSelectedNote(null); setTool("select"); }} onBackgroundPoint={(shapeId, index) => { beginDrag(); dragBackgroundPointRef.current = { shapeId, index }; }} onBackgroundLabel={(shapeId) => { beginDrag(); dragBackgroundLabelRef.current = shapeId; }} onImageSelect={chooseImage} onImageMove={(point) => { chooseImage(); const img = data.backgroundImage; if (img) { beginDrag(); dragImageRef.current = { mode: "move", offsetX: point.x - img.x, offsetY: point.y - img.y }; } }} onImageScale={() => { beginDrag(); dragImageRef.current = { mode: "scale" }; }} onImageRotate={() => { beginDrag(); dragImageRef.current = { mode: "rotate" }; }} onNoteSelect={chooseNote} onNoteMove={(id, point) => { chooseNote(id); const note = data.notes.find((item) => item.id === id); if (note) { beginDrag(); dragNoteRef.current = { id, mode: "move", offsetX: point.x - note.x, offsetY: point.y - note.y }; } }} onNoteResize={(id) => { beginDrag(); dragNoteRef.current = { id, mode: "resize" }; }} />
        </svg>
        {hint && !hint.atTop && <MapHint atTop={false} title={hint.title} open={routeHintOpen} onToggle={toggleRouteHint} offsetX={routeHintX} onOffsetChange={moveRouteHint}>{hint.body}</MapHint>}
      </section>
      <aside className="properties panel">
        <div className="panel-heading"><span>Properties</span><small>{imageSelected ? "Background image selected" : selectedN ? "Note selected" : selectedB ? "Background object selected" : selectedR ? "Route selected" : selectedS ? "Stop selected" : "Select an object on the map"}</small></div>
        {!imageSelected && !selectedN && !selectedB && !selectedR && !selectedS && <div className="empty-state"><CircleDot /><p>Edit names, types, colours, geometry and route length here.</p></div>}
        {selectedN && <NoteProperties note={selectedN} change={change} onDelete={() => setDanger("delete")} />}
        {imageSelected && data.backgroundImage && <BackgroundImageProperties image={data.backgroundImage} formatHeight={format.height} change={change} onDelete={() => setDanger("delete")} />}
        {selectedB && <BackgroundProperties shape={selectedB} change={change} onDelete={() => setDanger("delete")} />}
        {selectedS && <StopProperties stop={selectedS} change={change} onDelete={() => setDanger("delete")} labelState={selectedLabelState} mapEndGapMm={data.endGapMm ?? DEFAULT_END_GAP_MM} />}
        {selectedR && <RouteProperties route={selectedR} stops={data.stops} routes={data.routes} lineStyles={data.lineStyles} routeTypeStyles={data.routeTypeStyles} change={change} onDelete={() => setDanger("delete")} onCreateStyle={addLineStyleToRoute} onUpdateStyle={updateLineStyle} onDeleteStyle={deleteLineStyle} onSetStyle={assignRouteLineStyle} onCreateType={addRouteTypeToRoute} onUpdateType={updateRouteType} onDeleteType={deleteRouteType} onAddParallel={addParallelRoute} onStraighten={straightenRoute} onSetCurved={applyRouteCurve} linkParallel={linkParallel} onLinkParallel={setLinkParallel} />}
      </aside>
    </div>
    <AlertDialog open={danger !== null} onOpenChange={(open) => { if (!open) { setDanger(null); setPendingImport(null); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{danger === "reset" ? "Clear the entire map?" : danger === "load-blank" ? "Replace the current map with a blank one?" : danger === "load-example" ? "Replace the current map with the example?" : danger === "import-background" ? "Replace the background?" : danger === "import-network" ? "Replace stops and routes?" : danger === "import-image" ? "Replace the background image?" : "Delete the selected object?"}</AlertDialogTitle><AlertDialogDescription>{danger === "reset" ? "All locally stored background objects, stops and routes will be removed. Export the map first if you want to keep it." : danger === "load-blank" ? "Your current background objects, stops and routes will be replaced with a blank map. Export the map first if you want to keep your work." : danger === "load-example" ? "Your current background objects, stops and routes will be replaced with the neutral example map. Export the map first if you want to keep your work." : danger === "import-background" ? "The imported background, including any background image, will replace the current one. Stops and routes are kept as they are." : danger === "import-network" ? "The imported stops and routes will replace the current network. Background objects are kept as they are." : danger === "import-image" ? "The new image will replace the current background image." : selectedStop ? "The stop and all connected routes will be deleted." : "The selected object will be deleted."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (danger === "reset") { change(() => cloneMap(emptyMap)); clearSelection(); setDanger(null); } else if (danger === "load-blank") applyGuideChoice(emptyMap); else if (danger === "load-example") applyGuideChoice(initialMap); else if (danger === "import-background" && pendingImport?.kind === "background") applyBackgroundImport(pendingImport.background, pendingImport.backgroundImage); else if (danger === "import-network" && pendingImport?.kind === "network") applyNetworkImport(pendingImport.stops, pendingImport.routes, pendingImport.lineStyles, pendingImport.routeTypeStyles); else if (danger === "import-image" && pendingImport?.kind === "image") applyImageImport(pendingImport.image); else deleteSelected(); }}>Continue</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <WelcomeGuide open={showGuide} onOpenChange={(open) => !open && dismissGuide()} onChooseBlank={() => chooseFromGuide("blank")} onChooseExample={() => chooseFromGuide("example")} />
    <AnalysisDialog open={showAnalysis} onOpenChange={setShowAnalysis} data={data} stats={stats} colourTable={colourTable} spacing={spacing} scaleWidthMm={scaleWidthMm} />
    <SuggestionsDialog open={showSuggestions} onOpenChange={setShowSuggestions} suggestions={suggestions} onAdd={addSuggestedRoute} />
    <PrintPages data={data} scaleWidthMm={scaleWidthMm} />
  </main></TooltipProvider>;
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
function MapHint({ atTop, title, open, onToggle, offsetX, onOffsetChange, children }: { atTop: boolean; title: string; open: boolean; onToggle: () => void; offsetX: number; onOffsetChange: (value: number) => void; children: React.ReactNode }) {
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
  return <div className={cn("map-hint-slot", atTop && "at-top", !open && "collapsed")}>
    {open
      ? <div className="map-hint" ref={boxRef} style={shift}>
        <span className="map-hint-grip" title="Drag to move the box sideways" {...grip}><GripVertical /></span>
        <button type="button" className="map-hint-toggle" onClick={onToggle} aria-label="Collapse the help"><ChevronDown /></button>
        <strong>{title}</strong>
        <span>{children}</span>
      </div>
      : <div className="map-hint-bar" ref={boxRef} style={shift}>
        <span className="map-hint-grip" title="Drag to move the bar sideways" {...grip}><GripVertical /></span>
        <button type="button" onClick={onToggle}><ChevronUp />{title} · show the shortcuts</button>
      </div>}
  </div>;
}

function ToolButton({ active, icon, title, note, onClick }: { active: boolean; icon: React.ReactNode; title: string; note: string; onClick: () => void }) {
  return <Tooltip><TooltipTrigger asChild>
    <button type="button" className={cn("tool-button", active && "active")} onClick={onClick} aria-label={title} aria-pressed={active}>{icon}</button>
  </TooltipTrigger><TooltipContent side="bottom" sideOffset={6} className="tool-tooltip"><strong>{title}</strong><span>{note}</span></TooltipContent></Tooltip>;
}
