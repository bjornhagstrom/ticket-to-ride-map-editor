"use client";

// The style library: one place to create and edit every kind of reusable appearance the map has.
// Applying a style stays in the Properties panel, where the object is; defining one lives here, so
// the panel is about the thing you clicked rather than about the map's vocabulary.
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { type LineStyle, type MapData, type RouteTypeStyle, type StopTypeStyle, type WagonShape, type WagonStyle, wagonShapeMeta } from "./map-data";

export type StyleKind = "stop" | "route" | "line" | "wagon";
export type StyleTarget = { kind: StyleKind; id?: string };

const kindMeta: Record<StyleKind, { label: string; blurb: string }> = {
  stop: { label: "Stop types", blurb: "What each kind of stop looks like on the map." },
  route: { label: "Route types", blurb: "Line thickness and dash pattern per type. Colour comes from each route, so types are told apart by shape." },
  wagon: { label: "Wagon styles", blurb: "How the wagon spaces are drawn, to mark a route that plays by its own rule." },
  line: { label: "Line styles", blurb: "A one-off override of a single route's line, on top of its type." },
};

const dashPresets = [
  { value: "", label: "Solid" },
  { value: "4 4", label: "Fine dashes" },
  { value: "10 6", label: "Dashes" },
  { value: "2 5", label: "Dotted" },
  { value: "14 4 2 4", label: "Dash-dot" },
];
const dashOptions = (current: string) => dashPresets.some((preset) => preset.value === current)
  ? dashPresets
  : [...dashPresets, { value: current, label: `Custom (${current})` }];

export function StyleLibraryDialog({ open, onOpenChange, target, onTarget, data, change }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: StyleTarget;
  onTarget: (target: StyleTarget) => void;
  data: MapData;
  change: (fn: (draft: MapData) => MapData) => void;
}) {
  const kind = target.kind;
  const lists: Record<StyleKind, { id: string; label: string }[]> = {
    stop: data.stopTypeStyles, route: data.routeTypeStyles, wagon: data.wagonStyles, line: data.lineStyles,
  };
  const list = lists[kind];
  const selected = list.find((style) => style.id === target.id) ?? list[0];

  const usage = (styleId: string) => kind === "stop" ? data.stops.filter((stop) => stop.type === styleId).length
    : kind === "route" ? data.routes.filter((route) => route.type === styleId).length
    : kind === "wagon" ? data.routes.filter((route) => route.wagonStyle === styleId).length
    : data.routes.filter((route) => route.lineStyle === styleId).length;

  const update = (values: Record<string, unknown>) => change((draft) => {
    const target = (draft[listKey(kind)] as { id: string }[]).find((style) => style.id === selected.id);
    if (target) Object.assign(target, values);
    return draft;
  });

  const create = () => {
    const id = `${kind}-${Date.now()}`;
    change((draft) => { (draft[listKey(kind)] as unknown[]).push(blankStyle(kind, id)); return draft; });
    onTarget({ kind, id });
  };

  const remove = (styleId: string) => {
    change((draft) => {
      draft[listKey(kind)] = (draft[listKey(kind)] as { id: string }[]).filter((style) => style.id !== styleId) as never;
      if (kind === "wagon") draft.routes = draft.routes.map((route) => route.wagonStyle === styleId ? { ...route, wagonStyle: undefined } : route);
      if (kind === "line") draft.routes = draft.routes.map((route) => route.lineStyle === styleId ? { ...route, lineStyle: undefined } : route);
      return draft;
    });
    onTarget({ kind });
  };

  // A type that objects point at cannot be removed without orphaning them; a decorative style can,
  // because removing it just puts those routes back to their default appearance.
  const locked = (kind === "stop" || kind === "route") && (usage(selected?.id ?? "") > 0 || list.length <= 1);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="style-dialog">
      <DialogHeader><DialogTitle>Styles</DialogTitle><DialogDescription>Define the appearances this map reuses. Apply them from the Properties panel.</DialogDescription></DialogHeader>
      <div className="style-tabs">
        {(Object.keys(kindMeta) as StyleKind[]).map((key) => <button key={key} type="button" className={cn("style-tab", key === kind && "active")} onClick={() => onTarget({ kind: key })}>{kindMeta[key].label}<small>{lists[key].length}</small></button>)}
      </div>
      <p className="helper">{kindMeta[kind].blurb}</p>
      <div className="style-columns">
        <div className="style-list">
          {list.map((style) => <button key={style.id} type="button" className={cn("style-entry", style.id === selected?.id && "active")} onClick={() => onTarget({ kind, id: style.id })}>
            <span>{style.label}</span><small>{usage(style.id) || ""}</small>
          </button>)}
          <Button size="sm" variant="outline" onClick={create}><Plus />New</Button>
        </div>
        {selected ? <div className="style-fields">
          <div><Label>Name</Label><Input value={selected.label} onChange={(event) => update({ label: event.target.value })} /></div>
          {kind === "stop" && <StopTypeFields style={selected as StopTypeStyle} update={update} />}
          {kind === "route" && <RouteTypeFields style={selected as RouteTypeStyle} update={update} />}
          {kind === "wagon" && <WagonStyleFields style={selected as WagonStyle} update={update} />}
          {kind === "line" && <LineStyleFields style={selected as LineStyle} update={update} />}
          <Button size="sm" variant="ghost" disabled={locked} onClick={() => remove(selected.id)}>
            <Trash2 />{locked ? (list.length <= 1 ? "The only one left" : `In use by ${usage(selected.id)}`) : "Delete"}
          </Button>
        </div> : <p className="helper">Nothing defined yet.</p>}
      </div>
    </DialogContent>
  </Dialog>;
}

