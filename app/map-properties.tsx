"use client";

// The right-hand Properties panel: one editor component per kind of selected object, plus the
// route-type and line-style pickers they share.
import { ChevronDown, Copy, Crosshair, Lock, Pencil, Maximize2, Minus, Plus, TrainFront, Trash2, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { type StopTypeStyle, colorLabels, type ImageCrop, type MapData, type NoteBox, type RouteTypeStyle, type BackgroundImage, type BackgroundShape, type Route, routeColors, type Stop, stopSizeMeta, stopSymbolMeta, type StopSize, type StopSymbol, W } from "./map-data";
import { isCurved, samePair, stopById } from "./map-geometry";
import { type StyleTarget } from "./map-styles";
import { labelAngleOf, type StopCoverage, ticketBands, type TicketBand } from "./map-analysis";
import { cn } from "@/lib/utils";

// One ticket as the stop panel lists it: the far end and the points. Decks are kept apart, so a
// ticket never has to say which one it belongs to.
export type StopTicket = { id: string; other: string; points: number };
export type StopTicketDeck = { id: string; label: string; tickets: StopTicket[] };

export function StopProperties({ stop, change, onDelete, labelState, mapEndGapMm, allLocked, onLockAll, stopTypeStyles, onEditStyles, tickets, onOpenTicket }: { stop: Stop; stopTypeStyles: StopTypeStyle[]; onEditStyles: (target: StyleTarget) => void; tickets: StopTicketDeck[]; onOpenTicket: (ticketId: string) => void; allLocked: boolean; onLockAll: (locked: boolean) => void; change: (fn: (draft: MapData) => MapData) => void; onDelete: () => void; mapEndGapMm: number; labelState: { covers: boolean; clear: number[]; best: number } }) {
  const update = (values: Partial<Stop>) => change((draft) => { const item = stopById(draft, stop.id); if (item) Object.assign(item, values); return draft; });
  const symbol = stop.symbol ?? "none";
  return <div className="property-form">
    <div><Label htmlFor="stop-name">Name</Label><Input id="stop-name" value={stop.name} onChange={(event) => update({ name: event.target.value })} /></div>
    <div className="grid-two">
      <div><Label>Stop size</Label><NativeSelect value={stop.size ?? "medium"} onChange={(event) => update({ size: event.target.value as StopSize })}>{Object.entries(stopSizeMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div>
    </div>
    <div className="grid-two">
      <div><Label>Symbol</Label><NativeSelect value={symbol} onChange={(event) => update({ symbol: event.target.value as StopSymbol, letter: event.target.value === "letter" ? (stop.letter || "A") : stop.letter })}>{Object.entries(stopSymbolMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div>
      {symbol === "letter" && <div><Label>Letter</Label><Input maxLength={2} value={stop.letter ?? ""} onChange={(event) => update({ letter: event.target.value })} /></div>}
    </div>
    <StylePicker label="Stop type" value={stop.type} styles={stopTypeStyles} placeholder="" onChange={(id) => id && update({ type: id })} onEdit={() => onEditStyles({ kind: "stop", id: stop.type })} />
    <p className="helper">Mark a stop with a symbol or short code for rules of your own, independent of its type.</p>
    <div className="label-angle">
      <Label htmlFor="stop-end-gap">Space before the first wagon · {stop.endGapMm ?? mapEndGapMm} mm{stop.endGapMm === undefined ? " (map default)" : ""}</Label>
      <input id="stop-end-gap" className="range-input" type="range" min="0" max="30" step="1" value={stop.endGapMm ?? mapEndGapMm} onChange={(event) => update({ endGapMm: Number(event.target.value) })} />
      <p className="helper">Room left beyond this stop&apos;s circle before the first wagon of every route into it. Set it per stop where one end of a line needs more air than the other.</p>
      {stop.endGapMm !== undefined && <Button size="sm" variant="ghost" onClick={() => update({ endGapMm: undefined })}>Use the map default ({mapEndGapMm} mm)</Button>}
      <Button size="sm" variant="ghost" onClick={() => onEditStyles({ kind: "map" })}><Pencil />Change the map default</Button>
    </div>
    {stopTypeStyles.find((style) => style.id === stop.type)?.junction
      ? <p className="helper">This is a junction: it joins routes and no ticket ends here, so its name is not drawn on the map or in print. The name is kept here so you can tell junctions apart, and shows when you point at the stop.</p>
      : <div className="label-angle">
      <Label>Name position · {Math.round(labelAngleOf(stop))}°</Label>
      <input className="range-input" type="range" min="0" max="359" step="1" value={Math.round(labelAngleOf(stop))} onChange={(event) => update({ labelAngle: Number(event.target.value) })} />
      <p className={cn("helper", labelState.covers && "helper-warning")}>
        {labelState.covers
          ? labelState.clear.length
            ? `This name sits on a route. ${labelState.clear.length} of 24 positions around the stop are clear.`
            : "This name sits on a route, and so would every other position around this stop — it is hemmed in. Move the stop, bend the route away, or accept the overlap."
          : "Turn the name around the stop to keep it clear of the routes. It stays attached to the stop wherever you move it."}
      </p>
      <div className="label-angle-actions">
        {labelState.covers && <Button size="sm" variant="outline" onClick={() => update({ labelAngle: labelState.best })}>{labelState.clear.length ? "Move the name clear" : "Use the least covered position"}</Button>}
        {stop.labelAngle !== undefined && <Button size="sm" variant="ghost" onClick={() => update({ labelAngle: undefined })}>Reset</Button>}
      </div>
    </div>}
    <Button variant="outline" onClick={() => update({ locked: !stop.locked || undefined })}>{stop.locked ? <Unlock /> : <Lock />}{stop.locked ? "Unlock position" : "Lock position"}</Button>
    <Button variant="outline" size="sm" onClick={() => onLockAll(!allLocked)}>{allLocked ? <Unlock /> : <Lock />}{allLocked ? "Unlock every stop" : "Lock every stop"}</Button>
    <p className="helper">A locked stop can still be selected and edited, it just cannot be dragged by accident. Hold Shift while dragging to move it anyway, without unlocking it first.</p>
    <div className="stop-tickets">
      <Label>Tickets naming this stop</Label>
      {tickets.length ? tickets.map((deck) => <div className="stop-ticket-deck" key={deck.id}>
        <p className="stop-ticket-deck-name">{deck.label}</p>
        {deck.tickets.length ? <ul>{deck.tickets.map((ticket) => <li key={ticket.id}><button type="button" className="stop-ticket-link" onClick={() => onOpenTicket(ticket.id)}>{stop.name} → {ticket.other}<span>{ticket.points} pt</span></button></li>)}</ul>
          : <p className="helper">Nothing in this deck.</p>}
      </div>) : <p className="helper">No ticket sends a player here yet.</p>}
    </div>
    <Button variant="destructive" onClick={onDelete}><Trash2 />Delete stop</Button>
    <p className="delete-note">Connected routes will also be deleted.</p>
  </div>;
}



export function RouteProperties({ route, stops, routes, routeTypeStyles, change, onDelete, onAddParallel, onEditStyles, onStraighten, onSetCurved, linkParallel, onLinkParallel }: { route: Route; onStraighten: (routeId: string) => void; onSetCurved: (routeId: string, curved: boolean) => void; linkParallel: boolean; onLinkParallel: (value: boolean) => void; stops: Stop[]; routes: Route[]; routeTypeStyles: RouteTypeStyle[]; change: (fn: (draft: MapData) => MapData) => void; onDelete: () => void; onAddParallel: (routeId: string) => void; onEditStyles: (target: StyleTarget) => void }) {
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
    <StylePicker label="Route type" value={route.type} styles={routeTypeStyles} placeholder="" onChange={(id) => id && update({ type: id })} onEdit={() => onEditStyles({ kind: "route", id: route.type })} />
    {!infrastructure && <>
      <div><Label>Colour</Label><NativeSelect value={route.color} onChange={(event) => update({ color: event.target.value })}>{Object.keys(routeColors).map((key) => <NativeSelectOption key={key} value={key}>{colorLabels[key]}</NativeSelectOption>)}</NativeSelect></div>
      <div><Label>Vehicle spaces</Label><div className="length-stepper"><Button variant="outline" size="icon" aria-label="Decrease" disabled={route.length <= 1} onClick={() => update({ length: Math.max(1, route.length - 1), locomotiveSlots: route.locomotiveSlots?.filter((index) => index < route.length - 1) })}><Minus /></Button><strong>{route.length}</strong><Button variant="outline" size="icon" aria-label="Increase" disabled={route.length >= 8} onClick={() => update({ length: Math.min(8, route.length + 1) })}><Plus /></Button></div><p className="helper">The change is shown directly on the route.</p></div>
      <div><Label>Locomotives required · {route.locomotiveSlots?.length ?? 0} of {route.length}</Label><p className="helper">Click a wagon slot directly on the selected route to toggle it.</p>{Boolean(route.locomotiveSlots?.length) && <Button size="sm" variant="ghost" onClick={() => update({ locomotiveSlots: [] })}><TrainFront />Clear locomotives</Button>}</div>
    </>}
    <div className="bend-controls">
      <Label>Shape · {route.points?.length ?? 0} bend point{(route.points?.length ?? 0) === 1 ? "" : "s"}</Label>
      <p className="helper">Click a + beside the selected route to add a bend between any two wagon spaces, drag a bend to move it, double-click it to remove it.</p>
      <label className="checkbox-row"><input type="checkbox" checked={isCurved(route)} onChange={(event) => onSetCurved(route.id, event.target.checked)} />Draw as a smooth curve</label>
      {parallelCount > 1 && <label className="checkbox-row"><input type="checkbox" checked={linkParallel} onChange={(event) => onLinkParallel(event.target.checked)} />Shape the parallel line{parallelCount > 2 ? "s" : ""} together with this one</label>}
      {Boolean(route.points?.length) && <Button size="sm" variant="ghost" onClick={() => onStraighten(route.id)}>Straighten route</Button>}
    </div>
    <Button variant="destructive" onClick={onDelete}><Trash2 />Delete route</Button>
  </div>;
}

export function NoteProperties({ note, change, onDelete }: { note: NoteBox; change: (fn: (draft: MapData) => MapData) => void; onDelete: () => void }) {
  const update = (values: Partial<NoteBox>) => change((draft) => { const item = draft.notes.find((entry) => entry.id === note.id); if (item) Object.assign(item, values); return draft; });
  return <div className="property-form">
    <div><Label htmlFor="note-text">Evaluation note</Label><Textarea id="note-text" rows={5} value={note.text} onChange={(event) => update({ text: event.target.value })} /></div>
    <p className="helper">Shown on screen and in print, for reviewers evaluating the map. Drag the corner handle on the map to resize it.</p>
    <Button variant="outline" onClick={() => update({ collapsed: !note.collapsed || undefined })}>{note.collapsed ? "Expand note" : "Collapse note"}</Button>
    <Button variant="outline" onClick={() => update({ locked: !note.locked })}>{note.locked ? <Unlock /> : <Lock />}{note.locked ? "Unlock note" : "Lock note"}</Button>
    <Button variant="destructive" onClick={onDelete}><Trash2 />Delete note</Button>
  </div>;
}

export function BackgroundProperties({ shape, change, onDelete }: { shape: BackgroundShape; change: (fn: (draft: MapData) => MapData) => void; onDelete: () => void }) {
  const update = (values: Partial<BackgroundShape>) => change((draft) => { const item = draft.background.find((entry) => entry.id === shape.id); if (item) Object.assign(item, values); return draft; });
  return <div className="property-form"><div><Label htmlFor="background-label">Label</Label><Input id="background-label" value={shape.label} onChange={(event) => update({ label: event.target.value })} /></div>{shape.type === "area" && <div><Label>Fill colour</Label><input className="colour-input" type="color" value={shape.fill} onChange={(event) => update({ fill: event.target.value })} /></div>}<div><Label>{shape.type === "label" ? "Text colour" : "Line colour"}</Label><input className="colour-input" type="color" value={shape.stroke} onChange={(event) => update({ stroke: event.target.value })} /></div><div><Label>Opacity · {Math.round(shape.opacity * 100)}%</Label><input className="range-input" type="range" min="0.1" max="1" step="0.05" value={shape.opacity} onChange={(event) => update({ opacity: Number(event.target.value) })} /></div>{shape.type !== "label" && <><div><Label>Line width</Label><Input type="number" min="1" max="16" value={shape.strokeWidth} onChange={(event) => update({ strokeWidth: Math.max(1, Math.min(16, Number(event.target.value))) })} /></div><Button variant="outline" onClick={() => update({ labelPoint: undefined })}>Reset label position</Button><p className="helper label-helper">Drag the green handle to position the label freely.</p></>}<Button variant="outline" onClick={() => update({ locked: !shape.locked })}>{shape.locked ? <Unlock /> : <Lock />}{shape.locked ? "Unlock geometry" : "Lock geometry"}</Button><Button variant="destructive" onClick={onDelete}><Trash2 />Delete background object</Button></div>;
}

export function BackgroundImageProperties({ image, formatHeight, change, onDelete }: { image: BackgroundImage; formatHeight: number; change: (fn: (draft: MapData) => MapData) => void; onDelete: () => void }) {
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




// Pick a style here; define it in the style library. The pencil opens that library on this kind,
// with this style selected, so the two live in one place without leaving the object behind.
export function StylePicker({ label, value, styles, placeholder, helper, onChange, onEdit }: { label: string; value: string | undefined; styles: { id: string; label: string }[]; placeholder: string; helper?: string; onChange: (id: string | undefined) => void; onEdit: () => void }) {
  return <div className="line-style-section">
    <Label>{label}</Label>
    <div className="line-style-row">
      <NativeSelect value={value ?? ""} onChange={(event) => onChange(event.target.value || undefined)}>
        {placeholder && <NativeSelectOption value="">{placeholder}</NativeSelectOption>}
        {styles.map((style) => <NativeSelectOption key={style.id} value={style.id}>{style.label}</NativeSelectOption>)}
      </NativeSelect>
      <Button size="sm" variant="outline" onClick={onEdit} aria-label={`Edit ${label.toLowerCase()}`}><Pencil />Edit</Button>
    </div>
    {helper && <p className="helper">{helper}</p>}
  </div>;
}

// The right-hand panel while the ticket tool is in use: every stop, and how many tickets of each
// length name it. Sorting and the "not yet named" filter are the two ways of finding the gaps.
export type CoverageSort = { column: "stop" | TicketBand; descending: boolean };

export function TicketCoveragePanel({ rows, deck, cuts, sort, onSort, onlyUncovered, onOnlyUncovered, onOpen, onEditMix }: {
  rows: StopCoverage[];
  deck: string;
  cuts: { medium: number; long: number };
  onEditMix: () => void;
  sort: CoverageSort;
  onSort: (sort: CoverageSort) => void;
  onlyUncovered: boolean;
  onOnlyUncovered: (value: boolean) => void;
  onOpen: (stopId: string, band?: TicketBand) => void;
}) {
  const shown = (onlyUncovered ? rows.filter((row) => row.total === 0) : rows).slice().sort((a, b) => {
    if (sort.column === "stop") return sort.descending ? b.stop.name.localeCompare(a.stop.name) : a.stop.name.localeCompare(b.stop.name);
    const diff = a[sort.column] - b[sort.column];
    return (sort.descending ? -diff : diff) || a.stop.name.localeCompare(b.stop.name);
  });
  const head = (column: CoverageSort["column"], label: string, hint?: string) => <th key={column} className={cn("coverage-head", sort.column === column && "sorted")} title={hint}
    onClick={() => onSort({ column, descending: sort.column === column ? !sort.descending : column !== "stop" })}>
    {label}{sort.column === column ? (sort.descending ? " ↓" : " ↑") : ""}
  </th>;

  return <div className="coverage-panel">
    <p className="helper">Tickets in {deck}, counted at both ends. On this map short is up to {cuts.medium} wagon spaces, medium up to {cuts.long}, long beyond that. A ticket nobody can complete has no length and lands in none of the three. <button type="button" className="mix-link" onClick={onEditMix}>Change the lengths</button></p>
    <label className="checkbox-row"><input type="checkbox" checked={onlyUncovered} onChange={(event) => onOnlyUncovered(event.target.checked)} />Only stops with no tickets</label>
    <div className="coverage-scroll"><table className="coverage-table">
      <thead><tr>{head("stop", "Stop")}{head("short", "S", `Short tickets — up to ${cuts.medium} wagon spaces`)}{head("medium", "M", `Medium tickets — up to ${cuts.long} wagon spaces`)}{head("long", "L", `Long tickets — beyond ${cuts.long} wagon spaces`)}</tr></thead>
      <tbody>{shown.map((row) => <tr key={row.stop.id} className={cn(row.total === 0 && "coverage-empty")}>
        <td><button type="button" className="coverage-stop" disabled={row.total === 0} onClick={() => onOpen(row.stop.id)}>{row.stop.name}</button></td>
        {ticketBands.map((band) => <td key={band}>{row[band] > 0
          ? <button type="button" className="coverage-count" onClick={() => onOpen(row.stop.id, band)}>{row[band]}</button>
          : <span className="coverage-zero">0</span>}</td>)}
      </tr>)}</tbody>
    </table></div>
    {!shown.length && <p className="helper">Every stop is named by at least one ticket.</p>}
  </div>;
}
