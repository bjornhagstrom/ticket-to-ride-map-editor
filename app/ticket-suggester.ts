// Destination-ticket suggester. Proposes a whole deck for the map that is open, and scores a deck
// the map already has, against what the official Ticket to Ride decks do.
//
// Every target number here comes from the USA and Europe decks in data/ttr-reference-maps.json, not
// from our own maps. docs/TICKET-SUGGESTER.md explains where each one comes from, and
// scripts/ticket-suggester-reference.py is the Python original this was ported from. The two use
// different random number generators, so they agree on the metrics, not on the ticket lists.
import { DEFAULT_STARTING_TICKETS, DEFAULT_WAGONS_PER_PLAYER, TABLE_SIZE, type MapData, type Ticket, ticketsInSet } from "./map-data";

export type TicketStyle = "classic" | "europe";

// Presets, weights and limits in one place, so they can be tuned and their provenance stays visible.
export const TICKET_SUGGESTER = {
  // Length bins as fractions of reach, the longest ticket a player can realistically build.
  binEdges: [0, .30, .45, .60, .75, 1.01],
  styles: {
    classic: {
      label: "Classic",
      blurb: "One deck, lengths spread across the whole map, as in the original USA game.",
      ticketsPerStop: .85,
      longPerStop: 0,
      bins: [.10, .30, .27, .13, .20],
      longRange: null as [number, number] | null,
      bonusFrom: .9 as number | null,
      lengthCap: .47,
      maxPerStop: 5,
    },
    europe: {
      label: "Europe",
      blurb: "A short and medium regular deck plus a few long tickets at the very edge of the map.",
      ticketsPerStop: .85,
      longPerStop: .13,
      bins: [.25, .53, .20, .02, .00],
      longRange: [.9, 1] as [number, number] | null,
      bonusFrom: null as number | null,
      lengthCap: .47,
      maxPerStop: 5,
    },
  },
  // What the official decks actually measure, for the dialog to show beside each number.
  official: {
    lengthCap: [.33, .60] as [number, number],
    maxPerStop: [4, 10] as [number, number],
    perStop: [.83, .98] as [number, number],
    dupPct: [.3, 1.6] as [number, number],
    unusedPct: [14, 27] as [number, number],
  },
  weights: { bins: 10, ends: 400, cov: 1, zero: .5, dup: 4, unused: 1, load: .5, hard: 2 },
  peripheryLong: .62,
  peripheryShortDelta: -.05,
  dupRate: .02,
  unusedRate: .20,
  maxLocos: 2,
  minLengthFraction: .15,
  sampleSize: 80,
  defaultSteps: 6000,
  maxPathsPerPair: 32,
};

export type TicketSuggestOptions = {
  style: TicketStyle;
  wagonsPerPlayer: number;
  deckSize?: number;
  seed: number;
  keep: string[];
  steps: number;
  setId?: string;
};

export type TicketDeckReport = {
  diameter: number;
  reach: number;
  regular: number;
  long: number;
  bins: number[];
  longPeriphery: number | null;
  shortPeriphery: number | null;
  mapPeriphery: number;
  zeroStops: number;
  maxPerStop: number;
  duplicatePairs: [string, string][];
  dupPct: number;
  unusedRoutes: string[];
  unusedPct: number;
  hard: { ticketId: string; a: string; b: string; locomotives: number; tunnels: number }[];
  perStop: number;
  score: number;
  note: string | null;
};

// A small, fast, seeded generator. The same map and seed always give the same deck.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Edge = { a: string; b: string; weight: number; lanes: number; locos: number; tunnel: boolean; routeId: string };
type Candidate = {
  a: string; b: string; length: number; frac: number; bin: number;
  load: Map<number, number>; corridor: string[]; locos: number; tunnels: number;
};

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

