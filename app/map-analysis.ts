// The balance layer: everything derived from the stops and routes themselves. All of it is pure,
// computed on demand from MapData, and none of it is stored in a map file.
import { defaultLabelAngle, stopSizeMeta, ticketsInSet, type MapData, type Ticket, type Point, realWagon, type Route, routeColors, type Stop, W } from "./map-data";
import { curvedSamples, isCurved, intersects, parallelPoints, pointsFor, polylineLength, stopById } from "./map-geometry";

export type RouteSpacing = { route: Route; drawnMm: number; neededMm: number; ratio: number; verdict: "short" | "long" | "ok" };
const SPACING_SHORT = .85, SPACING_LONG = 1.35;
export function routeSpacing(data: MapData, scaleWidthMm: number): RouteSpacing[] {
  const unitMm = scaleWidthMm / W;
  const pitchMm = realWagon.length + realWagon.gap;
  const infrastructureTypes = new Set(data.routeTypeStyles.filter((style) => style.infrastructure).map((style) => style.id));
  return data.routes.filter((route) => !infrastructureTypes.has(route.type)).map((route) => {
    const geometry = parallelPoints(data, route);
    const points = isCurved(route) && geometry.length > 2 ? curvedSamples(geometry) : geometry;
    const drawnMm = (polylineLength(points) || 1) * unitMm;
    const neededMm = route.length * pitchMm + realWagon.endMargin;
    const ratio = drawnMm / neededMm;
    return { route, drawnMm, neededMm, ratio, verdict: ratio < SPACING_SHORT ? "short" : ratio > SPACING_LONG ? "long" : "ok" } as RouteSpacing;
  });
}
export function crossingPairs(data: MapData) {
  const infrastructureTypes = new Set(data.routeTypeStyles.filter((style) => style.infrastructure).map((style) => style.id));
  const routes = data.routes.filter((route) => !infrastructureTypes.has(route.type));
  const found: Array<[Route, Route]> = [];
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
    const a = routes[i], b = routes[j];
    if ([a.a, a.b].some((id) => id === b.a || id === b.b)) continue;
    const ap = pointsFor(data, a), bp = pointsFor(data, b);
    let hit = false;
    for (let x = 0; x < ap.length - 1 && !hit; x++) for (let y = 0; y < bp.length - 1; y++) if (intersects(ap[x], ap[x + 1], bp[y], bp[y + 1])) { hit = true; break; }
    if (hit) found.push([a, b]);
  }
  return found;
}
export type NetworkEdge = { to: string; weight: number; routeId: string };
export function buildAdjacency(data: MapData): Map<string, NetworkEdge[]> {
  const adjacency = new Map<string, NetworkEdge[]>();
  for (const stop of data.stops) adjacency.set(stop.id, []);
  for (const route of data.routes) {
    if (!adjacency.has(route.a) || !adjacency.has(route.b)) continue;
    adjacency.get(route.a)!.push({ to: route.b, weight: route.length, routeId: route.id });
    adjacency.get(route.b)!.push({ to: route.a, weight: route.length, routeId: route.id });
  }
  return adjacency;
}
export type NetworkStats = { neighbours: Map<string, number>; links: Map<string, number>; hubDegree: Map<string, number> };
export function networkStats(data: MapData): NetworkStats {
  const neighbourSets = new Map<string, Set<string>>();
  const links = new Map<string, number>();
  for (const stop of data.stops) { neighbourSets.set(stop.id, new Set()); links.set(stop.id, 0); }
  for (const route of data.routes) {
    if (!neighbourSets.has(route.a) || !neighbourSets.has(route.b)) continue;
    neighbourSets.get(route.a)!.add(route.b);
    neighbourSets.get(route.b)!.add(route.a);
    links.set(route.a, (links.get(route.a) ?? 0) + 1);
    links.set(route.b, (links.get(route.b) ?? 0) + 1);
  }
  const neighbours = new Map<string, number>();
  const hubDegree = new Map<string, number>();
  for (const stop of data.stops) {
    const n = neighbourSets.get(stop.id)!.size;
    const l = links.get(stop.id) ?? 0;
    neighbours.set(stop.id, n);
    hubDegree.set(stop.id, n + l);
  }
  return { neighbours, links, hubDegree };
}
export function shortestPath(adjacency: Map<string, NetworkEdge[]>, fromId: string, toId: string): { distance: number; routeIds: string[] } | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, { stopId: string; routeId: string }>();
  const visited = new Set<string>();
  for (const id of adjacency.keys()) dist.set(id, Infinity);
  if (!dist.has(fromId)) return null;
  dist.set(fromId, 0);
  for (;;) {
    let current: string | null = null;
    let currentDist = Infinity;
    for (const [id, d] of dist) if (!visited.has(id) && d < currentDist) { current = id; currentDist = d; }
    if (current === null || current === toId) break;
    visited.add(current);
    for (const edge of adjacency.get(current) ?? []) {
      if (visited.has(edge.to)) continue;
      const next = currentDist + edge.weight;
      if (next < (dist.get(edge.to) ?? Infinity)) { dist.set(edge.to, next); prev.set(edge.to, { stopId: current, routeId: edge.routeId }); }
    }
  }
  const total = dist.get(toId);
  if (total === undefined || total === Infinity) return null;
  const routeIds: string[] = [];
  let cursor = toId;
  while (cursor !== fromId) {
    const step = prev.get(cursor);
    if (!step) return null;
    routeIds.unshift(step.routeId);
    cursor = step.stopId;
  }
  return { distance: total, routeIds };
}
export type ColourLengthTable = { lengths: number[]; colours: string[]; counts: Map<number, Map<string, number>>; colourTotals: Map<string, number>; lengthTotals: Map<number, number>; grandTotal: number };
export function colourLengthTable(data: MapData): ColourLengthTable {
  const infrastructureTypes = new Set(data.routeTypeStyles.filter((style) => style.infrastructure).map((style) => style.id));
  const cardRoutes = data.routes.filter((route) => !infrastructureTypes.has(route.type));
  const colours = Object.keys(routeColors);
  const lengths = Array.from(new Set(cardRoutes.map((route) => route.length))).sort((a, b) => a - b);
  const counts = new Map<number, Map<string, number>>();
  const colourTotals = new Map<string, number>(colours.map((c) => [c, 0]));
  const lengthTotals = new Map<number, number>(lengths.map((l) => [l, 0]));
  for (const length of lengths) counts.set(length, new Map(colours.map((c) => [c, 0])));
  for (const route of cardRoutes) {
    const row = counts.get(route.length);
    if (!row) continue;
    row.set(route.color, (row.get(route.color) ?? 0) + 1);
    colourTotals.set(route.color, (colourTotals.get(route.color) ?? 0) + 1);
    lengthTotals.set(route.length, (lengthTotals.get(route.length) ?? 0) + 1);
  }
  return { lengths, colours, counts, colourTotals, lengthTotals, grandTotal: cardRoutes.length };
}
const pairKey = (a: string, b: string) => [a, b].sort().join("::");
export function averageLengthPerDistance(data: MapData): number {
  let totalLength = 0, totalDistance = 0;
  for (const route of data.routes) {
    const a = stopById(data, route.a), b = stopById(data, route.b);
    if (!a || !b) continue;
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    if (distance > 0) { totalLength += route.length; totalDistance += distance; }
  }
  return totalDistance > 0 ? totalLength / totalDistance : 0.01;
}
export function leastUsedColourAtLength(table: ColourLengthTable, length: number): string {
  const row = table.counts.get(length);
  let best = table.colours[0] ?? "neutral", bestCount = Infinity;
  for (const colour of table.colours) {
    const count = row?.get(colour) ?? 0;
    if (count < bestCount) { bestCount = count; best = colour; }
  }
  return best;
}
export function routeCrossesExisting(data: MapData, a: Point, b: Point, excludeStopIds: [string, string]): boolean {
  for (const route of data.routes) {
    if (excludeStopIds.includes(route.a) || excludeStopIds.includes(route.b)) continue;
    const points = pointsFor(data, route);
    for (let i = 0; i < points.length - 1; i++) if (intersects(a, b, points[i], points[i + 1])) return true;
  }
  return false;
}
export type RouteSuggestion = { a: string; b: string; aName: string; bName: string; distance: number; suggestedLength: number; suggestedColor: string; hubSum: number };
export function suggestRoutes(data: MapData, stats: NetworkStats, colourTable: ColourLengthTable, k = 5, maxSuggestions = 8): RouteSuggestion[] {
  const existingPairs = new Set(data.routes.map((route) => pairKey(route.a, route.b)));
  const seen = new Set<string>();
  const candidates: Array<{ a: Stop; b: Stop; distance: number }> = [];
  for (const stop of data.stops) {
    const nearest = data.stops
      .filter((other) => other.id !== stop.id)
      .map((other) => ({ other, distance: Math.hypot(other.x - stop.x, other.y - stop.y) }))
      .sort((x, y) => x.distance - y.distance)
      .slice(0, k);
    for (const { other, distance } of nearest) {
      const key = pairKey(stop.id, other.id);
      if (existingPairs.has(key) || seen.has(key)) continue;
      seen.add(key);
      candidates.push({ a: stop, b: other, distance });
    }
  }
  const lengthPerUnit = averageLengthPerDistance(data);
  const scored = candidates
    .filter((candidate) => !routeCrossesExisting(data, candidate.a, candidate.b, [candidate.a.id, candidate.b.id]))
    .map((candidate) => {
      const suggestedLength = Math.max(1, Math.min(8, Math.round(candidate.distance * lengthPerUnit) || 1));
      return {
        a: candidate.a.id, b: candidate.b.id, aName: candidate.a.name, bName: candidate.b.name,
        distance: candidate.distance, suggestedLength, suggestedColor: leastUsedColourAtLength(colourTable, suggestedLength),
        hubSum: (stats.hubDegree.get(candidate.a.id) ?? 0) + (stats.hubDegree.get(candidate.b.id) ?? 0),
      };
    });
  scored.sort((x, y) => x.hubSum - y.hubSum || x.distance - y.distance);
  return scored.slice(0, maxSuggestions);
}

