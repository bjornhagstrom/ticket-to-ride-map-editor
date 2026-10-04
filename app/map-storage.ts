// Loading, saving and reshaping map files: local-storage keys, the normalizers that let older
// files open, board-format rescaling, and image reading.
import { APP_VERSION } from "./version";
import { boardOf, rotateMap, turnBetween, turnContents, type Board } from "./board";
import { W, BUILT_IN_DECK_RULES, type DeckRuleSet, type PlayerRange, DEFAULT_WAGONS_PER_PLAYER, DEFAULT_STARTING_TICKETS, DEFAULT_KEPT_TICKETS, defaultTicketSet, type Ticket, type TicketSet, defaultStopTypeStyles, fallbackStopTypeStyle, type StopTypeStyle, defaultWagonStyles, type WagonStyle, defaultRouteTypeStyles, type LineStyle, type RouteTypeStyle, type BackgroundImage, type BackgroundShape, type ImageCrop, mapFormats, type MapData, type MapFormat, type MapVersion, type MapVersionEntry, type NoteBox, type Point, type Route, type Stop, STORAGE_KEY } from "./map-data";

export const GUIDE_SEEN_KEY = `${STORAGE_KEY}-guide-seen`;
export const MAX_IMAGE_WARN_BYTES = 2 * 1024 * 1024;
export const HISTORY_LIMIT = 200;
// The stored strings keep their original names so an existing browser does not lose the setting.
export const MAP_HINT_KEY = `${STORAGE_KEY}-route-hint`;
export const MAP_HINT_X_KEY = `${STORAGE_KEY}-route-hint-x`;
export const cloneMap = (data: MapData): MapData => JSON.parse(JSON.stringify(data));
// History snapshots deep-clone everything except the background image's base64 payload, which is
// re-attached by reference. Strings are immutable, so every snapshot shares one copy of the image
// instead of carrying its own — without this a single 2 MB image would cost 2 MB per undo step.
export const cloneForHistory = (data: MapData): MapData => {
  const image = data.backgroundImage;
  if (!image) return cloneMap(data);
  const clone = cloneMap({ ...data, backgroundImage: { ...image, dataUrl: "" } });
  if (clone.backgroundImage) clone.backgroundImage.dataUrl = image.dataUrl;
  return clone;
};
const isMapFormat = (value: unknown): value is MapFormat => typeof value === "string" && value in mapFormats;

// Formats a map could have before the board's shape and how it is printed were separated. Test
// sheets and boards measured in sheets of paper are print choices now; a map that names one opens
// on the nearest board. The heights are what those formats were, in map units, so a map can be
// moved from where it was drawn.
const legacyFormats: Record<string, { height: number; to: MapFormat }> = {
  a4: { height: Math.round(W * 210 / 297), to: "board-2x3" },
  a3: { height: Math.round(W * 297 / 420), to: "board-2x3" },
  "us-letter": { height: Math.round(W * 215.9 / 279.4), to: "board-2x3" },
  "board-2x3-large": { height: Math.round(W * 648 / 972), to: "board-2x3" },
  "a4-3x2": { height: Math.round(W * 420 / 891), to: "board-2x4" },
  "a4-4x2": { height: Math.round(W * 420 / 1188), to: "board-2x4" },
  "letter-3x2": { height: Math.round(W * 432 / 838), to: "board-2x4" },
  "letter-4x2": { height: Math.round(W * 432 / 1118), to: "board-2x4" },
};