// Parallel routes between the same two stops are one edge: the cheapest of them decides the weight,
// and how many lanes it has decides how much traffic it can take.
function buildEdges(data: MapData): Edge[] {
  const byPair = new Map<string, Edge>();
  for (const route of data.routes) {
    if (route.a === route.b) continue;
    const key = pairKey(route.a, route.b);
    const locos = route.locomotiveSlots?.length ?? 0;
    const tunnel = route.wagonStyle === "tunnel";
    const existing = byPair.get(key);
    if (!existing) { byPair.set(key, { a: route.a, b: route.b, weight: route.length, lanes: 1, locos, tunnel, routeId: route.id }); continue; }
    existing.lanes += 1;
    if (route.length < existing.weight) { existing.weight = route.length; existing.locos = locos; existing.tunnel = tunnel; existing.routeId = route.id; }
  }
  return [...byPair.values()];
}

class SuggesterModel {
  nodes: string[];
  index = new Map<string, number>();
  edges: Edge[];
  adjacency: { to: number; weight: number; edge: number }[][];
  dist: number[][];
  preds: number[][][];       // for each source, for each node, the edges arriving on a shortest path
  predFrom: number[][][];    // and the node each of those comes from
  diameter = 0;
  reach: number;
  periphery: number[];
  mapPeriphery = 0;
  note: string | null = null;
  private cache = new Map<string, Candidate>();
  private dupCache = new Map<string, boolean>();

  constructor(data: MapData, wagonsPerPlayer: number, lengthCap: number) {
    const edges = buildEdges(data);
    const touched = new Set<string>();
    for (const edge of edges) { touched.add(edge.a); touched.add(edge.b); }
    const known = new Set(data.stops.map((stop) => stop.id));
    let nodes = data.stops.filter((stop) => touched.has(stop.id)).map((stop) => stop.id);

    // Work in the largest connected part: a ticket across a break can never be completed.
    const components = connectedComponents(nodes, edges.filter((edge) => known.has(edge.a) && known.has(edge.b)));
    if (components.length > 1) {
      const largest = components.reduce((best, part) => (part.length > best.length ? part : best), components[0]);
      this.note = `The network falls into ${components.length} separate parts. Only the largest, with ${largest.length} of ${nodes.length} stops, is used.`;
      nodes = largest;
    }
    const inside = new Set(nodes);
    this.nodes = nodes;
    nodes.forEach((id, i) => this.index.set(id, i));
    this.edges = edges.filter((edge) => inside.has(edge.a) && inside.has(edge.b));

    this.adjacency = nodes.map(() => []);
    this.edges.forEach((edge, edgeIndex) => {
      const a = this.index.get(edge.a)!, b = this.index.get(edge.b)!;
      this.adjacency[a].push({ to: b, weight: edge.weight, edge: edgeIndex });
      this.adjacency[b].push({ to: a, weight: edge.weight, edge: edgeIndex });
    });

    this.dist = []; this.preds = []; this.predFrom = [];
    for (let source = 0; source < nodes.length; source++) {
      const { dist, preds, predFrom } = this.dijkstra(source);
      this.dist.push(dist); this.preds.push(preds); this.predFrom.push(predFrom);
      for (const d of dist) if (Number.isFinite(d) && d > this.diameter) this.diameter = d;
    }

    this.reach = Math.max(1, Math.min(this.diameter, Math.floor(lengthCap * wagonsPerPlayer)));

    // How far out a stop sits: mean distance to everything else, rescaled to 0 at the centre and 1
    // at the edge.
    const means = this.dist.map((row) => {
      const usable = row.filter((d) => Number.isFinite(d));
      return usable.length ? usable.reduce((sum, d) => sum + d, 0) / usable.length : 0;
    });
    const lo = Math.min(...means), hi = Math.max(...means);
    this.periphery = means.map((m) => (m - lo) / ((hi - lo) || 1));
    this.mapPeriphery = this.periphery.length ? this.periphery.reduce((sum, p) => sum + p, 0) / this.periphery.length : 0;
  }

