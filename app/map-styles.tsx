"use client";

// The style library: one place to create and edit every kind of reusable appearance the map has.
// Applying a style stays in the Properties panel, where the object is; defining one lives here, so
// the panel is about the thing you clicked rather than about the map's vocabulary.
import { useMemo } from "react";
import { boardOf, orientationLabels, orientationOf, type Orientation } from "./board";
import { BoardPreview } from "./board-preview";
import { Plus, Trash2 } from "lucide-react";
import { bandCuts, mapDiameter } from "./map-analysis";
import { DeckRulesPanel } from "./deck-rules-panel";
import { notchedSlotPath, ovalSlotPath, tunnelSlotPath } from "./map-artwork";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { DEFAULT_PLAYERS, LANES_OPEN_FROM, DEFAULT_TICKET_BANDS, DEFAULT_TICKET_MIX, TICKET_MIX_PRESETS, colorLabels, DEFAULT_WAGONS_PER_PLAYER, DEFAULT_STARTING_TICKETS, DEFAULT_KEPT_TICKETS, type MapData, type MapFormat, mapFormats, routeColors, stopSizeMeta, type RouteTypeStyle, type StopTypeStyle, type WagonShape, wagonShapeMeta } from "./map-data";

export type StyleKind = "map" | "ticket" | "stop" | "route" | "defaults";
export type StyleTarget = { kind: StyleKind; id?: string };

const kindMeta: Record<StyleKind, { label: string; blurb: string }> = {
  map: { label: "Map", blurb: "Basic map settings." },
  ticket: { label: "Deck rules", blurb: "The rules the ticket suggester follows on this map — ours, which are fixed, or a set of your own made from one of them — and where a ticket stops being short and starts being long, with how much of the deck belongs in each band." },
  stop: { label: "Stop types", blurb: "What each kind of stop looks like on the map." },
  route: { label: "Route types", blurb: "Line thickness and dash pattern per type. Colour comes from each route, so types are told apart by shape." },
  defaults: { label: "Default object style", blurb: "The style the next stop or route you draw will get. These are settings for your pen, not for the map: changing them leaves everything already drawn exactly as it is." },
};
const styleKinds: StyleKind[] = ["stop", "route"];

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
};

const clampCount = (raw: string, fallback: number): number => {
  const number = Math.round(Number(raw));
  return Number.isFinite(number) && number >= 1 ? number : fallback;
};

