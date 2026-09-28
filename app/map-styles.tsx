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
import { colorLabels, DEFAULT_END_GAP_MM, DEFAULT_WAGONS_PER_PLAYER, DEFAULT_STARTING_TICKETS, DEFAULT_KEPT_TICKETS, type LineStyle, type MapData, type MapFormat, mapFormats, routeColors, stopSizeMeta, type RouteTypeStyle, type StopTypeStyle, type WagonShape, type WagonStyle, wagonShapeMeta } from "./map-data";

export type StyleKind = "map" | "stop" | "route" | "wagon" | "line" | "defaults";
export type StyleTarget = { kind: StyleKind; id?: string };

const kindMeta: Record<StyleKind, { label: string; blurb: string }> = {
  map: { label: "Map", blurb: "Settings for the whole map: the board it is designed for and how much room every stop leaves its wagons." },
  stop: { label: "Stop types", blurb: "What each kind of stop looks like on the map." },
  route: { label: "Route types", blurb: "Line thickness and dash pattern per type. Colour comes from each route, so types are told apart by shape." },
  wagon: { label: "Wagon styles", blurb: "How the wagon spaces are drawn, to mark a route that plays by its own rule." },
  line: { label: "Line styles", blurb: "A one-off override of a single route's line, on top of its type." },
  defaults: { label: "New objects", blurb: "What a stop or route gets when you draw it. Changing these leaves what is already on the map alone." },
};
const styleKinds: StyleKind[] = ["stop", "route", "wagon", "line"];

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

export type EditorDefaults = {
  stopType: string; setStopType: (value: string) => void;
  stopSize: string; setStopSize: (value: string) => void;
  routeType: string; setRouteType: (value: string) => void;
  routeColor: string; setRouteColor: (value: string) => void;
  routeCurved: boolean; setRouteCurved: (value: boolean) => void;
  routeLineStyle: string | undefined; setRouteLineStyle: (value: string | undefined) => void;
  linkParallel: boolean; setLinkParallel: (value: boolean) => void;
  scaleTarget: string; setScaleTarget: (value: string) => void;
};

const clampCount = (raw: string, fallback: number): number => {
  const number = Math.round(Number(raw));
  return Number.isFinite(number) && number >= 1 ? number : fallback;
};

