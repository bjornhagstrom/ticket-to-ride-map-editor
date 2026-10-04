// The balance layer: everything derived from the stops and routes themselves. All of it is pure,
// computed on demand from MapData, and none of it is stored in a map file.
import { DEFAULT_WAGONS_PER_PLAYER, DEFAULT_STARTING_TICKETS, DEFAULT_TICKET_BANDS, DEFAULT_TICKET_MIX, type TicketBands, type TicketMix, DEFAULT_PLAYERS, defaultLabelAngle, labelPush, stopSizeMeta, ticketsInSet, type MapData, type Ticket, type Point, realWagon, type Route, routeColors, type Stop, W } from "./map-data";
import type { TicketDeckReport } from "./ticket-suggester";
import { boardOf } from "./board";
import { curvedSamples, isCurved, intersects, parallelPoints, pointsFor, polylineLength, stopById } from "./map-geometry";

export type RouteSpacing = { route: Route; drawnMm: number; neededMm: number; ratio: number; verdict: "short" | "long" | "ok" };
const SPACING_SHORT = .85, SPACING_LONG = 1.35;
/** As many real wagons (and the gaps between them, and room at the ends) as a line this long holds on
 *  the board the map is for: what a new route gets unless a number is chosen. 1 to 8. */
export function fittingLength(lengthUnits: number, scaleWidthMm: number): number {
  const drawnMm = lengthUnits * scaleWidthMm / W;
  return Math.max(1, Math.min(8, Math.floor((drawnMm - realWagon.endMargin) / (realWagon.length + realWagon.gap))));
}

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
// Where two buildable routes pass over each other without meeting at a stop, measured on the lines as
// they are drawn (curves sampled, not the straight lines between their points), with the point where
// they cross, so the editor can ring it.
export type Crossing = { a: Route; b: Route; at: Point };
export function crossings(data: MapData): Crossing[] {
  const infrastructureTypes = new Set(data.routeTypeStyles.filter((style) => style.infrastructure).map((style) => style.id));
  const routes = data.routes.filter((route) => !infrastructureTypes.has(route.type));
  const drawn = new Map(routes.map((route) => { const geometry = pointsFor(data, route); return [route.id, isCurved(route) && geometry.length > 2 ? curvedSamples(geometry) : geometry]; }));
  const found: Crossing[] = [];
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
    const a = routes[i], b = routes[j];
    if ([a.a, a.b].some((id) => id === b.a || id === b.b)) continue;
    const ap = drawn.get(a.id)!, bp = drawn.get(b.id)!;
    let at: Point | null = null;
    for (let x = 0; x < ap.length - 1 && !at; x++) for (let y = 0; y < bp.length - 1; y++) if (intersects(ap[x], ap[x + 1], bp[y], bp[y + 1])) { at = meetingPoint(ap[x], ap[x + 1], bp[y], bp[y + 1]); break; }
    if (at) found.push({ a, b, at });
  }
  return found;
}
const meetingPoint = (p: Point, q: Point, r: Point, s: Point): Point => {
  const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
  const t = d ? ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d : 0;
  return { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) };
};
export const crossingPairs = (data: MapData): Array<[Route, Route]> => crossings(data).map(({ a, b }) => [a, b]);
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
export type ColourLengthTable = { colourWagons: Map<string, number>; grandWagons: number; lengths: number[]; colours: string[]; counts: Map<number, Map<string, number>>; colourTotals: Map<string, number>; lengthTotals: Map<number, number>; grandTotal: number };
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
  const colourWagons = new Map<string, number>(colours.map((c) => [c, 0]));
  for (const route of cardRoutes) colourWagons.set(route.color, (colourWagons.get(route.color) ?? 0) + route.length);
  const grandWagons = cardRoutes.reduce((sum, route) => sum + route.length, 0);
  return { lengths, colours, counts, colourTotals, lengthTotals, grandTotal: cardRoutes.length, colourWagons, grandWagons };
}
// How the seven classic official maps (USA, Nordic Countries, India, Switzerland, Old West, Polska and
// Northern Lights, the same seven the deck targets are fitted to) spread their routes. Aggregated from
// ../ttr-reference-data/ttr-reference-maps.json: the lowest, median and highest of the seven. Share of
// routes by length (the last bucket is 6 and longer), the share of grey routes, and how evenly the eight
// colours share the wagons, as the largest colour's wagons against the average colour's.
export const CLASSIC_ROUTE_MAPS = ["USA", "Nordic Countries", "India", "Switzerland", "Old West", "Polska", "Northern Lights"];
export const CLASSIC_ROUTES = {
  lengthShare: { 1: [9, 28.7, 35.2], 2: [23.9, 34.6, 50], 3: [15.7, 20.5, 25.5], 4: [5.9, 13.6, 16], 5: [0, 2.3, 10], 6: [0, 2.5, 9] } as Record<number, [number, number, number]>,
  greyShare: [11.8, 23.7, 44] as [number, number, number],
  colourSpread: [1, 1.05, 1.12] as [number, number, number],
};
const SPREAD_COLOURS = ["red", "blue", "green", "yellow", "black", "white", "orange", "purple"];
export type ClassicRow = { kind: string; label: string; value: number; range: [number, number, number]; verdict: "below" | "within" | "above"; unit: "%" | "×" };
export function compareWithClassics(data: MapData): ClassicRow[] | null {
  const infrastructureTypes = new Set(data.routeTypeStyles.filter((style) => style.infrastructure).map((style) => style.id));
  const routes = data.routes.filter((route) => !infrastructureTypes.has(route.type));
  if (!routes.length) return null;
  const verdict = (value: number, range: [number, number, number]): ClassicRow["verdict"] => (value < range[0] ? "below" : value > range[2] ? "above" : "within");
  const rows: ClassicRow[] = [];
  for (const length of [1, 2, 3, 4, 5, 6]) {
    const value = 100 * routes.filter((route) => (length === 6 ? route.length >= 6 : route.length === length)).length / routes.length;
    const range = CLASSIC_ROUTES.lengthShare[length];
    rows.push({ kind: String(length), label: length === 6 ? "Length 6+" : `Length ${length}`, value, range, verdict: verdict(value, range), unit: "%" });
  }
  const grey = 100 * routes.filter((route) => route.color === "neutral").length / routes.length;
  rows.push({ kind: "grey", label: "Grey routes", value: grey, range: CLASSIC_ROUTES.greyShare, verdict: verdict(grey, CLASSIC_ROUTES.greyShare), unit: "%" });
  const wagons = SPREAD_COLOURS.map((colour) => routes.filter((route) => route.color === colour).reduce((sum, route) => sum + route.length, 0));
  const mean = wagons.reduce((sum, value) => sum + value, 0) / wagons.length;
  const spread = mean > 0 ? Math.max(...wagons) / mean : 0;
  rows.push({ kind: "spread", label: "Colour balance", value: spread, range: CLASSIC_ROUTES.colourSpread, verdict: mean > 0 ? verdict(spread, CLASSIC_ROUTES.colourSpread) : "above", unit: "×" });
  return rows;
}

