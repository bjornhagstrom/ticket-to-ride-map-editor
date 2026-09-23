"use client";

// The right-hand Properties panel: one editor component per kind of selected object, plus the
// route-type and line-style pickers they share.
import { ChevronDown, Copy, Crosshair, Lock, Maximize2, Minus, Plus, TrainFront, Trash2, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { colorLabels, type ImageCrop, type LineStyle, type MapData, type NoteBox, type RouteTypeStyle, type BackgroundImage, type BackgroundShape, type Route, routeColors, type Stop, stopSizeMeta, stopSymbolMeta, type StopSize, type StopSymbol, type StopType, stopTypeMeta, W } from "./map-data";
import { samePair, stopById } from "./map-geometry";
import { labelAngleOf } from "./map-analysis";
import { cn } from "@/lib/utils";

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

export function StopProperties({ stop, change, onDelete, labelState, mapEndGapMm }: { stop: Stop; change: (fn: (draft: MapData) => MapData) => void; onDelete: () => void; mapEndGapMm: number; labelState: { covers: boolean; clear: number[]; best: number } }) {
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
    <div className="label-angle">
      <Label htmlFor="stop-end-gap">Space before the first wagon · {stop.endGapMm ?? mapEndGapMm} mm{stop.endGapMm === undefined ? " (map default)" : ""}</Label>
      <input id="stop-end-gap" className="range-input" type="range" min="0" max="30" step="1" value={stop.endGapMm ?? mapEndGapMm} onChange={(event) => update({ endGapMm: Number(event.target.value) })} />
      <p className="helper">Room left beyond this stop&apos;s circle before the first wagon of every route into it. Set it per stop where one end of a line needs more air than the other.</p>
      {stop.endGapMm !== undefined && <Button size="sm" variant="ghost" onClick={() => update({ endGapMm: undefined })}>Use the map default ({mapEndGapMm} mm)</Button>}
    </div>
    <div className="label-angle">
      <Label>Name position · {Math.round(labelAngleOf(stop))}°</Label>
      <input className="range-input" type="range" min="0" max="345" step="15" value={Math.round(labelAngleOf(stop))} onChange={(event) => update({ labelAngle: Number(event.target.value) })} />
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
    </div>
    <Button variant="destructive" onClick={onDelete}><Trash2 />Delete stop</Button>
    <p className="delete-note">Connected routes will also be deleted.</p>
  </div>;
}

export function RouteTypeEditor({ typeId, routeTypeStyles, routes, onSelectType, onCreateType, onUpdateType, onDeleteType }: { typeId: string; routeTypeStyles: RouteTypeStyle[]; routes: Route[]; onSelectType: (typeId: string) => void; onCreateType: () => void; onUpdateType: (typeId: string, values: Partial<RouteTypeStyle>) => void; onDeleteType: (typeId: string) => void }) {
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

export function LineStylePicker({ value, lineStyles, onChange, onCreate, onUpdate, onDelete, helper }: { value: string | undefined; lineStyles: LineStyle[]; onChange: (styleId: string | undefined) => void; onCreate: () => void; onUpdate: (styleId: string, values: Partial<LineStyle>) => void; onDelete: (styleId: string) => void; helper: string }) {
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

export function RouteProperties({ route, stops, routes, lineStyles, routeTypeStyles, change, onDelete, onCreateStyle, onUpdateStyle, onDeleteStyle, onSetStyle, onCreateType, onUpdateType, onDeleteType, onAddParallel, onStraighten, onSetCurved, linkParallel, onLinkParallel }: { route: Route; onStraighten: (routeId: string) => void; onSetCurved: (routeId: string, curved: boolean) => void; linkParallel: boolean; onLinkParallel: (value: boolean) => void; stops: Stop[]; routes: Route[]; lineStyles: LineStyle[]; routeTypeStyles: RouteTypeStyle[]; change: (fn: (draft: MapData) => MapData) => void; onDelete: () => void; onAddParallel: (routeId: string) => void; onCreateStyle: (routeId: string) => void; onUpdateStyle: (styleId: string, values: Partial<LineStyle>) => void; onDeleteStyle: (styleId: string) => void; onSetStyle: (routeId: string, styleId: string | undefined) => void; onCreateType: (routeId: string) => void; onUpdateType: (typeId: string, values: Partial<RouteTypeStyle>) => void; onDeleteType: (typeId: string) => void }) {
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

export function NoteProperties({ note, change, onDelete }: { note: NoteBox; change: (fn: (draft: MapData) => MapData) => void; onDelete: () => void }) {
  const update = (values: Partial<NoteBox>) => change((draft) => { const item = draft.notes.find((entry) => entry.id === note.id); if (item) Object.assign(item, values); return draft; });
  return <div className="property-form">
    <div><Label htmlFor="note-text">Evaluation note</Label><Textarea id="note-text" rows={5} value={note.text} onChange={(event) => update({ text: event.target.value })} /></div>
    <p className="helper">Shown on screen and in print, for reviewers evaluating the map. Drag the corner handle on the map to resize it.</p>
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