  private dijkstra(source: number) {
    const n = this.nodes.length;
    const dist = new Array<number>(n).fill(Infinity);
    const preds: number[][] = Array.from({ length: n }, () => []);
    const predFrom: number[][] = Array.from({ length: n }, () => []);
    const done = new Array<boolean>(n).fill(false);
    dist[source] = 0;
    for (;;) {
      let current = -1, best = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; current = i; }
      if (current < 0) break;
      done[current] = true;
      for (const step of this.adjacency[current]) {
        const next = best + step.weight;
        if (next < dist[step.to]) { dist[step.to] = next; preds[step.to] = [step.edge]; predFrom[step.to] = [current]; }
        else if (next === dist[step.to] && !done[step.to]) { preds[step.to].push(step.edge); predFrom[step.to].push(current); }
      }
    }
    return { dist, preds, predFrom };
  }

  distance(a: number, b: number): number { return this.dist[a][b]; }

  // Every route on a shortest path, weighted by the share of shortest paths that use it, plus the
  // stops those paths run through. At most a few dozen paths, which is plenty to spread the load.
  candidate(aId: string, bId: string): Candidate | null {
    const key = pairKey(aId, bId);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const a = this.index.get(aId), b = this.index.get(bId);
    if (a === undefined || b === undefined || a === b) return null;
    const length = this.dist[a][b];
    if (!Number.isFinite(length)) return null;

    const paths: { edges: number[]; nodes: number[] }[] = [];
    const walk = (node: number, edges: number[], nodes: number[]) => {
      if (paths.length >= TICKET_SUGGESTER.maxPathsPerPair) return;
      if (node === a) { paths.push({ edges: [...edges], nodes: [...nodes, a] }); return; }
      const arriving = this.preds[a][node], from = this.predFrom[a][node];
      for (let i = 0; i < arriving.length; i++) {
        edges.push(arriving[i]); nodes.push(node);
        walk(from[i], edges, nodes);
        edges.pop(); nodes.pop();
      }
    };
    walk(b, [], []);
    if (!paths.length) return null;

    const load = new Map<number, number>();
    const corridor = new Set<number>();
    for (const path of paths) {
      for (const edge of path.edges) load.set(edge, (load.get(edge) ?? 0) + 1 / paths.length);
      for (const node of path.nodes) corridor.add(node);
    }
    // Difficulty is read off the easiest path, the one asking for the fewest locomotives.
    const cost = (path: { edges: number[] }) => path.edges.reduce((sum, edge) => sum + this.edges[edge].locos, 0);
    const easiest = paths.reduce((best, path) => (cost(path) < cost(best) ? path : best), paths[0]);
    const frac = length / this.reach;
    const edges = TICKET_SUGGESTER.binEdges;
    let bin = 0;
    for (let i = 0; i < 5; i++) if (frac >= edges[i] && frac < edges[i + 1]) { bin = i; break; }
    if (frac >= edges[5]) bin = 4;

    const value: Candidate = {
      a: aId, b: bId, length, frac, bin, load,
      corridor: [...corridor].map((i) => this.nodes[i]),
      locos: cost(easiest),
      tunnels: easiest.edges.reduce((sum, edge) => sum + (this.edges[edge].tunnel ? 1 : 0), 0),
    };
    this.cache.set(key, value);
    return value;
  }

  // Two tickets are near-duplicates when they are of similar length and one of them costs at most
  // one extra wagon once the other has been built.
  duplicate(x: Candidate, y: Candidate): boolean {
    const key = `${pairKey(x.a, x.b)}|${pairKey(y.a, y.b)}`;
    const cached = this.dupCache.get(key);
    if (cached !== undefined) return cached;
    let result = false;
    if (Math.min(x.length, y.length) / Math.max(x.length, y.length) >= .6) {
      const toCorridor = (stop: string, corridor: string[]) => {
        const from = this.index.get(stop)!;
        let best = Infinity;
        for (const id of corridor) best = Math.min(best, this.dist[from][this.index.get(id)!]);
        return best;
      };
      result = toCorridor(x.a, y.corridor) + toCorridor(x.b, y.corridor) <= 1
        || toCorridor(y.a, x.corridor) + toCorridor(y.b, x.corridor) <= 1;
    }
    this.dupCache.set(key, result);
    return result;
  }
}

function connectedComponents(nodes: string[], edges: Edge[]): string[][] {
  const neighbours = new Map<string, string[]>(nodes.map((id) => [id, []]));
  for (const edge of edges) {
    neighbours.get(edge.a)?.push(edge.b);
    neighbours.get(edge.b)?.push(edge.a);
  }
  const seen = new Set<string>();
  const parts: string[][] = [];
  for (const start of nodes) {
    if (seen.has(start)) continue;
    const part: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const node = stack.pop()!;
      part.push(node);
      for (const next of neighbours.get(node) ?? []) if (!seen.has(next)) { seen.add(next); stack.push(next); }
    }
    parts.push(part);
  }
  return parts;
}

