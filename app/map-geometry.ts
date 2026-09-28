// Pure geometry for the map: where a route's line runs, where its wagon spaces sit, and the
// primitives the analysis layer builds on. Nothing here touches React or the DOM.
import { PARALLEL_SPACING_MM, PARALLEL_SPACING_STYLED_MM, REFERENCE_BOARD_MM, type BackgroundShape, type MapData, type Point, type Route, W } from "./map-data";

export const stopById = (data: MapData, id: string) => data.stops.find((stop) => stop.id === id);
export const pointsFor = (data: MapData, route: Route): Point[] => {
  const a = stopById(data, route.a);
  const b = stopById(data, route.b);
  return a && b ? [a, ...(route.points ?? []), b] : [];
};
export const pathFromPoints = (points: Point[]) => points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
// A Catmull-Rom spline through every point, written out as cubic Béziers. The curve passes through
// each bend point, so dragging one still does exactly what it looks like it does.
const curveControls = (points: Point[], index: number) => {
  const p0 = points[index - 1] ?? points[index];
  const p1 = points[index];
  const p2 = points[index + 1];
  const p3 = points[index + 2] ?? p2;
  return {
    p1, p2,
    c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
    c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
  };
};
export const curvedPath = (points: Point[]) => {
  if (points.length < 3) return pathFromPoints(points);
  let path = `M${points[0].x},${points[0].y}`;
  for (let index = 0; index < points.length - 1; index++) {
    const { c1, c2, p2 } = curveControls(points, index);
    path += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  }
  return path;
};
// Flatten the same curve into a dense polyline, so wagon slots and their angles follow the drawn
// line instead of the straight polyline underneath it.
export const curvedSamples = (points: Point[], perSegment = 12): Point[] => {
  if (points.length < 3) return points;
  const samples: Point[] = [points[0]];
  for (let index = 0; index < points.length - 1; index++) {
    const { p1, c1, c2, p2 } = curveControls(points, index);
    for (let step = 1; step <= perSegment; step++) {
      const t = step / perSegment, u = 1 - t;
      samples.push({
        x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
        y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y,
      });
    }
  }
  return samples;
};

// A route curves unless it has been explicitly straightened. The field is left unset for the
// common case, so `undefined` has to mean curved rather than straight.
export const isCurved = (route: Route) => route.curved !== false;
export const samePair = (one: Route, other: Route) => (one.a === other.a && one.b === other.b) || (one.a === other.b && one.b === other.a);
// How far to the side of the centre line this route is actually drawn. Zero unless it is one of
// several routes between the same two stops. Editing handles need it so they land beside the line
// the user can see rather than beside the invisible centre line.
export function parallelOffset(data: MapData, route: Route): number {
  const siblings = data.routes.filter((item) => samePair(item, route));
  if (siblings.length < 2) return 0;
  const styled = siblings.some((item) => {
    const style = item.wagonStyle ? data.wagonStyles?.find((entry) => entry.id === item.wagonStyle) : undefined;
    return style && style.shape !== "plain";
  });
  const spacing = styled ? PARALLEL_SPACING_STYLED_MM : PARALLEL_SPACING_MM;
  const index = siblings.findIndex((item) => item.id === route.id);
  const direction = route.a.localeCompare(route.b) <= 0 ? 1 : -1;
  return (index - (siblings.length - 1) / 2) * (spacing / (REFERENCE_BOARD_MM / W)) * direction;
}
export function parallelPoints(data: MapData, route: Route): Point[] {
  const points = pointsFor(data, route);
  const offset = parallelOffset(data, route);
  if (!offset || points.length < 2) return points;
  const shifted = (point: Point, from: Point, to: Point, distance: number) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: point.x - dy / length * distance, y: point.y + dx / length * distance };
  };
  // Every point moves sideways, bends included, so the lines of a double route follow each other
  // instead of meeting in the middle. Two siblings sharing the same bend points then run exactly
  // parallel; give one its own bends and they part company where you put them.
  const sideways = points.map((point, i) => shifted(point, points[i === 0 ? 0 : i - 1], points[i === points.length - 1 ? i : i + 1], offset));
  // Both lines still have to reach the same two stops, so they converge over a short run-in at
  // each end rather than along the whole first and last segment.
  const runIn = (from: Point, to: Point) => {
    const distance = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const t = Math.min(.35, Math.abs(offset) * 1.4 / distance);
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  };
  const last = points.length - 1;
  return [points[0], runIn(sideways[0], sideways[1]), ...sideways.slice(1, last), runIn(sideways[last], sideways[last - 1]), points[last]];
}

// How much room each route actually gives its wagons, against how much a real set needs. A route
// drawn much longer than its wagon count looks roomier on screen than the finished board plays;
// one drawn shorter cannot physically hold its own wagons.
export const orient = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export const intersects = (a: Point, b: Point, c: Point, d: Point) => {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
};
export function pointAlong(points: Point[], fraction: number): Point & { angle: number } {
  const lengths = points.slice(1).map((q, i) => Math.hypot(q.x - points[i].x, q.y - points[i].y));
  const total = lengths.reduce((a, b) => a + b, 0);
  let target = total * fraction;
  for (let i = 0; i < lengths.length; i++) {
    if (target <= lengths[i]) {
      const t = lengths[i] ? target / lengths[i] : 0;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t, angle: Math.atan2(points[i + 1].y - points[i].y, points[i + 1].x - points[i].x) * 180 / Math.PI };
    }
    target -= lengths[i];
  }
  return { ...(points.at(-1) ?? { x: 0, y: 0 }), angle: 0 };
}
export const polylineLength = (points: Point[]) => points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
// Where the pointer is in map units, kept a margin inside the board. Placing an object puts it where
// the pointer is, so this keeps a new stop or note from landing half off the edge.
export function canvasPoint(svg: SVGSVGElement, clientX: number, clientY: number, height: number): Point {
  const raw = canvasPointRaw(svg, clientX, clientY, height);
  return { x: Math.max(18, Math.min(W - 18, raw.x)), y: Math.max(18, Math.min(height - 18, raw.y)) };
}
// The same point without that margin. Dragging something by the spot you grabbed it needs it: with
// the pointer held a margin inside the board, an object can never be pushed flush to an edge.
export function canvasPointRaw(svg: SVGSVGElement, clientX: number, clientY: number, height: number): Point {
  const rect = svg.getBoundingClientRect();
  return { x: (clientX - rect.left) * W / rect.width, y: (clientY - rect.top) * height / rect.height };
}
export function automaticLabelPoint(shape: BackgroundShape, height: number): Point {
  if (!shape.points.length) return { x: W / 2, y: height / 2 };
  return {
    x: shape.points.reduce((sum, point) => sum + point.x, 0) / shape.points.length,
    y: shape.points.reduce((sum, point) => sum + point.y, 0) / shape.points.length,
  };
}