// Moves a map drawn on an old format onto its board: scaled evenly so nothing changes shape, never
// enlarged, and centred on the board.
function migrateLegacyFormat(value: Partial<MapData>): Partial<MapData> {
  const legacy = typeof value.format === "string" ? legacyFormats[value.format] : undefined;
  if (!legacy) return value;
  const toHeight = mapFormats[legacy.to].height;
  const scale = Math.min(1, toHeight / legacy.height);
  const dx = (W - W * scale) / 2, dy = (toHeight - legacy.height * scale) / 2;
  const point = <T extends Point>(p: T): T => ({ ...p, x: dx + p.x * scale, y: dy + p.y * scale });
  const box = <T extends { x: number; y: number; width: number; height: number }>(b: T): T => ({ ...point(b), width: b.width * scale, height: b.height * scale });
  return {
    ...value,
    format: legacy.to,
    stops: Array.isArray(value.stops) ? value.stops.map(point) : value.stops,
    routes: Array.isArray(value.routes) ? value.routes.map((route) => (route.points ? { ...route, points: route.points.map(point) } : route)) : value.routes,
    background: Array.isArray(value.background) ? value.background.map((shape) => ({ ...shape, points: shape.points.map(point), labelPoint: shape.labelPoint ? point(shape.labelPoint) : shape.labelPoint })) : value.background,
    notes: Array.isArray(value.notes) ? value.notes.map(box) : value.notes,
    backgroundImage: value.backgroundImage && typeof value.backgroundImage === "object" ? box(value.backgroundImage) : value.backgroundImage,
  };
}
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
// A route used to carry `tunnel: true`; it is a wagon style now. Older files keep working, and the
// style they point at is added below if the file predates the list entirely.
const migrateRoute = (route: Route & { tunnel?: boolean }): Route => {
  if (!route.tunnel) return route;
  const rest = { ...route };
  delete rest.tunnel;
  return { ...rest, wagonStyle: rest.wagonStyle ?? "tunnel" };
};
const normalizeWagonStyles = (value: Partial<MapData> & { routes?: unknown }): WagonStyle[] => {
  if (Array.isArray(value.wagonStyles) && value.wagonStyles.length) return value.wagonStyles;
  const styles = defaultWagonStyles.map((style) => ({ ...style }));
  const used = new Set((Array.isArray(value.routes) ? value.routes : []).map((route: Route) => route.wagonStyle).filter(Boolean));
  for (const id of used) if (id && !styles.some((style) => style.id === id)) styles.push({ id, label: id, shape: "plain" });
  return styles;
};
const normalizeStopTypeStyles = (value: Partial<MapData>): StopTypeStyle[] => {
  if (Array.isArray(value.stopTypeStyles) && value.stopTypeStyles.length) return value.stopTypeStyles;
  const styles = defaultStopTypeStyles.map((style) => ({ ...style }));
  const used = new Set((Array.isArray(value.stops) ? value.stops : []).map((stop: Stop) => stop.type));
  for (const id of used) if (id && !styles.some((style) => style.id === id)) styles.push({ ...fallbackStopTypeStyle, id, label: id });
  return styles;
};
// ---------------------------------------------------------------------------- the file envelope
//
// Every file the editor writes carries the same wrapper, so a reader can tell what it is holding
// before it tries to understand it. docs/FILE-FORMAT.md is the contract; the rules that matter:
//
//  - the payload sits under its own key, so file metadata and map data never share a namespace,
//  - a file written before the envelope existed is read as version 1 and still opens,
//  - a file from a newer build is refused with a message, never quietly stripped,
//  - anything a reader does not understand is carried along and written back out untouched.
export const FILE_FORMAT = "ticket-to-ride-map";
// The newest version this build reads and writes. A lying map is still written as version 3, which
// every version 3 reader opens unchanged; only a standing map needs 4, so that a reader that cannot
// stand a board refuses it instead of laying it down wrong.
export const FILE_VERSION = 4;
export const LYING_FILE_VERSION = 3;
export const APP_NAME = "Map prototypes";
// The version, and the notes on what changed in it, live in version.ts.
export { APP_VERSION };

export type FileKind = "map" | "background" | "network" | "tickets";

export type MapFileEnvelope<T = unknown> = {
  format: typeof FILE_FORMAT;
  version: number;
  kind: FileKind;
  written: string;
  app: { name: string; version: string };
  board: { width: number; height: number };
  payload: T;
};

export function writeMapFile<T>(kind: FileKind, payload: T, data: Pick<MapData, "format" | "orientation">): MapFileEnvelope<T> {
  const board = boardOf(data);
  return {
    format: FILE_FORMAT,
    version: board.orientation === "portrait" ? FILE_VERSION : LYING_FILE_VERSION,
    kind,
    written: new Date().toISOString(),
    app: { name: APP_NAME, version: APP_VERSION },
    board: { width: board.width, height: board.height },
    payload,
  };
}

