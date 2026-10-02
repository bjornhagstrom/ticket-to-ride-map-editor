// The board a map is drawn on: its format (2×3 or 2×4 panels) and whether it lies or stands. Its long
// side is always W map units, so a standing board is the lying one turned a quarter turn, and turning
// a map moves everything on it without changing one distance: wagons, spacing and every analysis stay
// as they were. A map without an orientation lies, as every map did before boards could stand.
import { mapFormats, type BackgroundImage, type MapData, type MapFormat, type NoteBox, type Point } from "./map-data";

export type Orientation = "landscape" | "portrait";
export type Board = { format: MapFormat; orientation: Orientation; label: string; width: number; height: number; widthMm: number; heightMm: number; columns: number; rows: number };

export const orientationLabels: Record<Orientation, string> = { landscape: "Landscape (lying)", portrait: "Portrait (standing)" };

export function orientationOf(data: { orientation?: unknown }): Orientation {
  return data.orientation === "portrait" ? "portrait" : "landscape";
}

export function boardOf(data: { format: MapFormat; orientation?: unknown }): Board {
  const format = mapFormats[data.format] ? data.format : "board-2x3";
  const lying = mapFormats[format];
  const orientation = orientationOf(data);
  if (orientation === "landscape") return { format, orientation, label: lying.shortLabel, width: lying.width, height: lying.height, widthMm: lying.widthMm, heightMm: lying.heightMm, columns: lying.columns, rows: lying.rows };
  return { format, orientation, label: `${lying.shortLabel}, standing`, width: lying.height, height: lying.width, widthMm: lying.heightMm, heightMm: lying.widthMm, columns: lying.rows, rows: lying.columns };
}

// A quarter turn clockwise stands a lying board up: (x, y) on a board `height` tall goes to
// (height − y, x). Anticlockwise lays a standing one down: (x, y) on a board `width` wide goes to
// (y, width − x). One undoes the other exactly.
type Turn = (point: Point) => Point;
const clockwise = (fromHeight: number): Turn => (p) => ({ x: fromHeight - p.y, y: p.x });
const anticlockwise = (fromWidth: number): Turn => (p) => ({ x: p.y, y: fromWidth - p.x });

/** The turn that takes coordinates on `from` to the same board standing or lying as `to` says. */
export function turnBetween(from: { width: number; height: number }, to: Orientation): { turn: Turn; degrees: number } | null {
  const lies = from.width >= from.height;
  if ((to === "landscape") === lies) return null;
  return lies ? { turn: clockwise(from.height), degrees: 90 } : { turn: anticlockwise(from.width), degrees: -90 };
}

const angle = (value: number, by: number) => ((value + by) % 360 + 360) % 360;
const movePoint = <T extends Point>(p: T, turn: Turn): T => ({ ...p, ...turn(p) });
// A box keeps its size and stays upright (a note is read, not turned); its middle moves with the turn.
const moveBox = <T extends { x: number; y: number; width: number; height: number }>(box: T, turn: Turn): T => {
  const middle = turn({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  return { ...box, x: middle.x - box.width / 2, y: middle.y - box.height / 2 };
};

/** Everything on a board, turned with it: stops and the angles their names were set at, route bends,
 *  background shapes, notes (upright), and the background image (turned with the map). */
export function turnContents<T extends Partial<Pick<MapData, "stops" | "routes" | "background" | "notes" | "backgroundImage">>>(value: T, turn: Turn, degrees: number): T {
  const next = { ...value };
  if (Array.isArray(value.stops)) next.stops = value.stops.map((stop) => ({ ...movePoint(stop, turn), labelAngle: stop.labelAngle === undefined ? undefined : angle(stop.labelAngle, degrees) }));
  if (Array.isArray(value.routes)) next.routes = value.routes.map((route) => (route.points ? { ...route, points: route.points.map((p) => movePoint(p, turn)) } : route));
  if (Array.isArray(value.background)) next.background = value.background.map((shape) => ({ ...shape, points: shape.points.map((p) => movePoint(p, turn)), labelPoint: shape.labelPoint ? movePoint(shape.labelPoint, turn) : shape.labelPoint }));
  if (Array.isArray(value.notes)) next.notes = value.notes.map((note: NoteBox) => moveBox(note, turn));
  if (value.backgroundImage) { const image: BackgroundImage = value.backgroundImage; next.backgroundImage = { ...moveBox(image, turn), rotation: angle(image.rotation ?? 0, degrees) }; }
  return next;
}

/** The map on its board lying or standing, everything on it turned with it. Turning a map to the way
 *  it already lies changes nothing. */
export function rotateMap(data: MapData, to: Orientation): MapData {
  const between = turnBetween(boardOf(data), to);
  if (!between) return data;
  const turned = turnContents(data, between.turn, between.degrees);
  if (to === "portrait") turned.orientation = "portrait"; else delete turned.orientation;
  // A note is not turned, so one in a corner can be pushed past the edge: keep it on the board.
  const board = boardOf(turned);
  turned.notes = turned.notes.map((note) => ({ ...note, x: Math.max(0, Math.min(board.width - note.width, note.x)), y: Math.max(0, Math.min(board.height - note.height, note.y)) }));
  return turned;
}
