// Loading, saving and reshaping map files: local-storage keys, the normalizers that let older
// files open, board-format rescaling, and image reading.
import { defaultRouteTypeStyles, type LineStyle, type RouteTypeStyle, type BackgroundImage, type BackgroundShape, type ImageCrop, mapFormats, type MapData, type MapFormat, type NoteBox, type Point, type Route, type Stop, STORAGE_KEY } from "./map-data";

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
export const normalizeMap = (value: Partial<MapData>): MapData => ({
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
export const normalizeBackgroundFile = (value: { format?: unknown; background?: unknown; backgroundImage?: unknown }, toHeight: number): { background: BackgroundShape[]; backgroundImage?: BackgroundImage } => {
  const fromHeight = sourceHeight(value);
  const image = normalizeBackgroundImage(value.backgroundImage);
  return { background: scaleBackgroundToHeight(Array.isArray(value.background) ? value.background : [], fromHeight, toHeight), backgroundImage: image ? scaleImageToHeight(image, fromHeight, toHeight) : undefined };
};
export const normalizeNetworkFile = (value: { format?: unknown; stops?: unknown; routes?: unknown; lineStyles?: unknown; routeTypeStyles?: unknown }, toHeight: number): { stops: Stop[]; routes: Route[]; lineStyles: LineStyle[]; routeTypeStyles: RouteTypeStyle[] } => { const fromHeight = sourceHeight(value); return { stops: scaleStopsToHeight(Array.isArray(value.stops) ? value.stops : [], fromHeight, toHeight), routes: scaleRoutesToHeight(Array.isArray(value.routes) ? value.routes : [], fromHeight, toHeight), lineStyles: Array.isArray(value.lineStyles) ? value.lineStyles : [], routeTypeStyles: Array.isArray(value.routeTypeStyles) && value.routeTypeStyles.length ? value.routeTypeStyles : defaultRouteTypeStyles.map((style) => ({ ...style })) }; };
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