// Reads either an enveloped file or one of the flat files written before the envelope existed.
export function readMapFile(raw: unknown): { kind: FileKind; version: number; payload: Record<string, unknown>; board?: { width: number; height: number } } {
  const value = (raw ?? {}) as Record<string, unknown>;
  if (value.format === FILE_FORMAT) {
    const version = Number(value.version);
    if (!Number.isFinite(version) || version < 1) throw new Error("This file says it is a map file but does not say which version. It may be damaged.");
    if (version > FILE_VERSION) {
      throw new Error(`This file was written by a newer version of the editor (file version ${version}). This one reads up to version ${FILE_VERSION}. Update the editor, or export the file again from the version that wrote it.`);
    }
    return {
      kind: isFileKind(value.kind) ? value.kind : "map",
      version,
      payload: (value.payload ?? {}) as Record<string, unknown>,
      board: value.board as { width: number; height: number } | undefined,
    };
  }
  // Version 1: the payload was the file, with `kind` mixed in beside the data.
  const { kind, ...payload } = value;
  return { kind: isFileKind(kind) ? kind : "map", version: 1, payload: payload as Record<string, unknown> };
}

const isFileKind = (value: unknown): value is FileKind => value === "map" || value === "background" || value === "network" || value === "tickets";

// Everything a map file holds. Anything outside this list is a field some other version knows about
// and this one does not, so it is kept aside rather than thrown away.
const MAP_KEYS = new Set([
  "name", "format", "orientation", "background", "backgroundImage", "stops", "routes", "notes",
  "lineStyles", "routeTypeStyles", "wagonStyles", "stopTypeStyles", "tickets", "ticketSets",
  "wagonsPerPlayer", "startingTickets", "keptTickets", "players", "ticketBands", "ticketMix",
  "ticketValuation", "lanesUsableByPlayers", "endGapMm", "deckRules", "deckRule", "rules", "mapVersion", "unknown",
]);

const unknownKeys = (value: Record<string, unknown>): Record<string, unknown> | undefined => {
  const kept: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) if (!MAP_KEYS.has(key)) kept[key] = entry;
  return Object.keys(kept).length ? kept : undefined;
};

// A map as it goes into a file: its own fields, with anything a newer build left behind put back
// where it was found.
export function mapPayload(data: MapData): Record<string, unknown> {
  const { unknown, ...rest } = data;
  return { ...rest, ...(unknown ?? {}) };
}

// A network file carries the styles its own objects point at, so it can be read into any map.
export function networkPayload(data: MapData): Record<string, unknown> {
  const stopTypes = new Set(data.stops.map((stop) => stop.type));
  const wagonStyles = new Set(data.routes.map((route) => route.wagonStyle).filter(Boolean) as string[]);
  const lineStyles = new Set(data.routes.map((route) => route.lineStyle).filter(Boolean) as string[]);
  const routeTypes = new Set(data.routes.map((route) => route.type));
  return {
    format: data.format,
    ...(data.orientation === "portrait" ? { orientation: "portrait" } : {}),
    stops: data.stops,
    routes: data.routes,
    tickets: data.tickets,
    stopTypeStyles: data.stopTypeStyles.filter((style) => stopTypes.has(style.id)),
    routeTypeStyles: data.routeTypeStyles.filter((style) => routeTypes.has(style.id)),
    wagonStyles: (data.wagonStyles ?? []).filter((style) => wagonStyles.has(style.id)),
    lineStyles: data.lineStyles.filter((style) => lineStyles.has(style.id)),
  };
}

