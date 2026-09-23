"use client";

// Everything that draws the map itself: the SVG layer stack, the route and stop renderers, and the
// editing handles. It renders whatever MapData it is handed and reports interactions upwards.

import { cn } from "@/lib/utils";
import { defaultLabelAngle, type BackgroundImage, type BackgroundShape, type BackgroundType, mapFormats, type MapData, type NoteBox, type Point, realWagon, routeColors, type Stop, stopSizeMeta, stopTypeMeta, W } from "./map-data";
import { automaticLabelPoint, canvasPoint, parallelOffset, stopById, curvedPath, curvedSamples, parallelPoints, pathFromPoints, pointAlong, pointsFor, polylineLength } from "./map-geometry";

// Editing handles sit this far to the side of the line, with this grab radius. The gap between
// them (offset - hit) must stay wider than half a wagon space, or a handle swallows the click
// that toggles a locomotive on the space beneath it.
const HANDLE_OFFSET = 22, HANDLE_HIT = 12;

export type Tool = "select" | "stop" | "route" | "background" | "note" | "measure";

export function MapArtwork({ data, tool = "select", trueScale = false, scaleWidthMm = 790, selectedRoute, selectedStop, selectedBackground, imageSelected, selectedNote, routeStart, draft, onRoute, onRouteSlot, onRouteBendInsert, onRouteBendRemove, onStop, onWaypoint, onBackground, onBackgroundPoint, onBackgroundLabel, onImageSelect, onImageMove, onImageScale, onImageRotate, onNoteSelect, onNoteMove, onNoteResize, print = false }: { data: MapData; tool?: Tool; trueScale?: boolean; scaleWidthMm?: number; selectedRoute?: string | null; selectedStop?: string | null; selectedBackground?: string | null; imageSelected?: boolean; selectedNote?: string | null; routeStart?: string | null; draft?: { type: BackgroundType; points: Point[]; fill: string; stroke: string }; onRoute?: (id: string) => void; onRouteSlot?: (routeId: string, index: number) => void; onRouteBendInsert?: (routeId: string, index: number, point: Point) => void; onRouteBendRemove?: (routeId: string, index: number) => void; onStop?: (id: string) => void; onWaypoint?: (routeId: string, index: number, grabOffset: Point) => void; onBackground?: (id: string) => void; onBackgroundPoint?: (shapeId: string, index: number) => void; onBackgroundLabel?: (shapeId: string) => void; onImageSelect?: () => void; onImageMove?: (point: Point) => void; onImageScale?: () => void; onImageRotate?: () => void; onNoteSelect?: (id: string) => void; onNoteMove?: (id: string, point: Point) => void; onNoteResize?: (id: string) => void; print?: boolean }) {
  const format = mapFormats[data.format];
  return <>
    <defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0L0 0 0 24" fill="none" stroke="#6b675f" strokeOpacity=".11" /></pattern><filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity=".18" /></filter></defs>
    <rect className="map-bg" width={W} height={format.height} fill="#f7f1e5" /><rect className="map-bg" width={W} height={format.height} fill="url(#grid)" />
    {data.backgroundImage && <BackgroundImageObject image={data.backgroundImage} height={format.height} selected={Boolean(imageSelected)} print={print} tool={tool} onSelect={onImageSelect} onMove={onImageMove} onScale={onImageScale} onRotate={onImageRotate} />}
    {data.background.map((shape) => <BackgroundObject key={shape.id} shape={shape} height={format.height} selected={shape.id === selectedBackground} print={print} tool={tool} onSelect={onBackground} onPoint={onBackgroundPoint} onLabel={onBackgroundLabel} />)}
    {!print && draft && draft.points.length > 0 && <g className="background-draft">{draft.type === "area" ? <polygon points={draft.points.map((p) => `${p.x},${p.y}`).join(" ")} fill={draft.fill} fillOpacity=".35" stroke={draft.stroke} /> : <polyline points={draft.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={draft.stroke} />}{draft.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="6" />)}</g>}
    {data.routes.map((route) => { const typeStyle = data.routeTypeStyles.find((item) => item.id === route.type) ?? { id: route.type, label: route.type, stroke: "#736d64", dash: "", strokeWidth: 3, infrastructure: false }; const style = route.lineStyle ? data.lineStyles.find((item) => item.id === route.lineStyle) : undefined; const geometry = parallelPoints(data, route); const curved = Boolean(route.curved) && geometry.length > 2; const path = curved ? curvedPath(geometry) : pathFromPoints(geometry); const points = curved ? curvedSamples(geometry) : geometry; const infrastructure = typeStyle.infrastructure; const routeColor = infrastructure ? typeStyle.stroke : route.color === "neutral" ? "#736d64" : routeColors[route.color]; const routeSelected = route.id === selectedRoute; const unitMm = scaleWidthMm / W; const pitch = (realWagon.length + realWagon.gap) / unitMm; const slotW = trueScale ? realWagon.length / unitMm : 24; const slotH = trueScale ? realWagon.width / unitMm : 12; const pathLength = polylineLength(points) || 1; const span = route.length * pitch; const tight = trueScale && span > pathLength; const endGap = (stopId: string) => { const stop = stopById(data, stopId); const r = stopSizeMeta[stop?.size ?? "medium"].radius; return Math.min(Math.max(realWagon.endMargin / 2 / unitMm, r + 4), pathLength * .2); }; const gapA = endGap(route.a), gapB = endGap(route.b); const usable = Math.max(1, pathLength - gapA - gapB); return <g key={route.id} className={cn("route-group", routeSelected && "selected", style && "custom-style", tight && "too-tight")} onPointerDown={onRoute ? (event) => { event.stopPropagation(); onRoute(route.id); } : undefined}><path d={path} className="route-hit" /><path d={path} className={cn("route-guide", infrastructure && "infrastructure")} fill="none" stroke={routeColor} strokeWidth={style ? style.strokeWidth : typeStyle.strokeWidth} strokeDasharray={style ? style.dash : typeStyle.dash} strokeLinecap="round" strokeLinejoin="round" />{!infrastructure && Array.from({ length: route.length }, (_, index) => { const fraction = trueScale ? Math.min(1, Math.max(0, ((pathLength - span) / 2 + pitch * (index + .5)) / pathLength)) : (gapA + (index + .5) * usable / route.length) / pathLength; const position = pointAlong(points, fraction); const isLocomotive = route.locomotiveSlots?.includes(index); const interactive = !print && routeSelected; return <g key={index} className={cn("wagon-slot", isLocomotive && "locomotive")} transform={`translate(${position.x},${position.y}) rotate(${position.angle})`} filter={print ? undefined : "url(#shadow)"} onPointerDown={interactive ? (event) => { event.stopPropagation(); onRouteSlot?.(route.id, index); } : undefined}><rect className="wagon-slot-outline" x={-slotW / 2 - 1} y={-slotH / 2 - 1} width={slotW + 2} height={slotH + 2} rx="4" /><rect x={-slotW / 2} y={-slotH / 2} width={slotW} height={slotH} rx="3" fill="#fffaf0" stroke={routeColor} strokeWidth="3" />{isLocomotive && <g className="locomotive-icon" transform={`scale(${slotW / 24})`}><rect x={-8} y={-3.5} width="11" height="7" rx="1.5" /><rect x={2} y={-1.5} width="4.5" height="5" rx="1" /><rect x={-2.5} y={-6.5} width="2.5" height="3.5" /><circle cx={-4.5} cy={4} r="1.6" /><circle cx={1.5} cy={4} r="1.6" /></g>}</g>; })}</g>; })}
    {data.stops.map((stop) => { const meta = stopTypeMeta[stop.type]; const active = stop.id === selectedStop || stop.id === routeStart; const radius = stopSizeMeta[stop.size ?? "medium"].radius; return <g key={stop.id} className={cn("stop", active && "active")} transform={`translate(${stop.x},${stop.y})`} onPointerDown={onStop ? (event) => { event.stopPropagation(); onStop(stop.id); } : undefined}><circle r={active ? radius + 3 : radius} fill={meta.fill} stroke={meta.stroke} strokeWidth={active ? 4 : 3} />{stop.type === "rail" && <rect x={-4} y={-4} width="8" height="8" fill={meta.stroke} />}<StopSymbolGlyph stop={stop} radius={radius} color={meta.stroke} /><StopLabel stop={stop} radius={radius} /></g>; })}
    {data.notes.map((note) => <NoteBoxObject key={note.id} note={note} height={format.height} selected={note.id === selectedNote} print={print} tool={tool} onSelect={onNoteSelect} onMove={onNoteMove} onResize={onNoteResize} />)}
    {!print && selectedRoute && (() => {
      const route = data.routes.find((item) => item.id === selectedRoute);
      if (!route) return null;
      const base = pointsFor(data, route);
      // Handles are measured from the line as drawn, which for a double route is offset sideways.
      const drawnOffset = parallelOffset(data, route);
      return <>
        {base.slice(0, -1).map((from, index) => {
          const to = base[index + 1];
          const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
          const dx = to.x - from.x, dy = to.y - from.y;
          const length = Math.hypot(dx, dy) || 1;
          // Sit the + beside the line, far enough out that its hit area clears the wagon space that
          // shares the same midpoint. Offset minus hit radius has to stay above half a space's height.
          const handle = { x: mid.x - dy / length * (drawnOffset + HANDLE_OFFSET), y: mid.y + dx / length * (drawnOffset + HANDLE_OFFSET) };
          return <g key={`insert-${index}`} className="bend-insert-handle" transform={`translate(${handle.x},${handle.y})`} onPointerDown={(event) => { event.stopPropagation(); onRouteBendInsert?.(route.id, index, mid); }}><circle className="point-hit" r={HANDLE_HIT} /><circle r="8" /><path d="M-4,0 H4 M0,-4 V4" /></g>;
        })}
        {route.points?.map((point, index) => {
          // Offset the grab handle to the other side of the line from the + handles, so neither of
          // them sits on top of a wagon space and swallows the click that toggles a locomotive.
          const before = base[index] ?? point, after = base[index + 2] ?? point;
          const dx = after.x - before.x, dy = after.y - before.y;
          const length = Math.hypot(dx, dy) || 1;
          const handle = { x: point.x - dy / length * (drawnOffset - HANDLE_OFFSET), y: point.y + dx / length * (drawnOffset - HANDLE_OFFSET) };
          return <g key={index} className="waypoint-handle" onPointerDown={(event) => { event.stopPropagation(); onWaypoint?.(selectedRoute, index, { x: handle.x - point.x, y: handle.y - point.y }); }} onDoubleClick={(event) => { event.stopPropagation(); onRouteBendRemove?.(route.id, index); }}>
            <line className="waypoint-leader" x1={point.x} y1={point.y} x2={handle.x} y2={handle.y} />
            <g transform={`translate(${handle.x},${handle.y})`}><circle className="waypoint-hit" r={HANDLE_HIT} /><rect x="-8" y="-8" width="16" height="16" rx="3" transform="rotate(45)" /><circle r="3" /></g>
          </g>;
        })}
      </>;
    })()}
    {format.columns > 1 && <g className="fold-guides">{Array.from({ length: format.columns - 1 }, (_, index) => <line key={`v-${index}`} x1={W * (index + 1) / format.columns} y1="0" x2={W * (index + 1) / format.columns} y2={format.height} />)}{Array.from({ length: format.rows - 1 }, (_, index) => <line key={`h-${index}`} x1="0" y1={format.height * (index + 1) / format.rows} x2={W} y2={format.height * (index + 1) / format.rows} />)}</g>}
  </>;
}

