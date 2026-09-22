"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BusFront, Check, ChevronDown, CircleDot, Download, Layers3, Link2, Lock, MapPinPlus, Minus, MousePointer2, Plus, Printer, Redo2, RotateCcw, Trash2, Undo2, Unlock, Upload } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { colorLabels, emptyMap, initialMap, mapFormats, type BackgroundShape, type BackgroundType, type MapData, type MapFormat, type Point, type Route, type RouteType, routeColors, routeTypeMeta, STORAGE_KEY, type StopType, stopTypeMeta, W } from "./map-data";

type Tool = "select" | "stop" | "route" | "background";
type Danger = "reset" | "delete" | null;

const cloneMap = (data: MapData): MapData => JSON.parse(JSON.stringify(data));
const isMapFormat = (value: unknown): value is MapFormat => typeof value === "string" && value in mapFormats;
const normalizeMap = (value: Partial<MapData>): MapData => ({
  name: typeof value.name === "string" ? value.name : "Imported map",
  format: isMapFormat(value.format) ? value.format : "board-2x3",
  background: Array.isArray(value.background) ? value.background : [],
  stops: Array.isArray(value.stops) ? value.stops : [],
  routes: Array.isArray(value.routes) ? value.routes : [],
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
  const routes = data.routes.filter((route) => route.type !== "rail" && route.type !== "trail");
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
  const [data, setData] = useState<MapData>(initialMap);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(true);
  const [tool, setTool] = useState<Tool>("select");
  const [stopType, setStopType] = useState<StopType>("city");
  const [routeType, setRouteType] = useState<RouteType>("city");
  const [routeColor, setRouteColor] = useState("neutral");
  const [backgroundType, setBackgroundType] = useState<BackgroundType>("area");
  const [backgroundFill, setBackgroundFill] = useState("#b8ddea");
  const [backgroundStroke, setBackgroundStroke] = useState("#4f8394");
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [routeStart, setRouteStart] = useState<string | null>(null);
  const [selectedStop, setSelectedStop] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [selectedBackground, setSelectedBackground] = useState<string | null>(null);
  const [past, setPast] = useState<MapData[]>([]);
  const [future, setFuture] = useState<MapData[]>([]);
  const [danger, setDanger] = useState<Danger>(null);
  const dragStopRef = useRef<string | null>(null);
  const dragWaypointRef = useRef<{ routeId: string; index: number } | null>(null);
  const dragBackgroundPointRef = useRef<{ shapeId: string; index: number } | null>(null);
  const dragBackgroundLabelRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const format = mapFormats[data.format];
  const panelWidthMm = Math.round(format.widthMm / format.columns);
  const panelHeightMm = Math.round(format.heightMm / format.rows);

  useEffect(() => { queueMicrotask(() => { try { const stored = localStorage.getItem(STORAGE_KEY); if (stored) setData(normalizeMap(JSON.parse(stored))); } catch { /* ignore invalid local state */ } setReady(true); }); }, []);
  useEffect(() => { if (!ready) return; localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); const timer = window.setTimeout(() => setSaved(true), 0); return () => window.clearTimeout(timer); }, [data, ready]);

  const crossings = useMemo(() => crossingPairs(data), [data]);
  const selectedS = data.stops.find((stop) => stop.id === selectedStop);
  const selectedR = data.routes.find((route) => route.id === selectedRoute);
  const selectedB = data.background.find((shape) => shape.id === selectedBackground);
  const change = (fn: (draft: MapData) => MapData) => setData((previous) => { setPast((history) => [...history, cloneMap(previous)].slice(-40)); setFuture([]); setSaved(false); return fn(cloneMap(previous)); });
  const clearSelection = () => { setSelectedStop(null); setSelectedRoute(null); setSelectedBackground(null); };
  const undo = () => { const previous = past.at(-1); if (!previous) return; setFuture((items) => [cloneMap(data), ...items]); setData(previous); setPast((items) => items.slice(0, -1)); clearSelection(); };
  const redo = () => { const next = future[0]; if (!next) return; setPast((items) => [...items, cloneMap(data)]); setData(next); setFuture((items) => items.slice(1)); clearSelection(); };

  const chooseStop = (id: string) => {
    if (tool === "route") {
      if (!routeStart) { setRouteStart(id); return; }
      if (routeStart === id) { setRouteStart(null); return; }
      change((draft) => { draft.routes.push({ id: `r-${Date.now()}`, a: routeStart, b: id, length: 2, type: routeType, color: routeColor }); return draft; });
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
      change((draft) => { draft.stops.push({ id: `s-${Date.now()}`, name: "New stop", type: stopType, ...point }); return draft; });
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
    clearSelection();
  };
  const onCanvasMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = canvasPoint(event.currentTarget, event.clientX, event.clientY, format.height);
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
  const stopDragging = () => { dragStopRef.current = null; dragWaypointRef.current = null; dragBackgroundPointRef.current = null; dragBackgroundLabelRef.current = null; };
  const deleteSelected = () => {
    change((draft) => {
      if (selectedBackground) draft.background = draft.background.filter((shape) => shape.id !== selectedBackground);
      if (selectedRoute) draft.routes = draft.routes.filter((route) => route.id !== selectedRoute);
      if (selectedStop) { draft.stops = draft.stops.filter((stop) => stop.id !== selectedStop); draft.routes = draft.routes.filter((route) => route.a !== selectedStop && route.b !== selectedStop); }
      return draft;
    });
    clearSelection(); setDanger(null);
  };
  const exportMap = () => { const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${data.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "map"}.json`; link.click(); URL.revokeObjectURL(url); };
  const importMap = (file?: File) => { if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const incoming = normalizeMap(JSON.parse(String(reader.result))); change(() => incoming); clearSelection(); } catch { window.alert("The file could not be read as a map project."); } }; reader.readAsText(file); };
  const changeFormat = (nextFormat: MapFormat) => {
    if (nextFormat === data.format) return;
    change((draft) => {
      const fromHeight = mapFormats[draft.format].height;
      const toHeight = mapFormats[nextFormat].height;
      const scalePoint = (point: Point): Point => ({ x: point.x, y: point.y * toHeight / fromHeight });
      draft.stops = draft.stops.map((stop) => ({ ...stop, ...scalePoint(stop) }));
      draft.routes = draft.routes.map((route) => ({ ...route, points: route.points?.map(scalePoint) }));
      draft.background = draft.background.map((shape) => ({ ...shape, points: shape.points.map(scalePoint), labelPoint: shape.labelPoint ? scalePoint(shape.labelPoint) : undefined }));
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
      <div className="header-actions"><Button variant="ghost" size="icon" aria-label="Undo" disabled={!past.length} onClick={undo}><Undo2 /></Button><Button variant="ghost" size="icon" aria-label="Redo" disabled={!future.length} onClick={redo}><Redo2 /></Button><Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload />Import</Button><input ref={fileRef} hidden type="file" accept="application/json" onChange={(event) => importMap(event.target.files?.[0])} /><Button variant="outline" size="sm" onClick={() => window.print()}><Printer />Print {format.shortLabel}</Button><Button size="sm" onClick={exportMap}><Download />Export</Button></div>
    </header>
    <div className="workspace">
      <aside className="tools-panel panel">
        <div className="panel-heading"><span>Tools</span><small>Work directly on the map</small></div>
        <div className="tool-list">
          <ToolButton active={tool === "select"} icon={<MousePointer2 />} title="Select & move" note="Edit stops, routes and shapes" onClick={() => { setTool("select"); setRouteStart(null); setDraftPoints([]); }} />
          <ToolButton active={tool === "stop"} icon={<MapPinPlus />} title="Add stop" note="Click the map to place it" onClick={() => { setTool("stop"); setRouteStart(null); setDraftPoints([]); }} />
          {tool === "stop" && <div className="tool-options"><Label>Stop type</Label><NativeSelect value={stopType} onChange={(event) => setStopType(event.target.value as StopType)}>{Object.entries(stopTypeMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div>}
          <ToolButton active={tool === "route"} icon={<Link2 />} title="Draw route" note={routeStart ? `Start: ${stopById(data, routeStart)?.name} · choose end` : "Click two stops"} onClick={() => { setTool("route"); setRouteStart(null); setDraftPoints([]); }} />
          {tool === "route" && <div className="tool-options grid-two"><div><Label>Route type</Label><NativeSelect value={routeType} onChange={(event) => setRouteType(event.target.value as RouteType)}>{Object.entries(routeTypeMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div><div><Label>Colour</Label><NativeSelect value={routeColor} onChange={(event) => setRouteColor(event.target.value)}>{Object.keys(routeColors).map((key) => <NativeSelectOption key={key} value={key}>{colorLabels[key]}</NativeSelectOption>)}</NativeSelect></div></div>}
          <ToolButton active={tool === "background"} icon={<Layers3 />} title="Draw background" note="Areas, boundaries and labels" onClick={() => { setTool("background"); setRouteStart(null); clearSelection(); }} />
          {tool === "background" && <div className="tool-options background-tools"><Label>Object</Label><NativeSelect value={backgroundType} onChange={(event) => { setBackgroundType(event.target.value as BackgroundType); setDraftPoints([]); }}><NativeSelectOption value="area">Area</NativeSelectOption><NativeSelectOption value="line">Line</NativeSelectOption><NativeSelectOption value="label">Label</NativeSelectOption></NativeSelect>{backgroundType !== "label" && <><div className="colour-row"><label>Fill <input type="color" value={backgroundFill} onChange={(event) => setBackgroundFill(event.target.value)} disabled={backgroundType === "line"} /></label><label>Outline <input type="color" value={backgroundStroke} onChange={(event) => setBackgroundStroke(event.target.value)} /></label></div><p className="helper">Click to add points. Finish when the shape is ready.</p><div className="draft-actions"><Button size="sm" disabled={draftPoints.length < (backgroundType === "area" ? 3 : 2)} onClick={finishBackground}>Finish shape</Button><Button size="sm" variant="ghost" disabled={!draftPoints.length} onClick={() => setDraftPoints([])}>Cancel</Button></div></>}</div>}
        </div>
        <div className="format-control"><Label htmlFor="map-format">Board format</Label><NativeSelect id="map-format" value={data.format} onChange={(event) => changeFormat(event.target.value as MapFormat)}>{Object.entries(mapFormats).map(([key, item]) => <NativeSelectOption key={key} value={key}>{item.label}</NativeSelectOption>)}</NativeSelect><dl className="format-measurements"><div><dt>Finished size</dt><dd>{format.widthMm.toLocaleString("en-GB")} × {format.heightMm.toLocaleString("en-GB")} mm</dd></div>{format.columns > 1 && <div><dt>Panel size</dt><dd>about {panelWidthMm} × {panelHeightMm} mm</dd></div>}</dl><p>{format.note}{format.custom ? ". This is not a verified commercial Ticket to Ride size" : ""}. Changing format keeps objects in the same relative positions.</p></div>
        <div className={cn("crossing-card", crossings.length && "has-warning")}><div className="crossing-icon">{crossings.length ? <AlertTriangle /> : <Check />}</div><div><strong>{crossings.length ? `${crossings.length} crossing${crossings.length === 1 ? "" : "s"}` : "No crossings"}</strong><p>{crossings.length ? "between buildable routes" : "The route network is geometrically clean"}</p></div></div>
        <div className="legend"><p className="eyebrow">Stop types</p>{Object.entries(stopTypeMeta).map(([key, meta]) => <div key={key}><i style={{ background: meta.fill, borderColor: meta.stroke }} />{meta.label}</div>)}</div>
        <Button variant="ghost" className="reset-button" onClick={() => setDanger("reset")}><RotateCcw />Clear map</Button>
      </aside>
      <section className="map-wrap">
        <div className="map-status"><Badge variant="secondary">{format.shortLabel}</Badge><Badge variant="secondary">{format.widthMm.toLocaleString("en-GB")} × {format.heightMm.toLocaleString("en-GB")} mm</Badge><Badge variant="secondary">{data.stops.length} stops</Badge><Badge variant="secondary">{data.routes.length} routes</Badge><Badge variant="secondary">{data.background.length} background objects</Badge><span>Everything is stored in the exported map file</span></div>
        <svg className={cn("map-canvas", `tool-${tool}`)} style={{ aspectRatio: `${W} / ${format.height}` }} viewBox={`0 0 ${W} ${format.height}`} onPointerDown={onCanvasDown} onPointerMove={onCanvasMove} onPointerUp={stopDragging} onPointerLeave={stopDragging}>
          <MapArtwork data={data} selectedRoute={selectedRoute} selectedStop={selectedStop} selectedBackground={selectedBackground} routeStart={routeStart} draft={{ type: backgroundType, points: draftPoints, fill: backgroundFill, stroke: backgroundStroke }} onRoute={(id) => { setSelectedRoute(id); setSelectedStop(null); setSelectedBackground(null); setTool("select"); }} onStop={(id) => { chooseStop(id); if (tool === "select") dragStopRef.current = id; }} onWaypoint={(routeId, index) => { dragWaypointRef.current = { routeId, index }; }} onBackground={(id) => { setSelectedBackground(id); setSelectedRoute(null); setSelectedStop(null); setTool("select"); }} onBackgroundPoint={(shapeId, index) => { dragBackgroundPointRef.current = { shapeId, index }; }} onBackgroundLabel={(shapeId) => { dragBackgroundLabelRef.current = shapeId; }} />
        </svg>
      </section>
      <aside className="properties panel">
        <div className="panel-heading"><span>Properties</span><small>{selectedB ? "Background object selected" : selectedR ? "Route selected" : selectedS ? "Stop selected" : "Select an object on the map"}</small></div>
        {!selectedB && !selectedR && !selectedS && <div className="empty-state"><CircleDot /><p>Edit names, types, colours, geometry and route length here.</p></div>}
        {selectedB && <BackgroundProperties shape={selectedB} change={change} onDelete={() => setDanger("delete")} />}
        {selectedS && <div className="property-form"><div><Label htmlFor="stop-name">Name</Label><Input id="stop-name" value={selectedS.name} onChange={(event) => change((draft) => { const stop = stopById(draft, selectedS.id); if (stop) stop.name = event.target.value; return draft; })} /></div><div><Label>Stop type</Label><NativeSelect value={selectedS.type} onChange={(event) => change((draft) => { const stop = stopById(draft, selectedS.id); if (stop) stop.type = event.target.value as StopType; return draft; })}>{Object.entries(stopTypeMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div><Button variant="destructive" onClick={() => setDanger("delete")}><Trash2 />Delete stop</Button><p className="delete-note">Connected routes will also be deleted.</p></div>}
        {selectedR && <div className="property-form"><div className="route-names"><span>{stopById(data, selectedR.a)?.name}</span><ChevronDown /><span>{stopById(data, selectedR.b)?.name}</span></div><div><Label>Route type</Label><NativeSelect value={selectedR.type} onChange={(event) => change((draft) => { const route = draft.routes.find((item) => item.id === selectedR.id); if (route) route.type = event.target.value as RouteType; return draft; })}>{Object.entries(routeTypeMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div>{selectedR.type !== "rail" && selectedR.type !== "trail" && <><div><Label>Colour</Label><NativeSelect value={selectedR.color} onChange={(event) => change((draft) => { const route = draft.routes.find((item) => item.id === selectedR.id); if (route) route.color = event.target.value; return draft; })}>{Object.keys(routeColors).map((key) => <NativeSelectOption key={key} value={key}>{colorLabels[key]}</NativeSelectOption>)}</NativeSelect></div><div><Label>Vehicle spaces</Label><div className="length-stepper"><Button variant="outline" size="icon" aria-label="Decrease" disabled={selectedR.length <= 1} onClick={() => change((draft) => { const route = draft.routes.find((item) => item.id === selectedR.id); if (route) route.length = Math.max(1, route.length - 1); return draft; })}><Minus /></Button><strong>{selectedR.length}</strong><Button variant="outline" size="icon" aria-label="Increase" disabled={selectedR.length >= 8} onClick={() => change((draft) => { const route = draft.routes.find((item) => item.id === selectedR.id); if (route) route.length = Math.min(8, route.length + 1); return draft; })}><Plus /></Button></div><p className="helper">The change is shown directly on the route.</p></div></>}<Button variant="destructive" onClick={() => setDanger("delete")}><Trash2 />Delete route</Button></div>}
      </aside>
    </div>
    <AlertDialog open={danger !== null} onOpenChange={(open) => !open && setDanger(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{danger === "reset" ? "Clear the entire map?" : "Delete the selected object?"}</AlertDialogTitle><AlertDialogDescription>{danger === "reset" ? "All locally stored background objects, stops and routes will be removed. Export the map first if you want to keep it." : selectedStop ? "The stop and all connected routes will be deleted." : "The selected object will be deleted."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (danger === "reset") { change(() => cloneMap(emptyMap)); clearSelection(); setDanger(null); } else deleteSelected(); }}>Continue</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <PrintPages data={data} />
  </main>;
}

function PrintPages({ data }: { data: MapData }) {
  const format = mapFormats[data.format];
  const panels = Array.from({ length: format.columns * format.rows }, (_, index) => ({ column: index % format.columns, row: Math.floor(index / format.columns) }));
  return <div className={cn("print-pages", `format-${data.format}`)} aria-hidden="true">{panels.map(({ column, row }, index) => {
    const panelWidth = W / format.columns;
    const panelHeight = format.height / format.rows;
    const printedPanelScale = Math.round(190 / (format.widthMm / format.columns) * 100);
    const panelName = format.columns === 1 ? `${format.shortLabel} · ${format.widthMm} × ${format.heightMm} mm` : `Panel ${index + 1} of ${panels.length} · row ${row + 1}, column ${column + 1} · A4 proof at about ${printedPanelScale}%`;
    return <section className="print-page" key={`${column}-${row}`}><div className="print-caption"><strong>{data.name}</strong><span>{panelName}</span></div><svg viewBox={`${column * panelWidth} ${row * panelHeight} ${panelWidth} ${panelHeight}`}><MapArtwork data={data} print /></svg></section>;
  })}</div>;
}

function BackgroundProperties({ shape, change, onDelete }: { shape: BackgroundShape; change: (fn: (draft: MapData) => MapData) => void; onDelete: () => void }) {
  const update = (values: Partial<BackgroundShape>) => change((draft) => { const item = draft.background.find((entry) => entry.id === shape.id); if (item) Object.assign(item, values); return draft; });
  return <div className="property-form"><div><Label htmlFor="background-label">Label</Label><Input id="background-label" value={shape.label} onChange={(event) => update({ label: event.target.value })} /></div>{shape.type === "area" && <div><Label>Fill colour</Label><input className="colour-input" type="color" value={shape.fill} onChange={(event) => update({ fill: event.target.value })} /></div>}<div><Label>{shape.type === "label" ? "Text colour" : "Line colour"}</Label><input className="colour-input" type="color" value={shape.stroke} onChange={(event) => update({ stroke: event.target.value })} /></div><div><Label>Opacity · {Math.round(shape.opacity * 100)}%</Label><input className="range-input" type="range" min="0.1" max="1" step="0.05" value={shape.opacity} onChange={(event) => update({ opacity: Number(event.target.value) })} /></div>{shape.type !== "label" && <><div><Label>Line width</Label><Input type="number" min="1" max="16" value={shape.strokeWidth} onChange={(event) => update({ strokeWidth: Math.max(1, Math.min(16, Number(event.target.value))) })} /></div><Button variant="outline" onClick={() => update({ labelPoint: undefined })}>Reset label position</Button><p className="helper label-helper">Drag the green handle to position the label freely.</p></>}<Button variant="outline" onClick={() => update({ locked: !shape.locked })}>{shape.locked ? <Unlock /> : <Lock />}{shape.locked ? "Unlock geometry" : "Lock geometry"}</Button><Button variant="destructive" onClick={onDelete}><Trash2 />Delete background object</Button></div>;
}

function MapArtwork({ data, selectedRoute, selectedStop, selectedBackground, routeStart, draft, onRoute, onStop, onWaypoint, onBackground, onBackgroundPoint, onBackgroundLabel, print = false }: { data: MapData; selectedRoute?: string | null; selectedStop?: string | null; selectedBackground?: string | null; routeStart?: string | null; draft?: { type: BackgroundType; points: Point[]; fill: string; stroke: string }; onRoute?: (id: string) => void; onStop?: (id: string) => void; onWaypoint?: (routeId: string, index: number) => void; onBackground?: (id: string) => void; onBackgroundPoint?: (shapeId: string, index: number) => void; onBackgroundLabel?: (shapeId: string) => void; print?: boolean }) {
  const format = mapFormats[data.format];
  return <>
    <defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0L0 0 0 24" fill="none" stroke="#6b675f" strokeOpacity=".11" /></pattern><filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity=".18" /></filter></defs>
    <rect className="map-bg" width={W} height={format.height} fill="#f7f1e5" /><rect className="map-bg" width={W} height={format.height} fill="url(#grid)" />
    {data.background.map((shape) => <BackgroundObject key={shape.id} shape={shape} height={format.height} selected={shape.id === selectedBackground} print={print} onSelect={onBackground} onPoint={onBackgroundPoint} onLabel={onBackgroundLabel} />)}
    {!print && draft && draft.points.length > 0 && <g className="background-draft">{draft.type === "area" ? <polygon points={draft.points.map((p) => `${p.x},${p.y}`).join(" ")} fill={draft.fill} fillOpacity=".35" stroke={draft.stroke} /> : <polyline points={draft.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={draft.stroke} />}{draft.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="6" />)}</g>}
    {data.routes.map((route) => { const meta = routeTypeMeta[route.type]; const points = parallelPoints(data, route); const path = pathFromPoints(points); const infrastructure = route.type === "rail" || route.type === "trail"; const routeColor = route.type === "city" || route.type === "region" ? (route.color === "neutral" ? "#736d64" : routeColors[route.color]) : meta.stroke; return <g key={route.id} className={cn("route-group", route.id === selectedRoute && "selected")} onPointerDown={onRoute ? (event) => { event.stopPropagation(); onRoute(route.id); } : undefined}><path d={path} className="route-hit" /><path d={path} className={cn("route-guide", infrastructure && "infrastructure")} fill="none" stroke={routeColor} strokeWidth={infrastructure ? (route.type === "rail" ? 4 : 5) : 3} strokeDasharray={meta.dash} strokeLinecap="round" strokeLinejoin="round" />{!infrastructure && Array.from({ length: route.length }, (_, index) => { const position = pointAlong(points, (index + .5) / route.length); return <g key={index} className="wagon-slot" transform={`translate(${position.x},${position.y}) rotate(${position.angle})`} filter={print ? undefined : "url(#shadow)"}><rect className="wagon-slot-outline" x={-13} y={-7} width="26" height="14" rx="4" /><rect x={-12} y={-6} width="24" height="12" rx="3" fill="#fffaf0" stroke={routeColor} strokeWidth="3" /></g>; })}</g>; })}
    {data.stops.map((stop) => { const meta = stopTypeMeta[stop.type]; const active = stop.id === selectedStop || stop.id === routeStart; return <g key={stop.id} className={cn("stop", active && "active")} transform={`translate(${stop.x},${stop.y})`} onPointerDown={onStop ? (event) => { event.stopPropagation(); onStop(stop.id); } : undefined}><circle r={active ? 12 : 9} fill={meta.fill} stroke={meta.stroke} strokeWidth={active ? 4 : 3} />{stop.type === "rail" && <rect x={-4} y={-4} width="8" height="8" fill={meta.stroke} />}<text x={stop.x > 900 ? -14 : 14} y={stop.y > format.height - 100 ? -13 : -12} textAnchor={stop.x > 900 ? "end" : "start"}>{stop.name}</text></g>; })}
    {!print && selectedRoute && data.routes.find((route) => route.id === selectedRoute)?.points?.map((point, index) => <g key={index} className="waypoint-handle" transform={`translate(${point.x},${point.y})`} onPointerDown={(event) => { event.stopPropagation(); onWaypoint?.(selectedRoute, index); }}><circle className="waypoint-hit" r="19" /><rect x="-8" y="-8" width="16" height="16" rx="3" transform="rotate(45)" /><circle r="3" /></g>)}
    {format.columns > 1 && <g className="fold-guides">{Array.from({ length: format.columns - 1 }, (_, index) => <line key={`v-${index}`} x1={W * (index + 1) / format.columns} y1="0" x2={W * (index + 1) / format.columns} y2={format.height} />)}{Array.from({ length: format.rows - 1 }, (_, index) => <line key={`h-${index}`} x1="0" y1={format.height * (index + 1) / format.rows} x2={W} y2={format.height * (index + 1) / format.rows} />)}</g>}
  </>;
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

function ToolButton({ active, icon, title, note, onClick }: { active: boolean; icon: React.ReactNode; title: string; note: string; onClick: () => void }) { return <button className={cn("tool-button", active && "active")} onClick={onClick}><span>{icon}</span><div><strong>{title}</strong><small>{note}</small></div></button>; }