// File version 3 folded wagon styles and line styles into route types: a type now describes the
// whole route. A map written before that keeps its look by getting one route type per combination
// it actually used, cloned from the base type and carrying the shape and line it had.
function mergeStylesIntoRouteTypes(value: Partial<MapData> & { wagonStyles?: WagonStyle[]; lineStyles?: LineStyle[] }): Partial<MapData> {
  const routes = Array.isArray(value.routes) ? value.routes : [];
  if (!routes.some((route) => route.wagonStyle || route.lineStyle)) return value;

  const types = [...(Array.isArray(value.routeTypeStyles) ? value.routeTypeStyles : [])];
  const wagons = Array.isArray(value.wagonStyles) ? value.wagonStyles : [];
  const lines = Array.isArray(value.lineStyles) ? value.lineStyles : [];
  const made = new Map<string, string>();

  const migrated = routes.map((route) => {
    if (!route.wagonStyle && !route.lineStyle) return route;
    const key = `${route.type}|${route.wagonStyle ?? ""}|${route.lineStyle ?? ""}`;
    let id = made.get(key);
    if (!id) {
      const base = types.find((type) => type.id === route.type);
      const wagon = wagons.find((style) => style.id === route.wagonStyle);
      const line = lines.find((style) => style.id === route.lineStyle);
      const parts = [wagon?.label, line?.label].filter(Boolean).join(", ");
      id = `${route.type}-${[route.wagonStyle, route.lineStyle].filter(Boolean).join("-")}`;
      types.push({
        id,
        label: base ? `${base.label}${parts ? ` (${parts})` : ""}` : id,
        stroke: base?.stroke ?? "#736d64",
        dash: line?.dash ?? base?.dash ?? "",
        strokeWidth: line?.strokeWidth ?? base?.strokeWidth ?? 3,
        infrastructure: base?.infrastructure ?? false,
        shape: wagon?.shape ?? base?.shape ?? "plain",
        glyph: wagon?.glyph ?? base?.glyph,
      });
      made.set(key, id);
    }
    const { wagonStyle, lineStyle, ...rest } = route;
    void wagonStyle; void lineStyle;
    return { ...rest, type: id };
  });

  return { ...value, routes: migrated, routeTypeStyles: types };
}

// A map's own deck rules, each checked value by value: a set with anything the suggester cannot use
// is dropped whole rather than half-applied, and a choice that names no set falls back to ours.
const share = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const validRuleSet = (value: unknown): value is DeckRuleSet => {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<DeckRuleSet>;
  return typeof v.id === "string" && v.id.length > 0 && typeof v.label === "string"
    && typeof v.ticketsPerStop === "number" && v.ticketsPerStop > 0 && v.ticketsPerStop <= 5
    && typeof v.longPerStop === "number" && v.longPerStop >= 0 && v.longPerStop <= 2
    && Array.isArray(v.bins) && v.bins.length === 5 && v.bins.every(share)
    && (v.longRange === null || (Array.isArray(v.longRange) && v.longRange.length === 2 && v.longRange.every(share) && v.longRange[0] <= v.longRange[1]))
    && (v.bonusFrom === null || share(v.bonusFrom))
    && typeof v.lengthCap === "number" && v.lengthCap > 0 && v.lengthCap <= 1
    && Number.isInteger(v.maxPerStop) && (v.maxPerStop as number) >= 1
    && share(v.dupRate)
    && (v.periphery === "relative" || v.periphery === "point")
    && [v.longEnds, v.shortEnds].every((end) => end === undefined || end === null || (typeof end === "number" && end >= -0.5 && end <= 0.5));
};
const normalizeDeckRules = (value: Partial<MapData>): Pick<MapData, "deckRules" | "deckRule"> => {
  const rules = (Array.isArray(value.deckRules) ? value.deckRules : []).filter(validRuleSet)
    .map((rule) => ({ ...rule, basedOn: typeof rule.basedOn === "string" ? rule.basedOn : "generic" }));
  const known = new Set<string>([...BUILT_IN_DECK_RULES, ...rules.map((rule) => rule.id)]);
  return {
    deckRules: rules.length ? rules : undefined,
    deckRule: typeof value.deckRule === "string" && known.has(value.deckRule) ? value.deckRule : undefined,
  };
};

export const normalizeMap = (raw: Partial<MapData>): MapData => normalizeMapFields(mergeStylesIntoRouteTypes(migrateLegacyFormat(raw)));