export function BackgroundImageObject({ image, height, selected, print, tool, onSelect, onMove, onScale, onRotate }: { image: BackgroundImage; height: number; selected: boolean; print: boolean; tool: Tool; onSelect?: () => void; onMove?: (point: Point) => void; onScale?: () => void; onRotate?: () => void }) {
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

export function NoteBoxObject({ note, height, selected, print, tool, onSelect, onMove, onResize }: { note: NoteBox; height: number; selected: boolean; print: boolean; tool: Tool; onSelect?: (id: string) => void; onMove?: (id: string, point: Point) => void; onResize?: (id: string) => void }) {
  return <g className={cn("note-box", selected && "selected", note.locked && "locked")} transform={`translate(${note.x},${note.y})`} onPointerDown={!print && tool === "select" ? (event) => { event.stopPropagation(); onSelect?.(note.id); if (!note.locked) { const svg = event.currentTarget.ownerSVGElement; if (svg) onMove?.(note.id, canvasPoint(svg, event.clientX, event.clientY, height)); } } : undefined}>
    <rect className="note-box-bg" width={note.width} height={note.height} rx="8" />
    <foreignObject x="0" y="0" width={note.width} height={note.height}><div {...{ xmlns: "http://www.w3.org/1999/xhtml" }} className="note-box-text">{note.text}</div></foreignObject>
    {!print && selected && !note.locked && <g className="note-resize-handle" transform={`translate(${note.width},${note.height})`} onPointerDown={(event) => { event.stopPropagation(); onResize?.(note.id); }}><circle className="point-hit" r="18" /><rect x="-7" y="-7" width="14" height="14" rx="2" /></g>}
  </g>;
}

export function BackgroundObject({ shape, height, selected, print, tool, onSelect, onPoint, onLabel }: { shape: BackgroundShape; height: number; selected: boolean; print: boolean; tool: Tool; onSelect?: (id: string) => void; onPoint?: (id: string, index: number) => void; onLabel?: (id: string) => void }) {
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

export function StopSymbolGlyph({ stop, radius, color }: { stop: Stop; radius: number; color: string }) {
  const symbol = stop.symbol ?? "none";
  if (symbol === "dot") return <circle className="stop-symbol" r={radius * .38} fill={color} />;
  if (symbol === "dash") return <rect className="stop-symbol" x={-radius * .62} y={-1.4} width={radius * 1.24} height="2.8" rx="1.4" fill={color} />;
  if (symbol === "cross") return <g className="stop-symbol" stroke={color} strokeWidth="2.2" strokeLinecap="round"><line x1={-radius * .55} y1={-radius * .55} x2={radius * .55} y2={radius * .55} /><line x1={-radius * .55} y1={radius * .55} x2={radius * .55} y2={-radius * .55} /></g>;
  if (symbol === "letter") return <text className="stop-symbol stop-letter" textAnchor="middle" dominantBaseline="central" fontSize={radius * 1.15} fill={color}>{(stop.letter || "A").slice(0, 2).toUpperCase()}</text>;
  return null;
}


// The name hangs off the stop at a bearing the user can turn, so it can be moved clear of a route
// without detaching it from the stop it belongs to.
export function StopLabel({ stop, radius }: { stop: Stop; radius: number }) {
  const angle = (stop.labelAngle ?? defaultLabelAngle(stop)) * Math.PI / 180;
  const distance = radius + 9;
  const dx = Math.cos(angle) * distance, dy = Math.sin(angle) * distance;
  const anchor = dx < -1 ? "end" : dx > 1 ? "start" : "middle";
  const baseline = dy < -3 ? "auto" : dy > 3 ? "hanging" : "middle";
  return <text x={dx} y={dy} textAnchor={anchor} dominantBaseline={baseline}>{stop.name}</text>;
}