// The running totals a deck's score is built from. Adding or removing one ticket touches only its
// own contribution, which is what makes thousands of swaps affordable.
class DeckState {
  binCounts = [0, 0, 0, 0, 0];
  stopCounts: number[];
  edgeLoad: Float64Array;
  peripheryLongSum = 0; peripheryLongCount = 0;
  peripheryShortSum = 0; peripheryShortCount = 0;
  hardSum = 0;
  duplicates = 0;
  members: Candidate[] = [];
  regularCount = 0;

  constructor(private model: SuggesterModel) {
    this.stopCounts = new Array(model.nodes.length).fill(0);
    this.edgeLoad = new Float64Array(model.edges.length);
  }

  add(candidate: Candidate, regular: boolean) {
    for (const other of this.members) if (this.model.duplicate(candidate, other)) this.duplicates += 1;
    this.members.push(candidate);
    if (regular) { this.regularCount += 1; this.binCounts[candidate.bin] += 1; }
    this.apply(candidate, 1);
  }

  remove(candidate: Candidate, regular: boolean) {
    const at = this.members.indexOf(candidate);
    if (at >= 0) this.members.splice(at, 1);
    for (const other of this.members) if (this.model.duplicate(candidate, other)) this.duplicates -= 1;
    if (regular) { this.regularCount -= 1; this.binCounts[candidate.bin] -= 1; }
    this.apply(candidate, -1);
  }

  private apply(candidate: Candidate, sign: number) {
    const a = this.model.index.get(candidate.a)!, b = this.model.index.get(candidate.b)!;
    this.stopCounts[a] += sign; this.stopCounts[b] += sign;
    for (const [edge, share] of candidate.load) this.edgeLoad[edge] += sign * share;
    const ends = this.model.periphery[a] + this.model.periphery[b];
    if (candidate.frac >= .6) { this.peripheryLongSum += sign * ends; this.peripheryLongCount += sign * 2; }
    else { this.peripheryShortSum += sign * ends; this.peripheryShortCount += sign * 2; }
    this.hardSum += sign * Math.max(0, candidate.locos - TICKET_SUGGESTER.maxLocos);
  }

  score(style: typeof TICKET_SUGGESTER.styles.classic, wantRegular: number): number {
    const w = TICKET_SUGGESTER.weights;
    const model = this.model;
    const n = Math.max(this.regularCount, 1);
    let bins = 0;
    for (let i = 0; i < 5; i++) {
      const diff = this.binCounts[i] - style.bins[i] * wantRegular;
      bins += diff * diff;
    }
    bins /= n;

    const longMean = this.peripheryLongCount ? this.peripheryLongSum / this.peripheryLongCount : null;
    const shortMean = this.peripheryShortCount ? this.peripheryShortSum / this.peripheryShortCount : null;
    let ends = 0;
    if (longMean !== null) ends += (longMean - TICKET_SUGGESTER.peripheryLong) ** 2;
    if (shortMean !== null) ends += (shortMean - (model.mapPeriphery + TICKET_SUGGESTER.peripheryShortDelta)) ** 2;

    let cov = 0, zero = 0;
    for (const count of this.stopCounts) {
      if (count === 0) zero += 1;
      const over = count - style.maxPerStop;
      if (over > 0) cov += over * over;
    }

    const pairs = this.members.length * (this.members.length - 1) / 2;
    const dup = Math.max(0, this.duplicates - TICKET_SUGGESTER.dupRate * pairs);

    let unused = 0, loadSum = 0;
    const perLane = new Float64Array(model.edges.length);
    for (let i = 0; i < model.edges.length; i++) {
      if (this.edgeLoad[i] <= 1e-9) unused += 1;
      perLane[i] = this.edgeLoad[i] / model.edges[i].lanes;
      loadSum += perLane[i];
    }
    const mean = model.edges.length ? loadSum / model.edges.length : 0;
    let variance = 0;
    for (let i = 0; i < model.edges.length; i++) variance += (perLane[i] - mean) ** 2;
    variance = model.edges.length ? variance / model.edges.length : 0;
    const unusedPenalty = Math.max(0, unused - TICKET_SUGGESTER.unusedRate * model.edges.length);

    return w.bins * bins + w.ends * ends + w.cov * cov + w.zero * zero
      + w.dup * dup + w.unused * unusedPenalty + w.load * variance + w.hard * this.hardSum;
  }
}