const normalizeMapFields = (value: Partial<MapData>): MapData => ({
  name: typeof value.name === "string" ? value.name : "Imported map",
  format: isMapFormat(value.format) ? value.format : "board-2x3",
  // Lying is the default and is not written, so a lying map is the same file it always was.
  ...(value.orientation === "portrait" ? { orientation: "portrait" as const } : {}),
  background: Array.isArray(value.background) ? value.background : [],
  stops: Array.isArray(value.stops) ? value.stops : [],
  routes: Array.isArray(value.routes) ? value.routes.map(migrateRoute) : [],
  notes: Array.isArray(value.notes) ? value.notes : [],
  // The rules text, as written. Nothing, rather than an empty text, when there is none.
  rules: typeof value.rules === "string" && value.rules.trim() ? value.rules : undefined,
  lineStyles: Array.isArray(value.lineStyles) ? value.lineStyles : [],
  routeTypeStyles: Array.isArray(value.routeTypeStyles) && value.routeTypeStyles.length ? value.routeTypeStyles : defaultRouteTypeStyles.map((style) => ({ ...style })),
  wagonStyles: normalizeWagonStyles(value),
  stopTypeStyles: normalizeStopTypeStyles(value),
  tickets: Array.isArray(value.tickets) ? value.tickets : [],
  ticketSets: Array.isArray(value.ticketSets) && value.ticketSets.length ? value.ticketSets : [{ ...defaultTicketSet }],
  backgroundImage: normalizeBackgroundImage(value.backgroundImage),
  // A map written before the setup settings existed opens on the real game's numbers.
  wagonsPerPlayer: countOr(value.wagonsPerPlayer, DEFAULT_WAGONS_PER_PLAYER),
  startingTickets: countOr(value.startingTickets, DEFAULT_STARTING_TICKETS),
  keptTickets: Math.min(countOr(value.keptTickets, DEFAULT_KEPT_TICKETS), countOr(value.startingTickets, DEFAULT_STARTING_TICKETS)),
  players: normalizePlayers(value.players),
  ticketBands: value.ticketBands,
  ticketMix: value.ticketMix,
  ...normalizeDeckRules(value),
  ticketValuation: value.ticketValuation,
  mapVersion: normalizeMapVersion(value.mapVersion),
  unknown: unknownKeys(value as Record<string, unknown>),
});

// A version record is trusted only when it makes sense: a whole number above 0 and a fingerprint.
// Otherwise it is dropped, and the next print starts the series again at 1. Log entries that make no
// sense are left out; anything a later build added, in the record or in an entry, is kept.
const normalizeMapVersion = (value: unknown): MapVersion | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Partial<MapVersion>;
  if (!Number.isInteger(record.number) || (record.number as number) < 1 || typeof record.fingerprint !== "string" || !record.fingerprint) return undefined;
  const issued = (Array.isArray(record.issued) ? record.issued : []).filter((entry): entry is MapVersionEntry => Boolean(entry) && typeof entry === "object" && Number.isInteger((entry as MapVersionEntry).number) && typeof (entry as MapVersionEntry).date === "string" && typeof (entry as MapVersionEntry).by === "string");
  return { ...(record as MapVersion), issued };
};

