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

/** Where a new point goes when `active` is the marked one: beside it, on the side of the neighbour the click is nearer. The end of a line goes on beyond the end; with no neighbour on one side
 *  (a line's end) or one only (two points) there is no choice. Returns the points with the new one in and the new one's place. */
export function insertNextTo(points: Point[], active: number, click: Point, closed: boolean): { points: Point[]; index: number } {
  const n = points.length;
  const put = (at: number) => ({ points: [...points.slice(0, at), click, ...points.slice(at)], index: at });
  if (n === 0) return put(0);
  const a = Math.max(0, Math.min(n - 1, active));
  const hasPrev = closed ? n > 2 : a > 0, hasNext = closed ? n > 1 : a < n - 1;
  const prev = closed ? (a - 1 + n) % n : a - 1, next = closed ? (a + 1) % n : a + 1;
  if (!hasNext) return put(a + 1);
  if (!hasPrev) return a === 0 && !closed ? put(0) : put(a + 1);
  const toPrev = Math.hypot(click.x - points[prev].x, click.y - points[prev].y), toNext = Math.hypot(click.x - points[next].x, click.y - points[next].y);
  if (toNext <= toPrev) return put(a + 1);
  return put(a === 0 && closed ? n : a);
}

/** The topmost shape under a point (areas by their inside and their edge, lines by their stroke, labels by their box), for a Shift-click where the shapes themselves take no clicks. */
export function shapeAt(shapes: BackgroundShape[], point: Point): BackgroundShape | null {
  const nearSegment = (a: Point, b: Point, reach: number) => {
    const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len));
    return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)) <= reach;
  };
  for (let i = shapes.length - 1; i >= 0; i -= 1) {
    const shape = shapes[i], pts = shape.points;
    if (!pts.length) continue;
    if (shape.type === "label") { if (Math.abs(point.x - pts[0].x - 40) <= 60 && Math.abs(point.y - pts[0].y + 12) <= 16) return shape; continue; }
    if (shape.type === "line") { if (pts.some((q, k) => k > 0 && nearSegment(pts[k - 1], q, 10))) return shape; continue; }
    let inside = false;
    for (let k = 0, m = pts.length - 1; k < pts.length; m = k, k += 1) {
      if ((pts[k].y > point.y) !== (pts[m].y > point.y) && point.x < (pts[m].x - pts[k].x) * (point.y - pts[k].y) / (pts[m].y - pts[k].y) + pts[k].x) inside = !inside;
    }
    if (inside || pts.some((q, k) => nearSegment(q, pts[(k + 1) % pts.length], 8))) return shape;
  }
  return null;
}