function resolveOptions(data: MapData, options: Partial<TicketSuggestOptions>): TicketSuggestOptions {
  const wagons = options.wagonsPerPlayer ?? data.wagonsPerPlayer ?? DEFAULT_WAGONS_PER_PLAYER;
  return {
    style: options.style ?? defaultStyle(data),
    wagonsPerPlayer: wagons,
    deckSize: options.deckSize,
    seed: options.seed ?? 1,
    keep: options.keep ?? [],
    steps: options.steps ?? TICKET_SUGGESTER.defaultSteps,
    setId: options.setId,
  };
}

// Europe deals a long ticket alongside the regular ones, so a map set up to deal four or more, or a
// deck that already has long tickets, is taken to want the Europe shape.
export function defaultStyle(data: MapData, setId?: string): TicketStyle {
  const deck = setId ? ticketsInSet(data, setId) : data.tickets;
  if (deck.some((ticket) => ticket.long)) return "europe";
  return (data.startingTickets ?? DEFAULT_STARTING_TICKETS) >= 4 ? "europe" : "classic";
}

// How big a deck to aim for: the style's tickets per stop, but never so few that a full table
// cannot be dealt from it.
export function suggestedDeckSize(data: MapData, style: TicketStyle, stops: number): { regular: number; long: number } {
  const preset = TICKET_SUGGESTER.styles[style];
  const long = Math.round(preset.longPerStop * stops);
  const dealt = TABLE_SIZE * (data.startingTickets ?? DEFAULT_STARTING_TICKETS);
  const regular = Math.max(Math.round(preset.ticketsPerStop * stops), dealt - long);
  return { regular, long };
}

function emptyReport(note: string): TicketDeckReport {
  return {
    diameter: 0, reach: 0, regular: 0, long: 0, bins: [0, 0, 0, 0, 0],
    longPeriphery: null, shortPeriphery: null, mapPeriphery: 0,
    zeroStops: 0, maxPerStop: 0, duplicatePairs: [], dupPct: 0,
    unusedRoutes: [], unusedPct: 0, hard: [], perStop: 0, score: 0, note,
  };
}

function buildReport(model: SuggesterModel, deck: DeckState, style: typeof TICKET_SUGGESTER.styles.classic, wantRegular: number, longCount: number, ids: Map<Candidate, string>): TicketDeckReport {
  const duplicatePairs: [string, string][] = [];
  for (let i = 0; i < deck.members.length; i++) {
    for (let j = i + 1; j < deck.members.length; j++) {
      if (model.duplicate(deck.members[i], deck.members[j])) duplicatePairs.push([ids.get(deck.members[i]) ?? "", ids.get(deck.members[j]) ?? ""]);
    }
  }
  const unusedRoutes = model.edges.filter((_, i) => deck.edgeLoad[i] <= 1e-9).map((edge) => edge.routeId);
  const pairs = deck.members.length * (deck.members.length - 1) / 2;
  const hard = deck.members
    .filter((candidate) => candidate.locos > 0 || candidate.tunnels > 0)
    .map((candidate) => ({ ticketId: ids.get(candidate) ?? "", a: candidate.a, b: candidate.b, locomotives: candidate.locos, tunnels: candidate.tunnels }));
  return {
    diameter: model.diameter,
    reach: model.reach,
    regular: deck.regularCount,
    long: longCount,
    bins: [...deck.binCounts],
    longPeriphery: deck.peripheryLongCount ? deck.peripheryLongSum / deck.peripheryLongCount : null,
    shortPeriphery: deck.peripheryShortCount ? deck.peripheryShortSum / deck.peripheryShortCount : null,
    mapPeriphery: model.mapPeriphery,
    zeroStops: deck.stopCounts.filter((count) => count === 0).length,
    maxPerStop: deck.stopCounts.length ? Math.max(...deck.stopCounts) : 0,
    duplicatePairs,
    dupPct: pairs ? 100 * duplicatePairs.length / pairs : 0,
    unusedRoutes,
    unusedPct: model.edges.length ? 100 * unusedRoutes.length / model.edges.length : 0,
    hard,
    perStop: model.nodes.length ? deck.members.length / model.nodes.length : 0,
    score: deck.score(style, wantRegular),
    note: model.note,
  };
}