export function SettingsDialog({ open, onOpenChange, target, onTarget, data, change, defaults, onChangeFormat, onChangeOrientation }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: StyleTarget;
  onTarget: (target: StyleTarget) => void;
  data: MapData;
  change: (fn: (draft: MapData) => MapData) => void;
  defaults: EditorDefaults;
  onChangeFormat: (format: MapFormat) => void;
  onChangeOrientation: (orientation: Orientation) => void;
}) {
  const kind = target.kind;
  const lists: Record<string, { id: string; label: string }[]> = {
    stop: data.stopTypeStyles, route: data.routeTypeStyles, wagon: data.wagonStyles, line: data.lineStyles,
  };
  const list = lists[kind] ?? [];
  const selected = list.find((style) => style.id === target.id) ?? list[0];
  const totalSpaces = data.routes.reduce((sum, route) => sum + route.length, 0);
  const diameter = useMemo(() => mapDiameter(data), [data]);
  const players = data.players ?? DEFAULT_PLAYERS;
  // A map with nothing on it yet: say what is worth doing now and what can wait.
  const fresh = data.stops.length === 0 && data.routes.length === 0;

  const usage = (styleId: string) => kind === "stop" ? data.stops.filter((stop) => stop.type === styleId).length
    : kind === "route" ? data.routes.filter((route) => route.type === styleId).length
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

          {kind === "ticket" && (() => {
            const bands = data.ticketBands ?? DEFAULT_TICKET_BANDS;
            const mix = data.ticketMix ?? DEFAULT_TICKET_MIX;
            const cuts = bandCuts(diameter, bands);
            const total = mix.short + mix.medium + mix.long;
            const setBands = (next: Partial<typeof bands>) => change((draft) => {
              const merged = { ...bands, ...next };
              // The two boundaries cannot cross each other.
              draft.ticketBands = { medium: Math.min(merged.medium, merged.long), long: Math.max(merged.medium, merged.long) };
              return draft;
            });
            const setMix = (next: Partial<typeof mix>) => change((draft) => { draft.ticketMix = { ...mix, ...next }; return draft; });
            // Typed in wagon spaces, which is what a designer counts, and kept as a share of the
            // map's longest journey, which is what carries between maps of different sizes.
            const edge = (id: string, label: string, value: number, key: "medium" | "long") => <div key={id}>
              <Label htmlFor={id}>{label}</Label>
              <Input id={id} type="number" min={1} max={Math.max(1, diameter)} step={1} disabled={diameter < 2}
                value={diameter ? Math.round(value * diameter) : ""}
                onChange={(event) => { if (!diameter) return; const spaces = Math.min(diameter, Math.max(1, Math.round(Number(event.target.value) || 1))); setBands({ [key]: spaces / diameter }); }} />
            </div>;
            const share = (id: string, label: string, value: number, key: "short" | "medium" | "long") => <div key={id}>
              <Label htmlFor={id}>{label}</Label>
              <Input id={id} type="number" min={0} max={100} value={value}
                onChange={(event) => setMix({ [key]: Math.min(100, Math.max(0, Math.round(Number(event.target.value) || 0))) })} />
            </div>;
            return <><DeckRulesPanel data={data} change={change} /><h4 className="deck-rules-subhead">Ticket lengths</h4><div className="ticket-mix">
              <div className="mix-fields">
                {edge("mix-medium-edge", "Short up to · spaces", bands.medium, "medium")}
                {edge("mix-long-edge", "Long from · spaces", bands.long, "long")}
              </div>
              <p className="helper">{diameter < 2
                ? "Draw some routes first: the boundaries are counted against the longest journey on the map, and there is not one yet."
                : `Counted in wagon spaces along the shortest route between two stops. The longest journey on this map is ${diameter} spaces, so a ticket of ${cuts.medium} spaces or fewer is short, one of ${cuts.long} or more is long, and the rest are medium.`}</p>
              <p className="helper">Kept as a share of that longest journey rather than as a fixed number, so the same mix means the same thing if you change the board size or follow another map. That is also how the official decks were measured.</p>

              <div className="mix-fields">
                {share("mix-short", "Short %", mix.short, "short")}
                {share("mix-medium", "Medium %", mix.medium, "medium")}
                {share("mix-long", "Long %", mix.long, "long")}
              </div>
              {total !== 100
                ? <p className="helper helper-warning">These add up to {total} %, not 100. The suggester will read them as proportions all the same, but the numbers are easier to judge when they add up.</p>
                : <p className="helper">The share of the deck that should sit in each band. The suggester aims at this, and the suggestion dialog shows the current deck and the proposed one against it.</p>}

              <div className="mix-presets">
                <p className="eyebrow">Follow an official map</p>
                {TICKET_MIX_PRESETS.map((preset) => <button type="button" key={preset.id} className={cn("mix-preset", mix.short === preset.mix.short && mix.medium === preset.mix.medium && mix.long === preset.mix.long && "chosen")}
                  onClick={() => change((draft) => { draft.ticketMix = { ...preset.mix }; draft.ticketBands = { ...DEFAULT_TICKET_BANDS }; return draft; })}>
                  <strong>{preset.label}</strong>
                  <span>{preset.mix.short} / {preset.mix.medium} / {preset.mix.long} %</span>
                  <em>{preset.note}</em>
                </button>)}
              </div>
            </div></>;
          })()}

          {kind === "map" && <div className="style-fields">
            {fresh && <p className="helper settings-start">A board format is all you need to begin. The rest — ticket lengths, stop and route types, what a new object looks like — is listed on the left and can wait until you want it.</p>}
            <div className="settings-board">
              <div className="settings-board-fields">
                <fieldset id="settings-format" className="settings-radios"><legend>Board format (# of panels)</legend>
                  {Object.entries(mapFormats).map(([key, item]) => <label key={key} className="print-option">
                    <input type="radio" name="settings-format" value={key} checked={data.format === key} onChange={() => onChangeFormat(key as MapFormat)} />
                    <span><strong>{item.label}</strong><small>{(() => { const shape = boardOf({ format: key as MapFormat, orientation: data.orientation }); return `${shape.widthMm.toLocaleString("en-GB")} × ${shape.heightMm.toLocaleString("en-GB")} mm, ${item.columns * item.rows} panels`; })()}</small></span>
                  </label>)}
                  <p className="helper settings-format-help">The shape of the game board. <strong>You can change this whenever you like.</strong></p>
                </fieldset>
                <fieldset id="settings-orientation" className="settings-radios"><legend>Orientation</legend>
                  {(Object.keys(orientationLabels) as Orientation[]).map((key) => <label key={key} className="print-option">
                    <input type="radio" name="settings-orientation" value={key} checked={orientationOf(data) === key} onChange={() => onChangeOrientation(key)} />
                    <span><strong>{orientationLabels[key]}</strong></span>
                  </label>)}
                  <p className="helper settings-orientation-help">Whether the board lies or stands. Changing it turns everything on the map a quarter turn, and the ticket cards turn with it.</p>
                </fieldset>
              </div>
              <BoardPreview data={data} />
            </div>
            <div className="settings-pair">
              <div><Label htmlFor="settings-players-min">Players, fewest</Label>
                <Input id="settings-players-min" type="number" min={1} max={8} value={players.min}
                  onChange={(event) => change((draft) => { const min = clampCount(event.target.value, DEFAULT_PLAYERS.min); draft.players = { min, max: Math.max(min, players.max) }; return draft; })} /></div>
              <div><Label htmlFor="settings-players-max">Players, most</Label>
                <Input id="settings-players-max" type="number" min={1} max={8} value={players.max}
                  onChange={(event) => change((draft) => { const max = clampCount(event.target.value, DEFAULT_PLAYERS.max); draft.players = { min: Math.min(players.min, max), max }; return draft; })} /></div>
              <div />
            </div>
            <p className="helper">How many players the map is built for. It sets how big a deck has to be to deal from, and whether the second lane of a double route is ever in play: the standard rule opens it only from {LANES_OPEN_FROM} players up{players.max < LANES_OPEN_FROM ? ", so on this map a double route is always worth one lane" : ""}.</p>
            <div className="settings-pair">
              <div><Label htmlFor="settings-wagons">Wagons each</Label>
                <Input id="settings-wagons" type="number" min={1} max={99} value={data.wagonsPerPlayer ?? DEFAULT_WAGONS_PER_PLAYER}
                  onChange={(event) => change((draft) => { draft.wagonsPerPlayer = clampCount(event.target.value, DEFAULT_WAGONS_PER_PLAYER); return draft; })} /></div>
              <div><Label htmlFor="settings-starting-tickets">Tickets dealt</Label>
                <Input id="settings-starting-tickets" type="number" min={1} max={20} value={data.startingTickets ?? DEFAULT_STARTING_TICKETS}
                  onChange={(event) => change((draft) => {
                    draft.startingTickets = clampCount(event.target.value, DEFAULT_STARTING_TICKETS);
                    // Nobody can be made to keep more tickets than they were dealt.
                    draft.keptTickets = Math.min(draft.keptTickets ?? DEFAULT_KEPT_TICKETS, draft.startingTickets);
                    return draft;
                  })} /></div>
              <div><Label htmlFor="settings-kept-tickets">Tickets kept</Label>
                <Input id="settings-kept-tickets" type="number" min={1} max={data.startingTickets ?? DEFAULT_STARTING_TICKETS} value={data.keptTickets ?? DEFAULT_KEPT_TICKETS}
                  onChange={(event) => change((draft) => { draft.keptTickets = Math.min(clampCount(event.target.value, DEFAULT_KEPT_TICKETS), draft.startingTickets ?? DEFAULT_STARTING_TICKETS); return draft; })} /></div>
            </div>
            <p className="helper">How a game on this map is set up. The original game gives each player {DEFAULT_WAGONS_PER_PLAYER} wagons and deals {DEFAULT_STARTING_TICKETS} tickets, of which {DEFAULT_KEPT_TICKETS} must be kept; a smaller map usually wants fewer wagons. {totalSpaces > 0 ? `This map has ${totalSpaces} wagon spaces in all, so one player's supply could claim about ${Math.round((data.wagonsPerPlayer ?? DEFAULT_WAGONS_PER_PLAYER) / totalSpaces * 100)}% of it.` : ""}</p>
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
            <label className="checkbox-row"><input type="checkbox" checked={defaults.routeCurved} onChange={(event) => defaults.setRouteCurved(event.target.checked)} />Draw new routes as smooth curves</label>
            <label className="checkbox-row"><input type="checkbox" checked={defaults.linkParallel} onChange={(event) => defaults.setLinkParallel(event.target.checked)} />Shape the parallel lines of a double route together</label>
          </div>}

          {styleKinds.includes(kind) && <div className="style-columns">
            <div className="style-list">
              {list.map((style) => <button key={style.id} type="button" className={cn("style-entry", style.id === selected?.id && "active")} onClick={() => onTarget({ kind, id: style.id })}>
                <span>{style.label}</span>{kind === "route" && <RoutePreview style={style as RouteTypeStyle} />}<small>{usage(style.id) || ""}</small>
              </button>)}
              {kind === "route" && <p className="helper list-note">Only the shape is set here. A route&apos;s colour is chosen when you draw it on the map, so the same type can carry a blue route and a red one.</p>}
              <Button size="sm" variant="outline" onClick={create}><Plus />New</Button>
            </div>
            {selected ? <div className="style-fields">
              <div><Label>Name</Label><Input value={selected.label} onChange={(event) => update({ label: event.target.value })} /></div>
              {kind === "stop" && <StopTypeFields style={selected as StopTypeStyle} update={update} />}
              {kind === "route" && <RouteTypeFields style={selected as RouteTypeStyle} update={update} />}
              <Button size="sm" variant="ghost" disabled={locked} onClick={() => remove(selected.id)}>
                <Trash2 />{locked ? (list.length <= 1 ? "The only one left" : `In use by ${usage(selected.id)}`) : "Delete"}
              </Button>
            </div> : <p className="helper">Nothing defined yet.</p>}
          </div>}
        </div>
      </div>
      <DialogFooter className="settings-foot">
        <p className="helper">Everything here is saved as you change it, and Settings is always a click away. Nothing is waiting for you to confirm it.</p>
        <Button onClick={() => onOpenChange(false)}>{fresh ? "Start drawing" : "Done"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

const listKey = (kind: StyleKind) => kind === "stop" ? "stopTypeStyles" : "routeTypeStyles";

const blankStyle = (kind: StyleKind, id: string) => kind === "stop" ? { id, label: "New stop type", fill: "#fffaf0", stroke: "#736d64" }
  : { id, label: "New route type", stroke: "#736d64", dash: "", strokeWidth: 3, infrastructure: false, shape: "plain" };

type Update = (values: Record<string, unknown>) => void;

function StopTypeFields({ style, update }: { style: StopTypeStyle; update: Update }) {
  return <>
    <div className="colour-row">
      <label>Fill<input className="colour-input" type="color" value={style.fill} onChange={(event) => update({ fill: event.target.value })} /></label>
      <label>Outline<input className="colour-input" type="color" value={style.stroke} onChange={(event) => update({ stroke: event.target.value })} /></label>
    </div>
    <label className="checkbox-row"><input type="checkbox" checked={Boolean(style.square)} onChange={(event) => update({ square: event.target.checked || undefined })} />Draw a square inside the circle</label>
    <div className="style-aside">
      <label className="checkbox-row"><input type="checkbox" checked={Boolean(style.junction)} onChange={(event) => update({ junction: event.target.checked || undefined })} />No tickets end here</label>
      <p className="helper">This stop type only joins routes. Journeys run through it, but no ticket is ever drawn to one, and it does not count as a stop when a ticket deck is judged.</p>
    </div>
  </>;
}

// The shape drawn by the same functions the map uses, so what is shown here cannot drift from what
// is printed.
function RoutePreview({ style, className }: { style: RouteTypeStyle; className?: string }) {
  const shape = style.shape ?? "plain";
  const w = 26, h = 12;
  const slot = shape === "notched" ? notchedSlotPath(w, h, 3)
    : shape === "serrated" ? tunnelSlotPath(w, h, 2.2)
    : shape === "oval" ? ovalSlotPath(w, h)
    : `M${-w / 2},${-h / 2} h${w} v${h} h${-w} Z`;
  // A card route takes its colour from each route, so the sample uses a neutral one; an already
  // built route is drawn in the type's own colour, because that is where its colour comes from.
  const ink = style.infrastructure ? style.stroke : "#8a1c24";
  return <svg className={cn("route-preview", className)} viewBox="-46 -13 92 26" role="img"
    aria-label={`${style.label}: ${style.strokeWidth}px ${style.dash ? "dashed" : "solid"} line${style.infrastructure ? ", already built" : `, ${wagonShapeMeta[shape].label.toLowerCase()} spaces`}`}>
    <line x1="-44" y1="0" x2="44" y2="0" stroke={ink} strokeWidth={style.strokeWidth} strokeDasharray={style.dash || undefined} strokeLinecap="round" />
    {!style.infrastructure && [-15, 15].map((x) => <g key={x} transform={`translate(${x},0)`}>
      <path d={slot} fill="#fffaf0" stroke={ink} strokeWidth={shape === "heavy" ? 3 : 2} strokeLinejoin="round" />
      {style.glyph?.trim() && <text x="0" y="0" dominantBaseline="central" textAnchor="middle" fontSize="8" fill={ink} fontWeight="700">{style.glyph.trim()}</text>}
    </g>)}
  </svg>;
}

function RouteTypeFields({ style, update }: { style: RouteTypeStyle; update: Update }) {
  return <>
    {style.infrastructure
      ? <div><Label>Line colour</Label><input className="colour-input" type="color" value={style.stroke} onChange={(event) => update({ stroke: event.target.value })} /></div>
      : <p className="helper">Every route keeps its own wagon colour, so a type is told apart by thickness and dash pattern — not by colour.</p>}
    <div><Label>Thickness · {style.strokeWidth}px</Label><input className="range-input" type="range" min="2" max="14" value={style.strokeWidth} onChange={(event) => update({ strokeWidth: Number(event.target.value) })} /></div>
    <div><Label>Dash pattern</Label><NativeSelect value={style.dash} onChange={(event) => update({ dash: event.target.value })}>{dashOptions(style.dash).map((preset) => <NativeSelectOption key={preset.value} value={preset.value}>{preset.label}</NativeSelectOption>)}</NativeSelect></div>
    <RoutePreview style={style} className="route-preview-large" />
    {!style.infrastructure && <div><Label>Wagon spaces</Label>
      <div className="shape-row">
        <NativeSelect value={style.shape ?? "plain"} onChange={(event) => update({ shape: event.target.value as WagonShape })}>{Object.entries(wagonShapeMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect>
        
      </div>
      <p className="helper">The shape of every space along a route of this type, drawn here exactly as it will appear on the map. A shape says at a glance that a route plays by its own rule.</p></div>}
    <div><Label>Mark in the space</Label><Input maxLength={2} value={style.glyph ?? ""} onChange={(event) => update({ glyph: event.target.value || undefined })} />
      <p className="helper">One or two characters, drawn inside every space. A shape alone can get lost on a small print; a letter survives it. It is also the quickest way to mark a rule you are trying out — put a letter in the spaces and write down what it means beside the board.</p></div>
    <label className="checkbox-row"><input type="checkbox" checked={style.infrastructure} onChange={(event) => update({ infrastructure: event.target.checked })} />Already built — nobody claims it</label>
    <p className="helper">For something that is on the board from the start and free to travel along: a canal, a road, an existing railway. This is a rule, not a look — but the look follows from it. Nobody lays wagons on such a route, so it has no wagon spaces to draw, and it appears as a plain line in this type&apos;s colour. It is also left out of everything that counts what players compete over: the colour and length table, the crossing check, and how crowded a route is. Journeys still run along it.</p>
  </>;
}


