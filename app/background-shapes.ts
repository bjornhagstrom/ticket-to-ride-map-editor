// Shapes for the background layer, as the plain polygons the file has always held: a rectangle is four corners, a circle is a ring of points, so every build draws them
// and the points can be dragged one by one afterwards. Moving and sizing work on any shape, drawn by hand or not.
import type { BackgroundShape, Point } from "./map-data";

/** The corners of the rectangle between two points, clockwise from the top left. */
export function rectanglePoints(a: Point, b: Point): Point[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

export const CIRCLE_POINTS = 32;
/** A ring of points round `centre`, `edge` being one of them (the pointer, when it is drawn by dragging out from the middle). */
export function circlePoints(centre: Point, edge: Point, count = CIRCLE_POINTS): Point[] {
  const radius = Math.hypot(edge.x - centre.x, edge.y - centre.y);
  const start = Math.atan2(edge.y - centre.y, edge.x - centre.x);
  return Array.from({ length: count }, (_, i) => ({ x: round(centre.x + radius * Math.cos(start + 2 * Math.PI * i / count)), y: round(centre.y + radius * Math.sin(start + 2 * Math.PI * i / count)) }));
}
const round = (value: number) => Math.round(value * 100) / 100;

/** What a drag from `start` to `end` draws, or null when it is too small to be a shape (a click, a slip of the hand). */
export function dragShape(kind: "rectangle" | "circle", start: Point, end: Point): Point[] | null {
  if (kind === "rectangle") return Math.abs(end.x - start.x) < 8 || Math.abs(end.y - start.y) < 8 ? null : rectanglePoints(start, end);
  return Math.hypot(end.x - start.x, end.y - start.y) < 8 ? null : circlePoints(start, end);
}

/** The shape moved by (dx, dy), its label with it. */
export function translateShape<T extends Pick<BackgroundShape, "points" | "labelPoint">>(shape: T, dx: number, dy: number): T {
  const move = (point: Point): Point => ({ x: point.x + dx, y: point.y + dy });
  return { ...shape, points: shape.points.map(move), ...(shape.labelPoint ? { labelPoint: move(shape.labelPoint) } : {}) };
}

/** The middle of the box round the shape's points. */
export function shapeCentre(points: Point[]): Point {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** The shape made `factor` times as large round the middle of its box, its label with it. */
export function scaleShape<T extends Pick<BackgroundShape, "points" | "labelPoint">>(shape: T, factor: number): T {
  if (!shape.points.length) return shape;
  const centre = shapeCentre(shape.points);
  const grow = (point: Point): Point => ({ x: centre.x + (point.x - centre.x) * factor, y: centre.y + (point.y - centre.y) * factor });
  return { ...shape, points: shape.points.map(grow), ...(shape.labelPoint ? { labelPoint: grow(shape.labelPoint) } : {}) };
}

/** One step of Larger and Smaller: a tenth, so that one of each puts it back (to the rounding of the file). */
export const SIZE_STEP = 1.1;