export function suggestTickets(data: MapData, options: Partial<TicketSuggestOptions> = {}): { tickets: Ticket[]; report: TicketDeckReport } {
  const resolved = resolveOptions(data, options);
  const style = TICKET_SUGGESTER.styles[resolved.style];
  if (data.stops.length < 4 || data.routes.length < 3) {
    return { tickets: [], report: emptyReport("A map needs at least four stops and a few routes before a deck can be suggested.") };
  }
  const model = new SuggesterModel(data, resolved.wagonsPerPlayer, style.lengthCap);
  if (model.nodes.length < 4) {
    return { tickets: [], report: emptyReport("Fewer than four stops are connected to anything, so there is nothing to build tickets from.") };
  }

  const want = resolved.deckSize !== undefined
    ? { regular: Math.max(0, resolved.deckSize - Math.round(style.longPerStop * model.nodes.length)), long: Math.round(style.longPerStop * model.nodes.length) }
    : suggestedDeckSize(data, resolved.style, model.nodes.length);

  const low = Math.max(3, Math.round(TICKET_SUGGESTER.minLengthFraction * model.reach));
  const longRange = style.longRange;
  const regularPool: Candidate[] = [];
  const longPool: Candidate[] = [];
  for (let i = 0; i < model.nodes.length; i++) {
    for (let j = i + 1; j < model.nodes.length; j++) {
      const length = model.distance(i, j);
      if (!Number.isFinite(length)) continue;
      const frac = length / model.reach;
      const inRegular = length >= low && length <= model.reach && (!longRange || frac < longRange[0]);
      const inLong = Boolean(longRange) && frac >= longRange![0] && frac <= longRange![1];
      if (!inRegular && !inLong) continue;
      const candidate = model.candidate(model.nodes[i], model.nodes[j]);
      if (!candidate) continue;
      (inLong ? longPool : regularPool).push(candidate);
    }
  }
  if (!regularPool.length && !longPool.length) {
    return { tickets: [], report: emptyReport(`No pair of stops is between ${low} and ${model.reach} wagon spaces apart, so there is nothing to make tickets from.`) };
  }

  // Kept tickets are locked in before anything is chosen.
  const keepIds = new Set(resolved.keep);
  const keepPairs = new Set(data.tickets.filter((ticket) => keepIds.has(ticket.id)).map((ticket) => pairKey(ticket.a, ticket.b)));
  const isKept = (candidate: Candidate) => keepPairs.has(pairKey(candidate.a, candidate.b));

  const groups: Candidate[][] = [regularPool.filter(isKept), longPool.filter(isKept)];
  const locked = [groups[0].length, groups[1].length];
  const pools: Candidate[][] = [regularPool.filter((c) => !isKept(c)), longPool.filter((c) => !isKept(c))];
  const targets = [want.regular, want.long];

  const deck = new DeckState(model);
  for (const candidate of groups[0]) deck.add(candidate, true);
  for (const candidate of groups[1]) deck.add(candidate, false);

  const random = mulberry32(resolved.seed);
  const pick = (list: Candidate[]) => Math.floor(random() * list.length);

  // Greedy fill, the long deck first: it has the fewest places to go.
  for (const group of [1, 0]) {
    while (groups[group].length < targets[group] && pools[group].length) {
      const sampleSize = Math.min(TICKET_SUGGESTER.sampleSize, pools[group].length);
      let bestIndex = 0, bestScore = Infinity;
      const tried = new Set<number>();
      for (let s = 0; s < sampleSize; s++) {
        let index = pick(pools[group]);
        let guard = 0;
        while (tried.has(index) && guard++ < 8) index = pick(pools[group]);
        if (tried.has(index)) continue;
        tried.add(index);
        const candidate = pools[group][index];
        deck.add(candidate, group === 0);
        const value = deck.score(style, targets[0]);
        deck.remove(candidate, group === 0);
        if (value < bestScore) { bestScore = value; bestIndex = index; }
      }
      const chosen = pools[group][bestIndex];
      groups[group].push(chosen);
      pools[group].splice(bestIndex, 1);
      deck.add(chosen, group === 0);
    }
  }

  // Simulated annealing: swap a ticket for one left in the same pool, always accepting an
  // improvement and sometimes accepting a step backwards, less and less often as it cools.
  let current = deck.score(style, targets[0]);
  for (let step = 0; step < resolved.steps; step++) {
    const group = targets[1] && random() < .15 ? 1 : 0;
    if (groups[group].length <= locked[group] || !pools[group].length) continue;
    const outIndex = locked[group] + Math.floor(random() * (groups[group].length - locked[group]));
    const inIndex = pick(pools[group]);
    const outgoing = groups[group][outIndex], incoming = pools[group][inIndex];
    const regular = group === 0;
    deck.remove(outgoing, regular);
    deck.add(incoming, regular);
    const next = deck.score(style, targets[0]);
    const temperature = 5 * (1 - step / resolved.steps) + .01;
    if (next < current || random() < Math.exp((current - next) / temperature)) {
      groups[group][outIndex] = incoming;
      pools[group][inIndex] = outgoing;
      current = next;
    } else {
      deck.remove(incoming, regular);
      deck.add(outgoing, regular);
    }
  }

  const stamp = Date.now();
  const ids = new Map<Candidate, string>();
  const tickets: Ticket[] = [];
  [groups[0], groups[1]].forEach((group, groupIndex) => {
    group.forEach((candidate, i) => {
      const id = `t-${stamp}-${groupIndex}-${i}`;
      ids.set(candidate, id);
      const bonus = style.bonusFrom !== null && candidate.frac >= style.bonusFrom ? 1 : 0;
      tickets.push({ id, a: candidate.a, b: candidate.b, points: candidate.length + bonus, long: groupIndex === 1 ? true : undefined });
    });
  });

  return { tickets, report: buildReport(model, deck, style, targets[0], groups[1].length, ids) };
}