export function SettingsDialog({ open, onOpenChange, target, onTarget, data, change, defaults, onChangeFormat }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: StyleTarget;
  onTarget: (target: StyleTarget) => void;
  data: MapData;
  change: (fn: (draft: MapData) => MapData) => void;
  defaults: EditorDefaults;
  onChangeFormat: (format: MapFormat) => void;
}) {
  const kind = target.kind;
  const lists: Record<string, { id: string; label: string }[]> = {
    stop: data.stopTypeStyles, route: data.routeTypeStyles, wagon: data.wagonStyles, line: data.lineStyles,
  };
  const list = lists[kind] ?? [];
  const selected = list.find((style) => style.id === target.id) ?? list[0];
  const format = mapFormats[data.format];
  const totalSpaces = data.routes.reduce((sum, route) => sum + route.length, 0);

  const usage = (styleId: string) => kind === "stop" ? data.stops.filter((stop) => stop.type === styleId).length
    : kind === "route" ? data.routes.filter((route) => route.type === styleId).length
    : kind === "wagon" ? data.routes.filter((route) => route.wagonStyle === styleId).length
    : data.routes.filter((route) => route.lineStyle === styleId).length;

  const update = (values: Record<string, unknown>) => change((draft) => {
    const found = (draft[listKey(kind)] as { id: string }[]).find((style) => style.id === selected.id);
    if (found) Object.assign(found, values);
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
      <DialogHeader><DialogTitle>Settings</DialogTitle><DialogDescription>Everything that applies to the whole map. Settings for one stop or one route stay in the Properties panel.</DialogDescription></DialogHeader>
      <div className="settings-layout">
        <nav className="settings-nav">
          {(Object.keys(kindMeta) as StyleKind[]).map((key) => <button key={key} type="button" className={cn("settings-nav-item", key === kind && "active")} onClick={() => onTarget({ kind: key })}>
            {kindMeta[key].label}{lists[key] && <small>{lists[key].length}</small>}
          </button>)}
        </nav>
        <div className="settings-body">
          <p className="helper">{kindMeta[kind].blurb}</p>

          {kind === "map" && <div className="style-fields">
            <div><Label htmlFor="settings-format">Board format</Label><NativeSelect id="settings-format" value={data.format} onChange={(event) => onChangeFormat(event.target.value as MapFormat)}>{Object.entries(mapFormats).map(([key, item]) => <NativeSelectOption key={key} value={key}>{item.label}</NativeSelectOption>)}</NativeSelect>
              <dl className="format-measurements"><div><dt>Finished size</dt><dd>{format.widthMm.toLocaleString("en-GB")} × {format.heightMm.toLocaleString("en-GB")} mm{format.imperial ? ` (${format.imperial})` : ""}</dd></div>{format.columns > 1 && <div><dt>Panel size</dt><dd>about {Math.round(format.widthMm / format.columns)} × {Math.round(format.heightMm / format.rows)} mm</dd></div>}</dl>
              <p className="helper">{format.note}{format.custom ? ". This is not a verified commercial Ticket to Ride size" : ""}. Changing format keeps objects in the same relative positions.</p></div>
            {format.testSheet && <div><Label htmlFor="settings-proof">This sheet is a proof of</Label><NativeSelect id="settings-proof" value={defaults.scaleTarget} onChange={(event) => defaults.setScaleTarget(event.target.value)}>{Object.entries(mapFormats).filter(([, item]) => !item.testSheet).map(([key, item]) => <NativeSelectOption key={key} value={key}>{item.shortLabel}</NativeSelectOption>)}</NativeSelect>
              <p className="helper">A test sheet is a shrunken stand-in for a real board, so the editor needs to know which board it represents.</p></div>}
            <div className="settings-pair">
              <div><Label htmlFor="settings-wagons">Wagons per player</Label>
                <Input id="settings-wagons" type="number" min={1} max={99} value={data.wagonsPerPlayer ?? DEFAULT_WAGONS_PER_PLAYER}
                  onChange={(event) => change((draft) => { draft.wagonsPerPlayer = clampCount(event.target.value, DEFAULT_WAGONS_PER_PLAYER); return draft; })} /></div>
              <div><Label htmlFor="settings-starting-tickets">Tickets dealt at the start</Label>
                <Input id="settings-starting-tickets" type="number" min={1} max={20} value={data.startingTickets ?? DEFAULT_STARTING_TICKETS}
                  onChange={(event) => change((draft) => {
                    draft.startingTickets = clampCount(event.target.value, DEFAULT_STARTING_TICKETS);
                    // Nobody can be made to keep more tickets than they were dealt.
                    draft.keptTickets = Math.min(draft.keptTickets ?? DEFAULT_KEPT_TICKETS, draft.startingTickets);
                    return draft;
                  })} /></div>
              <div><Label htmlFor="settings-kept-tickets">Tickets a player must keep</Label>
                <Input id="settings-kept-tickets" type="number" min={1} max={data.startingTickets ?? DEFAULT_STARTING_TICKETS} value={data.keptTickets ?? DEFAULT_KEPT_TICKETS}
                  onChange={(event) => change((draft) => { draft.keptTickets = Math.min(clampCount(event.target.value, DEFAULT_KEPT_TICKETS), draft.startingTickets ?? DEFAULT_STARTING_TICKETS); return draft; })} /></div>
            </div>
            <p className="helper">How a game on this map is set up. The original game gives each player {DEFAULT_WAGONS_PER_PLAYER} wagons and deals {DEFAULT_STARTING_TICKETS} tickets, of which {DEFAULT_KEPT_TICKETS} must be kept; a smaller map usually wants fewer wagons. {totalSpaces > 0 ? `This map has ${totalSpaces} wagon spaces in all, so one player's supply could claim about ${Math.round((data.wagonsPerPlayer ?? DEFAULT_WAGONS_PER_PLAYER) / totalSpaces * 100)}% of it.` : ""}</p>
            <div><Label htmlFor="settings-gap">Space at stops · {data.endGapMm ?? DEFAULT_END_GAP_MM} mm</Label>
              <input id="settings-gap" className="range-input" type="range" min="0" max="30" step="1" value={data.endGapMm ?? DEFAULT_END_GAP_MM} onChange={(event) => change((draft) => { draft.endGapMm = Number(event.target.value); return draft; })} />
              <p className="helper">The default room beyond a stop&apos;s own circle before the first wagon. A single stop can override it from its own panel. Past about 4 mm the wagons start losing their real spacing.</p></div>
          </div>}

          {kind === "defaults" && <div className="style-fields">
            <div className="colour-row">
              <div><Label>Stop type</Label><NativeSelect value={defaults.stopType} onChange={(event) => defaults.setStopType(event.target.value)}>{data.stopTypeStyles.map((style) => <NativeSelectOption key={style.id} value={style.id}>{style.label}</NativeSelectOption>)}</NativeSelect></div>
              <div><Label>Stop size</Label><NativeSelect value={defaults.stopSize} onChange={(event) => defaults.setStopSize(event.target.value)}>{Object.entries(stopSizeMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div>
            </div>
            <div className="colour-row">
              <div><Label>Route type</Label><NativeSelect value={defaults.routeType} onChange={(event) => defaults.setRouteType(event.target.value)}>{data.routeTypeStyles.map((style) => <NativeSelectOption key={style.id} value={style.id}>{style.label}</NativeSelectOption>)}</NativeSelect></div>
              <div><Label>Route colour</Label><NativeSelect value={defaults.routeColor} onChange={(event) => defaults.setRouteColor(event.target.value)}>{Object.keys(routeColors).map((key) => <NativeSelectOption key={key} value={key}>{colorLabels[key]}</NativeSelectOption>)}</NativeSelect></div>
            </div>
            <div><Label>Special rule style for new routes</Label><NativeSelect value={defaults.routeLineStyle ?? ""} onChange={(event) => defaults.setRouteLineStyle(event.target.value || undefined)}><NativeSelectOption value="">Default appearance</NativeSelectOption>{data.lineStyles.map((style) => <NativeSelectOption key={style.id} value={style.id}>{style.label}</NativeSelectOption>)}</NativeSelect></div>
            <label className="checkbox-row"><input type="checkbox" checked={defaults.routeCurved} onChange={(event) => defaults.setRouteCurved(event.target.checked)} />Draw new routes as smooth curves</label>
            <label className="checkbox-row"><input type="checkbox" checked={defaults.linkParallel} onChange={(event) => defaults.setLinkParallel(event.target.checked)} />Shape the parallel lines of a double route together</label>
          </div>}

          {styleKinds.includes(kind) && <div className="style-columns">
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
          </div>}
        </div>
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