// --- Stop-name placement -------------------------------------------------------------------
// Whether a stop's name covers a route, and which bearings would keep it clear. Text width is
// estimated from the character count rather than measured in the DOM, so this layer stays pure;
// it is a warning aid, not a typesetter, and errs slightly wide.
const LABEL_CHAR_WIDTH = 6.2, LABEL_HEIGHT = 12, LABEL_PAD = 2;

const labelBox = (stop: Stop, angle: number, radius: number) => {
  const width = Math.max(1, stop.name.length) * LABEL_CHAR_WIDTH;
  const rad = angle * Math.PI / 180, distance = radius + 9;
  const dx = Math.cos(rad) * distance, dy = Math.sin(rad) * distance;
  const left = dx < -1 ? stop.x + dx - width : dx > 1 ? stop.x + dx : stop.x + dx - width / 2;
  const top = dy < -3 ? stop.y + dy - LABEL_HEIGHT : dy > 3 ? stop.y + dy : stop.y + dy - LABEL_HEIGHT / 2;
  return { left: left - LABEL_PAD, top: top - LABEL_PAD, right: left + width + LABEL_PAD, bottom: top + LABEL_HEIGHT + LABEL_PAD };
};

export function routeSamplePoints(data: MapData): Point[] {
  const points: Point[] = [];
  for (const route of data.routes) {
    const geometry = parallelPoints(data, route);
    const drawn = isCurved(route) && geometry.length > 2 ? curvedSamples(geometry) : geometry;
    for (let i = 0; i < drawn.length - 1; i++) {
      const a = drawn[i], b = drawn[i + 1];
      const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
      for (let step = 0; step <= steps; step++) points.push({ x: a.x + (b.x - a.x) * step / steps, y: a.y + (b.y - a.y) * step / steps });
    }
  }
  return points;
}