const normalizePlayers = (value: unknown): PlayerRange | undefined => {
  const range = value as Partial<PlayerRange> | undefined;
  if (!range || typeof range.min !== "number" || typeof range.max !== "number") return undefined;
  return { min: Math.max(1, Math.round(Math.min(range.min, range.max))), max: Math.max(1, Math.round(Math.max(range.min, range.max))) };
};
const countOr = (value: unknown, fallback: number): number => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 1 ? number : fallback;
};
const scalePointToHeight = (point: Point, fromHeight: number, toHeight: number): Point => ({ x: point.x, y: point.y * toHeight / fromHeight });
const scaleBackgroundToHeight = (shapes: BackgroundShape[], fromHeight: number, toHeight: number): BackgroundShape[] => shapes.map((shape) => ({ ...shape, points: shape.points.map((point) => scalePointToHeight(point, fromHeight, toHeight)), labelPoint: shape.labelPoint ? scalePointToHeight(shape.labelPoint, fromHeight, toHeight) : undefined }));
const scaleStopsToHeight = (stops: Stop[], fromHeight: number, toHeight: number): Stop[] => stops.map((stop) => ({ ...stop, ...scalePointToHeight(stop, fromHeight, toHeight) }));
const scaleRoutesToHeight = (routes: Route[], fromHeight: number, toHeight: number): Route[] => routes.map((route) => ({ ...route, points: route.points?.map((point) => scalePointToHeight(point, fromHeight, toHeight)) }));
const scaleImageToHeight = (image: BackgroundImage, fromHeight: number, toHeight: number): BackgroundImage => ({ ...image, y: image.y * toHeight / fromHeight, height: image.height * toHeight / fromHeight });
const scaleNotesToHeight = (notes: NoteBox[], fromHeight: number, toHeight: number): NoteBox[] => notes.map((note) => ({ ...note, y: note.y * toHeight / fromHeight, height: note.height * toHeight / fromHeight }));
const sourceHeight = (value: { format?: unknown }): number => isMapFormat(value.format) ? mapFormats[value.format].height : typeof value.format === "string" && legacyFormats[value.format] ? legacyFormats[value.format].height : mapFormats["board-2x3"].height;
// Content from a file drawn on another board, brought onto this one: laid down if it stood, scaled
// from its board's height to this one's while lying, and stood up again if this board stands.
type BoardContents = Partial<Pick<MapData, "stops" | "routes" | "background" | "notes" | "backgroundImage">>;
function ontoBoard<T extends BoardContents>(value: T, source: { format?: unknown; orientation?: unknown }, to: Pick<Board, "width" | "height">): T {
  const fromHeight = sourceHeight(source);
  let next = value;
  if (source.orientation === "portrait") { const lay = turnBetween({ width: fromHeight, height: W }, "landscape")!; next = turnContents(next, lay.turn, lay.degrees); }
  const toHeight = Math.min(to.width, to.height);
  next = { ...next,
    ...(next.stops ? { stops: scaleStopsToHeight(next.stops, fromHeight, toHeight) } : {}),
    ...(next.routes ? { routes: scaleRoutesToHeight(next.routes, fromHeight, toHeight) } : {}),
    ...(next.background ? { background: scaleBackgroundToHeight(next.background, fromHeight, toHeight) } : {}),
    ...(next.notes ? { notes: scaleNotesToHeight(next.notes, fromHeight, toHeight) } : {}),
    ...(next.backgroundImage ? { backgroundImage: scaleImageToHeight(next.backgroundImage, fromHeight, toHeight) } : {}) };
  if (to.width < to.height) { const stand = turnBetween({ width: W, height: toHeight }, "portrait")!; next = turnContents(next, stand.turn, stand.degrees); }
  return next;
}
export const normalizeBackgroundFile = (value: { format?: unknown; orientation?: unknown; background?: unknown; backgroundImage?: unknown }, to: Pick<Board, "width" | "height">): { background: BackgroundShape[]; backgroundImage?: BackgroundImage } => {
  const image = normalizeBackgroundImage(value.backgroundImage);
  const moved = ontoBoard({ background: Array.isArray(value.background) ? value.background as BackgroundShape[] : [], backgroundImage: image }, value, to);
  return { background: moved.background ?? [], backgroundImage: moved.backgroundImage };
};
// A network file may carry the tickets that belong to its stops, as the official reference maps do.
export const normalizeNetworkFile = (value: { format?: unknown; orientation?: unknown; stops?: unknown; routes?: unknown; lineStyles?: unknown; routeTypeStyles?: unknown; stopTypeStyles?: unknown; wagonStyles?: unknown; tickets?: unknown }, to: Pick<Board, "width" | "height">): { stops: Stop[]; routes: Route[]; lineStyles: LineStyle[]; routeTypeStyles: RouteTypeStyle[]; stopTypeStyles: StopTypeStyle[]; wagonStyles: WagonStyle[]; tickets: Ticket[] } => { const moved = ontoBoard({ stops: Array.isArray(value.stops) ? value.stops as Stop[] : [], routes: Array.isArray(value.routes) ? value.routes as Route[] : [] }, value, to); return { stopTypeStyles: Array.isArray(value.stopTypeStyles) ? value.stopTypeStyles : [], wagonStyles: Array.isArray(value.wagonStyles) ? value.wagonStyles : [], tickets: Array.isArray(value.tickets) ? (value.tickets as Ticket[]).map((ticket, index) => ({ ...ticket, id: ticket.id || `t-import-${index}`, set: undefined })) : [], stops: moved.stops ?? [], routes: moved.routes ?? [], lineStyles: Array.isArray(value.lineStyles) ? value.lineStyles : [], routeTypeStyles: Array.isArray(value.routeTypeStyles) && value.routeTypeStyles.length ? value.routeTypeStyles : defaultRouteTypeStyles.map((style) => ({ ...style })) }; };
// A ticket-only file. Endpoints travel as stop ids *and* stop names, so a deck can be moved to
// another copy of the map where the ids differ but the cities are the same.
export type TicketFile = { kind: "tickets"; map: string; sets: TicketSet[]; tickets: (Ticket & { aName: string; bName: string })[] };