// Score the deck the map already has, on the same scale.
export function evaluateTicketDeck(data: MapData, options: Partial<TicketSuggestOptions> = {}): TicketDeckReport {
  const resolved = resolveOptions(data, options);
  const style = TICKET_SUGGESTER.styles[resolved.style];
  const deckTickets = resolved.setId ? ticketsInSet(data, resolved.setId) : data.tickets;
  if (data.stops.length < 4 || data.routes.length < 3) return emptyReport("A map needs at least four stops and a few routes before a deck can be judged.");
  const model = new SuggesterModel(data, resolved.wagonsPerPlayer, style.lengthCap);
  if (model.nodes.length < 4) return emptyReport("Fewer than four stops are connected to anything.");
  if (!deckTickets.length) {
    const report = emptyReport("This deck has no tickets yet.");
    return { ...report, diameter: model.diameter, reach: model.reach, zeroStops: model.nodes.length };
  }

  const deck = new DeckState(model);
  const ids = new Map<Candidate, string>();
  let long = 0, skipped = 0;
  for (const ticket of deckTickets) {
    const candidate = model.candidate(ticket.a, ticket.b);
    if (!candidate) { skipped += 1; continue; }
    ids.set(candidate, ticket.id);
    const isLong = Boolean(ticket.long);
    if (isLong) long += 1;
    deck.add(candidate, !isLong);
  }
  const report = buildReport(model, deck, style, Math.max(deck.regularCount, 1), long, ids);
  if (skipped) report.note = `${report.note ? `${report.note} ` : ""}${skipped} ticket${skipped === 1 ? "" : "s"} could not be measured and ${skipped === 1 ? "was" : "were"} left out.`;
  return report;
}