const overlapCount = (box: ReturnType<typeof labelBox>, samples: Point[]) =>
  samples.reduce((count, point) => count + (point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom ? 1 : 0), 0);

export const labelAngleOf = (stop: Stop) => stop.labelAngle ?? defaultLabelAngle(stop);

export function labelCovers(data: MapData, stop: Stop, samples: Point[]): boolean {
  const radius = stopSizeMeta[stop.size ?? "medium"].radius;
  return overlapCount(labelBox(stop, labelAngleOf(stop), radius), samples) > 0;
}

// Every bearing, with how much of a route each one would sit on. The caller picks the first clear
// one, or the least bad when the stop is so hemmed in that nothing is clear.
export function labelAngleOptions(data: MapData, stop: Stop, samples: Point[]): { angle: number; overlap: number }[] {
  const radius = stopSizeMeta[stop.size ?? "medium"].radius;
  const options = [];
  for (let angle = 0; angle < 360; angle += 15) options.push({ angle, overlap: overlapCount(labelBox(stop, angle, radius), samples) });
  return options;
}

type Box = ReturnType<typeof labelBox>;
const boxesOverlap = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const bearingGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// Try to turn every name clear of the routes, and of the names already placed. Stops with the
// fewest clear bearings go first so the hemmed-in ones get the good spots, and a name that is
// already fine stays where it is. Whatever cannot be placed is reported rather than shuffled.
export function autoPlaceLabels(data: MapData): { placed: Map<string, number>; unresolved: string[] } {
  const samples = routeSamplePoints(data);
  const radiusOf = (stop: Stop) => stopSizeMeta[stop.size ?? "medium"].radius;
  const scored = data.stops.map((stop) => ({ stop, options: labelAngleOptions(data, stop, samples) }));
  scored.sort((a, b) => a.options.filter((o) => !o.overlap).length - b.options.filter((o) => !o.overlap).length);
  const taken: Box[] = [];
  const placed = new Map<string, number>();
  const unresolved: string[] = [];
  for (const { stop, options } of scored) {
    const current = labelAngleOf(stop);
    const free = options.filter((option) => option.overlap === 0)
      .sort((a, b) => bearingGap(a.angle, current) - bearingGap(b.angle, current));
    const choice = free.find((option) => !taken.some((box) => boxesOverlap(box, labelBox(stop, option.angle, radiusOf(stop)))));
    if (choice) {
      taken.push(labelBox(stop, choice.angle, radiusOf(stop)));
      if (choice.angle !== current) placed.set(stop.id, choice.angle);
      continue;
    }
    taken.push(labelBox(stop, current, radiusOf(stop)));
    if (labelCovers(data, stop, samples)) unresolved.push(stop.id);
  }
  return { placed, unresolved };
}