// The card routes behind a number in the table: of one length, one colour, both, or neither for all of them.
export function colourRouteIds(data: MapData, length: number | null, colour: string | null): string[] {
  const infrastructureTypes = new Set(data.routeTypeStyles.filter((style) => style.infrastructure).map((style) => style.id));
  return data.routes.filter((route) => !infrastructureTypes.has(route.type) && (length === null || route.length === length) && (colour === null || route.color === colour)).map((route) => route.id);
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
  // As StopLabel draws it: centred on the point at this bearing, pushed out by cos × half the width
  // and sin × half the height, so the box slides round the stop without jumping.
  const push = labelPush(angle);
  const left = stop.x + dx - width / 2 + push.x * width / 2;
  const top = stop.y + dy - LABEL_HEIGHT / 2 + push.y * LABEL_HEIGHT / 2;
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

export const labelAngleOf = (stop: Stop, boardWidth = W) => stop.labelAngle ?? defaultLabelAngle(stop, boardWidth);

export function labelCovers(data: MapData, stop: Stop, samples: Point[]): boolean {
  const radius = stopSizeMeta[stop.size ?? "medium"].radius;
  return overlapCount(labelBox(stop, labelAngleOf(stop, boardOf(data).width), radius), samples) > 0;
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
export function autoPlaceLabels(data: MapData): { placed: Map<string, number>; unresolved: string[]; locked: string[] } {
  const samples = routeSamplePoints(data);
  const radiusOf = (stop: Stop) => stopSizeMeta[stop.size ?? "medium"].radius;
  const scored = labelledStops(data).map((stop) => ({ stop, options: labelAngleOptions(data, stop, samples) }));
  scored.sort((a, b) => a.options.filter((o) => !o.overlap).length - b.options.filter((o) => !o.overlap).length);
  const taken: Box[] = [];
  const placed = new Map<string, number>();
  const unresolved: string[] = [];
  // A locked name stays put, and others are placed around it. It is reported only if it covers a route.
  const locked: string[] = [];
  for (const { stop } of scored) if (stop.labelLocked) {
    taken.push(labelBox(stop, labelAngleOf(stop, boardOf(data).width), radiusOf(stop)));
    if (labelCovers(data, stop, samples)) locked.push(stop.id);
  }
  for (const { stop, options } of scored) {
    if (stop.labelLocked) continue;
    const current = labelAngleOf(stop, boardOf(data).width);
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
  return { placed, unresolved, locked };
}

// Junctions only join routes: no ticket ends at one, and its name is never drawn. So they are left
// out of anything counted per ticket end, and out of the checks on names covering routes.
const nonJunctionStops = (data: MapData): Stop[] => {
  const junctions = new Set((data.stopTypeStyles ?? []).filter((style) => style.junction).map((style) => style.id));
  return data.stops.filter((stop) => !junctions.has(stop.type));
};
export const labelledStops = nonJunctionStops;
export const ticketEndStops = nonJunctionStops;

export function coveredLabels(data: MapData): Stop[] {
  const samples = routeSamplePoints(data);
  return labelledStops(data).filter((stop) => labelCovers(data, stop, samples));
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
// The game setup read against the map itself. Wagon spaces are what a player's supply is spent on,
// so the map has to hold enough of them for a table to empty their hands — and not so many that
// nobody ever competes for a route.
export type SetupBalance = {
  totalSpaces: number;
  wagonsPerPlayer: number;
  supplies: number;
  spaceVerdict: "tight" | "ok" | "roomy";
  deckSize: number;
  dealtAtTable: number;
  // The largest table this map is built for.
  table: number;
  deckVerdict: "empty" | "thin" | "ok";
};

const TIGHT_SUPPLIES = 2, ROOMY_SUPPLIES = 8;

export function setupBalance(data: MapData, setId?: string): SetupBalance {
  const infrastructureTypes = new Set(data.routeTypeStyles.filter((style) => style.infrastructure).map((style) => style.id));
  const totalSpaces = data.routes.filter((route) => !infrastructureTypes.has(route.type)).reduce((sum, route) => sum + route.length, 0);
  const wagonsPerPlayer = data.wagonsPerPlayer ?? DEFAULT_WAGONS_PER_PLAYER;
  const supplies = wagonsPerPlayer > 0 ? totalSpaces / wagonsPerPlayer : 0;
  const deckSize = (setId ? ticketsInSet(data, setId) : data.tickets).length;
  const table = data.players?.max ?? DEFAULT_PLAYERS.max;
  const dealtAtTable = table * (data.startingTickets ?? DEFAULT_STARTING_TICKETS);
  return {
    totalSpaces,
    wagonsPerPlayer,
    supplies,
    spaceVerdict: supplies < TIGHT_SUPPLIES ? "tight" : supplies > ROOMY_SUPPLIES ? "roomy" : "ok",
    deckSize,
    dealtAtTable,
    table,
    deckVerdict: deckSize === 0 ? "empty" : deckSize < dealtAtTable ? "thin" : "ok",
  };
}

// How long a ticket counts as, measured against the map's own diameter so a boundary means the same
// thing on a small map as on a large one. Each map carries its own, defaulting to the boundaries the
// official decks were read with.
export type TicketBand = "short" | "medium" | "long";
export const ticketBands: TicketBand[] = ["short", "medium", "long"];

export function bandsOf(data: MapData): TicketBands { return data.ticketBands ?? DEFAULT_TICKET_BANDS; }
export function mixOf(data: MapData): TicketMix { return data.ticketMix ?? DEFAULT_TICKET_MIX; }

// The longest shortest path on the map: what every ticket length is measured against.
export function mapDiameter(data: MapData): number {
  const adjacency = buildAdjacency(data);
  const ids = [...adjacency.keys()];
  let diameter = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const path = shortestPath(adjacency, ids[i], ids[j]);
      if (path && path.distance > diameter) diameter = path.distance;
    }
  }
  return diameter;
}

export function ticketBand(distance: number | null, diameter: number, bands: TicketBands): TicketBand | null {
  if (distance === null || diameter <= 0) return null;
  const share = distance / diameter;
  if (share <= bands.medium) return "short";
  if (share < bands.long) return "medium";
  return "long";
}

// The boundaries as whole wagon spaces, for saying out loud what they mean on this map.
export function bandCuts(diameter: number, bands: TicketBands): { medium: number; long: number } {
  return { medium: Math.round(bands.medium * diameter), long: Math.round(bands.long * diameter) };
}

export type StopCoverage = { stop: Stop; short: number; medium: number; long: number; total: number };

// One row per stop: how many tickets of each length name it. A ticket nobody can complete has no
// length, so it counts towards the total without landing in a band.
export function stopCoverage(data: MapData, setId?: string): StopCoverage[] {
  const reviews = reviewTickets(data, setId);
  const diameter = mapDiameter(data);
  const bands = bandsOf(data);
  const rows = new Map<string, StopCoverage>(ticketEndStops(data).map((stop) => [stop.id, { stop, short: 0, medium: 0, long: 0, total: 0 }]));
  for (const review of reviews) {
    const band = ticketBand(review.distance, diameter, bands);
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
  return ticketEndStops(data).map((stop) => ({ stop, count: counts.get(stop.id) ?? 0 })).sort((a, b) => b.count - a.count);
}

// One deck's figures, for setting two decks side by side. Everything is read from the deck itself:
// its tickets, the lengths of their shortest paths, and the report on how it lies on the map.
export type DeckFigures = {
  tickets: number; long: number; points: number; pointsPerTicket: number | null;
  shortest: number | null; median: number | null; longest: number | null;
  mix: [number, number, number] | null;   // short, medium, long, as shares of the tickets counted
  bins: number[] | null;                  // the five length bands, as shares of the regular tickets counted
  uncovered: number; crowded: number; duplicates: number; unusedPct: number; offPath: number; offPathOf: number;
};

export function deckFigures(data: MapData, setId: string, report: TicketDeckReport): DeckFigures {
  const tickets = ticketsInSet(data, setId);
  const points = tickets.reduce((sum, ticket) => sum + ticket.points, 0);
  const lengths = reviewTickets(data, setId).map((review) => review.distance).filter((distance): distance is number => distance !== null).sort((a, b) => a - b);
  const mixTotal = report.mix.reduce((sum, count) => sum + count, 0);
  return {
    tickets: tickets.length,
    long: tickets.filter((ticket) => ticket.long).length,
    points,
    pointsPerTicket: tickets.length ? points / tickets.length : null,
    shortest: lengths.length ? lengths[0] : null,
    median: lengths.length ? lengths[Math.floor(lengths.length / 2)] : null,
    longest: lengths.length ? lengths[lengths.length - 1] : null,
    mix: mixTotal ? [100 * report.mix[0] / mixTotal, 100 * report.mix[1] / mixTotal, 100 * report.mix[2] / mixTotal] : null,
    bins: report.regular ? report.bins.map((count) => 100 * count / report.regular) : null,
    uncovered: ticketCoverage(data, setId).filter((entry) => entry.count === 0).length,
    crowded: report.bottlenecks.length,
    duplicates: report.duplicatePairs.length,
    unusedPct: report.unusedPct,
    offPath: report.valuation.off.length,
    offPathOf: report.valuation.total,
  };
}

// The ticket suggester lives in its own module; re-exported here so the ticket analysis has one door.
export { TENSION_CHOICES, type DeckTension, suggestTickets, evaluateTicketDeck, suggestedDeckSize, ticketEndStopCount, dealtToFullTable, defaultStyle, deckRules, deckRuleFor, TICKET_SUGGESTER, type TicketStyle, type BuiltInStyle, type DeckRule, type TicketSuggestOptions, type TicketDeckReport, type Bottleneck } from "./ticket-suggester";

// How the network holds together: stops with no route, dead ends, routes whose loss cuts the map in
// two (with how many lanes they have), and corners reached only through one or two stops. Edges and
// corners are character on the official maps — Edinburgh behind its double route, Iberia behind
// Pamplona and Marseille — while a route with one lane that cuts the map in two never occurs there.
// The editor describes the first and warns only about the second (docs/PROPOSAL-UNEVEN-MAPS.md).
export type NetworkShape = {
  unconnected: Stop[];
  deadEnds: Stop[];
  bridges: { a: Stop; b: Stop; lanes: number; routeIds: string[] }[];
  corners: { stops: Stop[]; gates: Stop[]; routeIds: string[] }[];
};
/** Measured on the eight calibration maps (tests/network-shape.cjs checks Europe and the USA). */
/** Routes more tickets want than they can carry, at the largest table each official map is for. */
export const CROWDING_OFFICIAL: [number, number] = [8, 19];
/** The official range beside each balance figure, measured on the eight calibration maps with their own
 *  decks at the largest table each is for (tests/balance-official.cjs measures them again): crowded
 *  routes, mean ticket load on double routes against single ones, routes no ticket needs (%), most
 *  tickets on one stop, and the average hub degree. */
export const BALANCE_OFFICIAL = { crowded: [8, 19] as [number, number], loadRatio: [1.3, 3.1] as [number, number], unusedPct: [7, 21] as [number, number], maxPerStop: [4, 9] as [number, number], hubDegree: [7.6, 10.8] as [number, number] };
export const SHAPE_OFFICIAL = { maps: 8, mapsWithDeadEnds: 1, mapsWithBridges: 1, singleLaneBridges: 0, mapsWithCorners: 4, cornersPerMap: [0, 3] as [number, number] };

export function networkShape(data: MapData): NetworkShape {
  const byId = new Map(data.stops.map((stop) => [stop.id, stop]));
  const neighbours = new Map(data.stops.map((stop) => [stop.id, new Set<string>()]));
  const lanes = new Map<string, string[]>();
  const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const route of data.routes) {
    if (!byId.has(route.a) || !byId.has(route.b) || route.a === route.b) continue;
    neighbours.get(route.a)!.add(route.b);
    neighbours.get(route.b)!.add(route.a);
    const key = pair(route.a, route.b);
    lanes.set(key, [...(lanes.get(key) ?? []), route.id]);
  }
  const connected = data.stops.filter((stop) => neighbours.get(stop.id)!.size > 0).map((stop) => stop.id);
  // The parts left when some stops, or one connection, are taken away.
  const parts = (removed: Set<string>, cut?: [string, string]): string[][] => {
    const seen = new Set<string>(removed);
    const found: string[][] = [];
    for (const start of connected) {
      if (seen.has(start)) continue;
      const part = [start];
      seen.add(start);
      for (let i = 0; i < part.length; i++) for (const next of neighbours.get(part[i])!) {
        if (seen.has(next) || (cut && ((part[i] === cut[0] && next === cut[1]) || (part[i] === cut[1] && next === cut[0])))) continue;
        seen.add(next);
        part.push(next);
      }
      found.push(part);
    }
    return found;
  };
  const whole = parts(new Set()).length;
  const bridges = [...lanes.entries()].filter(([key]) => parts(new Set(), key.split("|") as [string, string]).length > whole)
    // Named as the route was drawn, from its first lane.
    .map(([, routeIds]) => { const first = data.routes.find((route) => route.id === routeIds[0])!; return { a: byId.get(first.a)!, b: byId.get(first.b)!, lanes: routeIds.length, routeIds }; });
  // Corners: a part of at least two stops and at most a quarter of the map, cut off when one or two
  // stops (its gates) are taken away. Only the largest of corners nested inside each other is kept.
  const limit = Math.floor(connected.length / 4);
  const found = new Map<string, { stops: string[]; gates: string[] }>();
  const consider = (gates: string[]) => {
    for (const part of parts(new Set(gates))) {
      if (part.length < 2 || part.length > limit) continue;
      const key = [...part].sort().join("|");
      const known = found.get(key);
      if (!known || known.gates.length > gates.length) found.set(key, { stops: part, gates });
    }
  };
  for (const a of connected) consider([a]);
  for (let i = 0; i < connected.length; i++) for (let j = i + 1; j < connected.length; j++) consider([connected[i], connected[j]]);
  const candidates = [...found.values()].sort((x, y) => y.stops.length - x.stops.length);
  const kept: { stops: string[]; gates: string[] }[] = [];
  for (const corner of candidates) {
    const inside = new Set(corner.stops);
    if (kept.some((other) => corner.stops.every((id) => other.stops.includes(id)))) continue;
    // A dead end is already listed as such, and a corner that is only a dead end and the stop it
    // hangs from says the same thing twice. A line of stops with nothing branching off is a long
    // way between two gates, not a region of its own.
    const through = [...inside].filter((id) => neighbours.get(id)!.size >= 2);
    if (through.length < 2 || !through.some((id) => neighbours.get(id)!.size >= 3)) continue;
    kept.push(corner);
  }
  const corners = kept.map((corner) => {
    const inside = new Set(corner.stops);
    const routeIds = data.routes.filter((route) => (inside.has(route.a) && corner.gates.includes(route.b)) || (inside.has(route.b) && corner.gates.includes(route.a))).map((route) => route.id);
    return { stops: corner.stops.map((id) => byId.get(id)!), gates: corner.gates.map((id) => byId.get(id)!), routeIds };
  });
  return {
    unconnected: data.stops.filter((stop) => neighbours.get(stop.id)!.size === 0),
    deadEnds: data.stops.filter((stop) => neighbours.get(stop.id)!.size === 1),
    bridges,
    corners,
  };
}