export function buildTicketFile(data: MapData, setIds: string[]): TicketFile {
  const name = (id: string) => data.stops.find((stop) => stop.id === id)?.name ?? "";
  const first = data.ticketSets[0]?.id;
  const sets = data.ticketSets.filter((set) => setIds.includes(set.id));
  return {
    kind: "tickets",
    map: data.name,
    sets: sets.map((set) => ({ ...set })),
    tickets: data.tickets.filter((ticket) => setIds.includes(ticket.set ?? first ?? "")).map((ticket) => ({ ...ticket, set: ticket.set ?? first, aName: name(ticket.a), bName: name(ticket.b) })),
  };
}

// A human-readable stamp for a deck name: when the deck arrived, to the minute.
export function formatStampLabel(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Imported sets always arrive as new sets with fresh ids, so an import can never quietly overwrite
// a deck that is being compared against it. A map always has at least one deck already, so every
// imported deck is stamped with the moment it arrived and can be told apart from the rest.
export function normalizeTicketFile(value: unknown, data: MapData): { sets: TicketSet[]; tickets: Ticket[]; dropped: number } {
  const raw = (value ?? {}) as Partial<TicketFile>;
  const incomingSets = Array.isArray(raw.sets) && raw.sets.length ? raw.sets : [{ ...defaultTicketSet }];
  const incomingTickets = Array.isArray(raw.tickets) ? raw.tickets : [];
  const byId = new Set(data.stops.map((stop) => stop.id));
  const byName = new Map(data.stops.map((stop) => [stop.name.trim().toLowerCase(), stop.id]));
  const resolve = (id: unknown, name: unknown): string | null => {
    if (typeof id === "string" && byId.has(id)) return id;
    if (typeof name === "string") return byName.get(name.trim().toLowerCase()) ?? null;
    return null;
  };
  const usedLabels = new Set(data.ticketSets.map((set) => set.label.toLowerCase()));
  const arrived = formatStampLabel();
  const stamp = Date.now();
  const setIdMap = new Map<string, string>();
  const sets = incomingSets.map((set, index) => {
    let label = `${String(set.label ?? "Imported deck").trim() || "Imported deck"} · ${arrived}`;
    // Two decks in one file can share a name, and two imports can land in the same minute.
    if (usedLabels.has(label.toLowerCase())) { let attempt = 2; while (usedLabels.has(`${label} ${attempt}`.toLowerCase())) attempt += 1; label = `${label} ${attempt}`; }
    usedLabels.add(label.toLowerCase());
    const id = `ts-${stamp}-${index}`;
    setIdMap.set(String(set.id), id);
    return { id, label };
  });
  const fallbackSet = sets[0].id;
  let dropped = 0;
  const tickets: Ticket[] = [];
  incomingTickets.forEach((ticket, index) => {
    const a = resolve(ticket?.a, ticket?.aName);
    const b = resolve(ticket?.b, ticket?.bName);
    if (!a || !b || a === b) { dropped += 1; return; }
    tickets.push({ id: `t-${stamp}-${index}`, a, b, points: Math.max(1, Math.round(Number(ticket?.points) || 1)), long: ticket?.long ? true : undefined, set: setIdMap.get(String(ticket?.set)) ?? fallbackSet });
  });
  return { sets, tickets, dropped };
}

export const readBackgroundImage = (file: File): Promise<{ dataUrl: string; naturalWidth: number; naturalHeight: number }> => new Promise((resolve, reject) => {
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
export function formatTimestamp(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

// Moving a map to another board format keeps x as-is and scales y by the height ratio, so objects
// stay in the same relative positions.
export function rescaleMapToFormat(draft: MapData, nextFormat: MapFormat): MapData {
  // A standing map is laid down, moved to the other board, and stood up again.
  if (draft.orientation === "portrait") return rotateMap(rescaleMapToFormat(rotateMap(draft, "landscape"), nextFormat), "portrait");
  const fromHeight = mapFormats[draft.format].height;
  const toHeight = mapFormats[nextFormat].height;
  draft.stops = scaleStopsToHeight(draft.stops, fromHeight, toHeight);
  draft.routes = scaleRoutesToHeight(draft.routes, fromHeight, toHeight);
  draft.background = scaleBackgroundToHeight(draft.background, fromHeight, toHeight);
  draft.backgroundImage = draft.backgroundImage ? scaleImageToHeight(draft.backgroundImage, fromHeight, toHeight) : draft.backgroundImage;
  draft.notes = scaleNotesToHeight(draft.notes, fromHeight, toHeight);
  draft.format = nextFormat;
  return draft;
}