export function coveredLabels(data: MapData): Stop[] {
  const samples = routeSamplePoints(data);
  return data.stops.filter((stop) => labelCovers(data, stop, samples));
}

// --- Destination tickets --------------------------------------------------------------------
// Everything here is derived from the route graph, so a ticket's worth is judged against the map
// it belongs to rather than against a fixed table from some other game.
export type TicketReview = {
  ticket: Ticket;
  distance: number | null;          // shortest path in wagon spaces, null when the stops are not connected
  routeIds: string[];
  suggested: number | null;         // what this map's own tickets imply for that distance
  verdict: "ok" | "unreachable" | "duplicate" | "generous" | "stingy";
};

// Points per wagon space, fitted from the tickets the map already has. With none to learn from,
// fall back to the published games' rough ratio of one point per space.
export function ticketPointsPerSpace(reviews: { distance: number | null; ticket: Ticket }[]): number {
  const usable = reviews.filter((review) => review.distance && review.distance > 0);
  if (!usable.length) return 1;
  const total = usable.reduce((sum, review) => sum + review.ticket.points / (review.distance as number), 0);
  return total / usable.length;
}

export function reviewTickets(data: MapData, setId?: string): TicketReview[] {
  const adjacency = buildAdjacency(data);
  const seen = new Map<string, string>();
  const measured = (setId ? ticketsInSet(data, setId) : data.tickets).map((ticket) => {
    const path = ticket.a === ticket.b ? null : shortestPath(adjacency, ticket.a, ticket.b);
    return { ticket, distance: path ? path.distance : null, routeIds: path ? path.routeIds : [] };
  });
  const rate = ticketPointsPerSpace(measured);
  return measured.map(({ ticket, distance, routeIds }) => {
    const key = [ticket.a, ticket.b].sort().join("~");
    const duplicate = seen.has(key) && seen.get(key) !== ticket.id;
    if (!seen.has(key)) seen.set(key, ticket.id);
    const suggested = distance ? Math.max(1, Math.round(distance * rate)) : null;
    const verdict: TicketReview["verdict"] = distance === null ? "unreachable"
      : duplicate ? "duplicate"
      : suggested && ticket.points > suggested * 1.35 ? "generous"
      : suggested && ticket.points < suggested * .65 ? "stingy"
      : "ok";
    return { ticket, distance, routeIds, suggested, verdict };
  });
}

// How many tickets name each stop. A stop no ticket reaches is dead weight; one named by half the
// deck makes every game run through it.
// How long a ticket counts as, in wagon spaces along the shortest path. These bands are a stand-in
// until the real definition arrives; changing these two numbers is the whole change.
export const TICKET_LENGTH_BANDS = { short: 7, medium: 13 };
export type TicketBand = "short" | "medium" | "long";
export const ticketBands: TicketBand[] = ["short", "medium", "long"];

export function ticketBand(distance: number | null): TicketBand | null {
  if (distance === null) return null;
  if (distance <= TICKET_LENGTH_BANDS.short) return "short";
  if (distance <= TICKET_LENGTH_BANDS.medium) return "medium";
  return "long";
}

export type StopCoverage = { stop: Stop; short: number; medium: number; long: number; total: number };

// One row per stop: how many tickets of each length name it. A ticket nobody can complete has no
// length, so it counts towards the total without landing in a band.
export function stopCoverage(data: MapData, setId?: string): StopCoverage[] {
  const reviews = reviewTickets(data, setId);
  const rows = new Map<string, StopCoverage>(data.stops.map((stop) => [stop.id, { stop, short: 0, medium: 0, long: 0, total: 0 }]));
  for (const review of reviews) {
    const band = ticketBand(review.distance);
    for (const id of new Set([review.ticket.a, review.ticket.b])) {
      const row = rows.get(id);
      if (!row) continue;
      row.total += 1;
      if (band) row[band] += 1;
    }
  }
  return [...rows.values()];
}

export function ticketCoverage(data: MapData, setId?: string): { stop: Stop; count: number }[] {
  const counts = new Map<string, number>();
  for (const ticket of (setId ? ticketsInSet(data, setId) : data.tickets)) for (const id of [ticket.a, ticket.b]) counts.set(id, (counts.get(id) ?? 0) + 1);
  return data.stops.map((stop) => ({ stop, count: counts.get(stop.id) ?? 0 })).sort((a, b) => b.count - a.count);
}