const listKey = (kind: StyleKind) => kind === "stop" ? "stopTypeStyles" : kind === "route" ? "routeTypeStyles" : kind === "wagon" ? "wagonStyles" : "lineStyles";

const blankStyle = (kind: StyleKind, id: string) => kind === "stop" ? { id, label: "New stop type", fill: "#fffaf0", stroke: "#736d64" }
  : kind === "route" ? { id, label: "New route type", stroke: "#736d64", dash: "", strokeWidth: 3, infrastructure: false }
  : kind === "wagon" ? { id, label: "New wagon style", shape: "notched" }
  : { id, label: "New line style", strokeWidth: 6, dash: "10 6" };

type Update = (values: Record<string, unknown>) => void;

function StopTypeFields({ style, update }: { style: StopTypeStyle; update: Update }) {
  return <>
    <div className="colour-row">
      <label>Fill<input className="colour-input" type="color" value={style.fill} onChange={(event) => update({ fill: event.target.value })} /></label>
      <label>Outline<input className="colour-input" type="color" value={style.stroke} onChange={(event) => update({ stroke: event.target.value })} /></label>
    </div>
    <label className="checkbox-row"><input type="checkbox" checked={Boolean(style.square)} onChange={(event) => update({ square: event.target.checked || undefined })} />Draw a square inside the circle</label>
  </>;
}

function RouteTypeFields({ style, update }: { style: RouteTypeStyle; update: Update }) {
  return <>
    {style.infrastructure
      ? <div><Label>Line colour</Label><input className="colour-input" type="color" value={style.stroke} onChange={(event) => update({ stroke: event.target.value })} /></div>
      : <p className="helper">Every route keeps its own wagon colour, so a type is told apart by thickness and dash pattern — not by colour.</p>}
    <div><Label>Thickness · {style.strokeWidth}px</Label><input className="range-input" type="range" min="2" max="14" value={style.strokeWidth} onChange={(event) => update({ strokeWidth: Number(event.target.value) })} /></div>
    <div><Label>Dash pattern</Label><NativeSelect value={style.dash} onChange={(event) => update({ dash: event.target.value })}>{dashOptions(style.dash).map((preset) => <NativeSelectOption key={preset.value} value={preset.value}>{preset.label}</NativeSelectOption>)}</NativeSelect></div>
    <label className="checkbox-row"><input type="checkbox" checked={style.infrastructure} onChange={(event) => update({ infrastructure: event.target.checked })} />Pre-built infrastructure (no train cards or wagon slots)</label>
  </>;
}

function WagonStyleFields({ style, update }: { style: WagonStyle; update: Update }) {
  return <>
    <div><Label>Shape</Label><NativeSelect value={style.shape} onChange={(event) => update({ shape: event.target.value as WagonShape })}>{Object.entries(wagonShapeMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div>
    <div><Label>Mark in the space</Label><Input maxLength={2} value={style.glyph ?? ""} onChange={(event) => update({ glyph: event.target.value || undefined })} />
      <p className="helper">One or two characters, drawn inside every space. A shape alone can get lost on a small print; a letter survives it.</p></div>
  </>;
}

function LineStyleFields({ style, update }: { style: LineStyle; update: Update }) {
  return <>
    <div><Label>Thickness · {style.strokeWidth}px</Label><input className="range-input" type="range" min="2" max="14" value={style.strokeWidth} onChange={(event) => update({ strokeWidth: Number(event.target.value) })} /></div>
    <div><Label>Dash pattern</Label><NativeSelect value={style.dash} onChange={(event) => update({ dash: event.target.value })}>{dashOptions(style.dash).map((preset) => <NativeSelectOption key={preset.value} value={preset.value}>{preset.label}</NativeSelectOption>)}</NativeSelect></div>
  </>;
}
