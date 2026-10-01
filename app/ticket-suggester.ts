// Destination-ticket suggester. Proposes a whole deck for the map that is open, and scores a deck
// the map already has, against what the official Ticket to Ride decks do.
//
// Every target number here comes from the USA and Europe decks in ../ttr-reference-data/ttr-reference-maps.json, not
// from our own maps. docs/TICKET-SUGGESTER.md explains where each one comes from, and
// scripts/ticket-suggester-reference.py is the Python original this was ported from. The two use
// different random number generators, so they agree on the metrics, not on the ticket lists.
import { valueTicket, type TicketPath } from "./ticket-valuation";
import { DEFAULT_STARTING_TICKETS, DEFAULT_TICKET_BANDS, DEFAULT_WAGONS_PER_PLAYER, DEFAULT_PLAYERS, lanesUsableAt, type LaneRule, type MapData, type Ticket, type TicketBands, type TicketMix, ticketsInSet } from "./map-data";

/** Our three sets of deck rules. */
export type BuiltInStyle = "generic" | "classic" | "europe";
/** The id of the rules a deck is suggested on: one of ours, or a set of the map's own (DeckRuleSet). */
export type TicketStyle = string;

// Presets, weights and limits in one place, so they can be tuned and their provenance stays visible.
export const TICKET_SUGGESTER = {
  // Length bins as fractions of reach, the longest ticket a player can realistically build.
  binEdges: [0, .30, .45, .60, .75, 1.01],
  styles: {
    // The default. Its targets are the mean of seven official classic decks — USA, Nordic, India,
    // Switzerland, Old West, Polska and Northern Lights — rather than any one game's habits. Scored
    // against the USA-only targets, several official decks came out worse than random decks.
    generic: {
      label: "Generic",
      blurb: "The average of seven official maps, and the safest start for a map of your own.",
      lengths: "A spread with few very short tickets: most sit between a third and half of what a player can build.",
      deck: "About 1.1 tickets per stop, all in one deck.",
      after: "Long tickets reach the edges of the map and short ones stay nearer the middle, but only the wrong side counts against a deck.",
      ticketsPerStop: 1.1,
      longPerStop: 0,
      bins: [.18, .33, .22, .16, .11],
      longRange: null as [number, number] | null,
      bonusFrom: null as number | null,
      lengthCap: .47,
      maxPerStop: 7,
      dupRate: .03,
      periphery: "relative" as "relative" | "point",
    },
    classic: {
      label: "Classic",
      blurb: "The original USA game: one deck, lengths across the whole map.",
      lengths: "Evenly spread all the way out, with a fifth of the deck at the very limit of what a player can build.",
      deck: "About 0.85 tickets per stop, all in one deck.",
      after: "The longest tickets are paid a bonus: +1 near the limit, +2 for the single longest.",
      ticketsPerStop: .85,
      longPerStop: 0,
      bins: [.10, .30, .27, .13, .20],
      longRange: null as [number, number] | null,
      bonusFrom: .9 as number | null,
      lengthCap: .47,
      maxPerStop: 5,
      dupRate: .02,
      periphery: "point" as "relative" | "point",
    },
    europe: {
      label: "Europe",
      blurb: "Two decks: short and medium tickets, plus a few long ones drawn separately.",
      lengths: "The regular deck stays short — four fifths of it below half of what a player can build.",
      deck: "About 0.85 tickets per stop, plus a long deck of about 0.13 per stop at the very edge of the map.",
      after: "No bonus: a long ticket is worth its distance, and the risk is the point.",
      ticketsPerStop: .85,
      longPerStop: .13,
      bins: [.25, .53, .20, .02, .00],
      longRange: [.9, 1] as [number, number] | null,
      bonusFrom: null as number | null,
      lengthCap: .47,
      maxPerStop: 5,
      dupRate: .02,
      periphery: "point" as "relative" | "point",
    },
  },
  // What the official decks actually measure, for the dialog to show beside each number.
  official: {
    lengthCap: [.33, .60] as [number, number],
    maxPerStop: [4, 10] as [number, number],
    perStop: [.83, .98] as [number, number],
    dupPct: [.3, 1.6] as [number, number],
    // Where the official decks end their tickets, measured from each map's average stop on a scale
    // from the middle (0) to the edge (1): long tickets further out, short ones mostly a little in.
    // Aggregated from the reference data with evaluateTicketDeck; they vary far less this way than as
    // distances from the middle, which run from 0.36 (Nordic) to 0.62 (USA) for long tickets.
    longEnds: [["USA", .21], ["India", .21], ["Europe", .20], ["Polska", .17], ["Switzerland", .16], ["Northern Lights", .11], ["Old West", .09], ["Nordic", .06]] as [string, number][],
    shortEnds: [["Northern Lights", .02], ["USA", -.03], ["India", -.06], ["Old West", -.06], ["Europe", -.07], ["Nordic", -.08], ["Switzerland", -.08], ["Polska", -.10]] as [string, number][],
    unusedPct: [14, 27] as [number, number],
  },
  // `load` was 0.5 when the targets were first fitted, which left suggestions spreading their
  // tickets more evenly over the map than the official decks do: they run the busy corridors along
  // routes that have a second lane. At 2 the suggestions match that habit; at 3 the deck starts
  // failing the score checks in docs/TICKET-SUGGESTER.md §6. See docs/ROUTE-LOAD.md §C.
  weights: { bins: 10, ends: 400, cov: 1, zero: .5, dup: 4, unused: 1, load: 2, hard: 2 },
  peripheryLong: .62,
  peripheryShortDelta: -.05,
  unusedRate: .20,
  maxLocos: 2,
  minLengthFraction: .15,
  sampleSize: 80,
  defaultSteps: 6000,
  maxPathsPerPair: 32,
};

export type TicketSuggestOptions = {
  style: TicketStyle;
  // The size of table the bottleneck reading is made for. Only the second lane of a double route
  // depends on it, so it changes what is crowded, never what a ticket is worth.
  atTable: number;
  // Count how many printed values the default valuation reproduces. Off by default: it is only of
  // interest when checking a deck that came with its own points, such as an official map.
  pointsAudit: boolean;
  wagonsPerPlayer: number;
  deckSize?: number;
  seed: number;
  keep: string[];
  steps: number;
  setId?: string;
};

export type Bottleneck = {
  a: string; b: string; length: number; lanes: number; lanesUsable: number;
  load: number; ratio: number; tickets: number; ticketIds: string[]; routeIds: string[];
};

export type TicketDeckReport = {
  style: TicketStyle;
  // Edges that more tickets want than they can carry, read at the table given in the options, and
  // how many there would be at each end of the map's player range.
  bottlenecks: Bottleneck[];
  bottleneckCounts: { smallest: number; largest: number };
  // Mean load on edges with several lanes against mean load on single ones. The official decks put
  // their busiest corridors on double routes, so this sits above 1 on seven of eight of them.
  loadRatio: number | null;
  // Every pair of stops a ticket could join, within what a player can build.
  reachablePairs: [string, string][];
  // How well the default valuation matches the points the deck already carries.
  valuation: { exact: number; total: number; off: { a: string; b: string; printed: number; path: number }[] };
  // How many tickets sit in the map's own short, medium and long bands.
  mix: number[];
  diameter: number;
  reach: number;
  regular: number;
  long: number;
  bins: number[];
  // Tickets left out of the judging: longer than a player can build, or to a stop nothing reaches.
  skipped: number;
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
  // Tickets where a path exists that costs one more space but is built from fewer routes.
  ambiguous: { ticketId: string; a: string; b: string }[];
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

type Edge = { a: string; b: string; weight: number; lanes: number; locos: number; tunnel: boolean; routeId: string; routeIds: string[] };
type Candidate = {
  a: string; b: string; length: number; frac: number; bin: number; mixBand: number; routes: number; ferrySpaces: number;
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
    if (!existing) { byPair.set(key, { a: route.a, b: route.b, weight: route.length, lanes: 1, locos, tunnel, routeId: route.id, routeIds: [route.id] }); continue; }
    existing.lanes += 1;
    existing.routeIds.push(route.id);
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

  bands: TicketBands;
  // Lanes a player may use at the largest table this map is built for, per edge.
  lanesAtLargestTable: number[] = [];
  // Every stop the graph runs through, junctions included. `nodes` is the subset a ticket may end at.
  graphNodes: string[] = [];

  constructor(data: MapData, wagonsPerPlayer: number, lengthCap: number) {
    this.bands = data.ticketBands ?? DEFAULT_TICKET_BANDS;
    const junctionTypes = new Set((data.stopTypeStyles ?? []).filter((style) => style.junction).map((style) => style.id));
    const isJunction = new Map(data.stops.map((stop) => [stop.id, junctionTypes.has(stop.type)]));
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
    this.graphNodes = nodes;
    // Junctions join routes and nothing else: journeys pass through them, but no ticket ends at one
    // and they are not counted when coverage or periphery is worked out.
    this.nodes = nodes.filter((id) => !isJunction.get(id));
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

    const largestTable = data.players?.max ?? DEFAULT_PLAYERS.max;
    this.lanesAtLargestTable = this.edges.map((edge) => lanesUsableAt(largestTable, edge.lanes, data.lanesUsableByPlayers));

    this.reach = Math.max(1, Math.min(this.diameter, Math.floor(lengthCap * wagonsPerPlayer)));

    // How far out a stop sits: mean distance to everything else, rescaled to 0 at the centre and 1
    // at the edge.
    const means = this.dist.map((row) => {
      const usable = row.filter((d) => Number.isFinite(d));
      return usable.length ? usable.reduce((sum, d) => sum + d, 0) / usable.length : 0;
    });
    const ticketMeans = this.nodes.map((id) => means[this.index.get(id)!]);
    const lo = Math.min(...ticketMeans), hi = Math.max(...ticketMeans);
    this.periphery = means.map((m) => (m - lo) / ((hi - lo) || 1));
    this.mapPeriphery = ticketMeans.length ? ticketMeans.reduce((sum, m) => sum + (m - lo) / ((hi - lo) || 1), 0) / ticketMeans.length : 0;
  }

  private dijkstra(source: number) {
    // Over every stop in the graph, junctions included: a journey may well run through one.
    const n = this.graphNodes.length;
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

    // Which of the map's own short/medium/long bands this falls in, measured against the diameter.
    const share = this.diameter > 0 ? length / this.diameter : 0;
    const mixBand = share <= this.bands.medium ? 0 : share < this.bands.long ? 1 : 2;

    // What the ticket costs to build, for the valuation: how many separate routes the easiest path
    // is made of, and how many of its spaces need a locomotive.
    const routes = easiest.edges.length;
    const ferrySpaces = easiest.edges.reduce((sum, edge) => sum + (this.edges[edge].locos > 0 ? this.edges[edge].weight : 0), 0);

    const value: Candidate = {
      a: aId, b: bId, length, frac, bin, mixBand, routes, ferrySpaces, load,
      corridor: [...corridor].map((i) => this.graphNodes[i]),
      locos: cost(easiest),
      tunnels: easiest.edges.reduce((sum, edge) => sum + (this.edges[edge].tunnel ? 1 : 0), 0),
    };
    this.cache.set(key, value);
    return value;
  }

  // Is there a way to build this ticket for exactly one more space but one fewer route? Such a path
  // takes a turn less, and several official +1 cards follow one. Slack never falls along a path, so
  // two states per stop — on the shortest path, or one space over — are enough to find it.
  ambiguous(aId: string, bId: string): boolean {
    const a = this.index.get(aId), b = this.index.get(bId);
    if (a === undefined || b === undefined) return false;
    const n = this.graphNodes.length;
    const best = [new Array<number>(n).fill(Infinity), new Array<number>(n).fill(Infinity)];
    const done = [new Array<boolean>(n).fill(false), new Array<boolean>(n).fill(false)];
    best[0][a] = 0;
    for (;;) {
      let node = -1, slack = 0, fewest = Infinity;
      for (let s = 0; s < 2; s++) for (let i = 0; i < n; i++) if (!done[s][i] && best[s][i] < fewest) { fewest = best[s][i]; node = i; slack = s; }
      if (node < 0) break;
      done[slack][node] = true;
      for (const step of this.adjacency[node]) {
        // A stop the source cannot reach has no slack to speak of.
        if (!Number.isFinite(this.dist[a][node]) || !Number.isFinite(this.dist[a][step.to])) continue;
        const extra = this.dist[a][node] + step.weight - this.dist[a][step.to];
        const next = slack + extra;
        if (next !== 0 && next !== 1) continue;
        if (fewest + 1 < best[next][step.to]) best[next][step.to] = fewest + 1;
      }
    }
    return best[1][b] < best[0][b];
  }

  reachablePairs(): [string, string][] {
    const pairs: [string, string][] = [];
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const length = this.dist[this.index.get(this.nodes[i])!][this.index.get(this.nodes[j])!];
        if (length > 0 && length <= this.reach) pairs.push([this.nodes[i], this.nodes[j]]);
      }
    }
    return pairs;
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
  mixCounts = [0, 0, 0];
  stopCounts: number[];
  edgeLoad: Float64Array;
  peripheryLongSum = 0; peripheryLongCount = 0;
  peripheryShortSum = 0; peripheryShortCount = 0;
  hardSum = 0;
  duplicates = 0;
  members: Candidate[] = [];
  regularCount = 0;

  constructor(private model: SuggesterModel) {
    this.stopCounts = new Array(model.graphNodes.length).fill(0);
    this.edgeLoad = new Float64Array(model.edges.length);
  }

  add(candidate: Candidate, regular: boolean) {
    for (const other of this.members) if (this.model.duplicate(candidate, other)) this.duplicates += 1;
    this.members.push(candidate);
    if (regular) { this.regularCount += 1; this.binCounts[candidate.bin] += 1; }
    this.mixCounts[candidate.mixBand] += 1;
    this.apply(candidate, 1);
  }

  remove(candidate: Candidate, regular: boolean) {
    const at = this.members.indexOf(candidate);
    if (at >= 0) this.members.splice(at, 1);
    for (const other of this.members) if (this.model.duplicate(candidate, other)) this.duplicates -= 1;
    if (regular) { this.regularCount -= 1; this.binCounts[candidate.bin] -= 1; }
    this.mixCounts[candidate.mixBand] -= 1;
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

  score(style: DeckRule, wantRegular: number, mix: TicketMix | null): number {
    const w = TICKET_SUGGESTER.weights;
    const model = this.model;
    // A map that states its own short/medium/long mix is aimed at that, over the whole deck. One
    // that does not follows the style's own spread across the regular deck.
    let bins = 0;
    if (mix) {
      const total = mix.short + mix.medium + mix.long;
      const shares = total > 0 ? [mix.short / total, mix.medium / total, mix.long / total] : [1 / 3, 1 / 3, 1 / 3];
      const want = Math.max(this.members.length, 1);
      for (let i = 0; i < 3; i++) {
        const diff = this.mixCounts[i] - shares[i] * want;
        bins += diff * diff;
      }
      bins /= want;
    } else {
      const n = Math.max(this.regularCount, 1);
      for (let i = 0; i < 5; i++) {
        const diff = this.binCounts[i] - style.bins[i] * wantRegular;
        bins += diff * diff;
      }
      bins /= n;
    }

    const longMean = this.peripheryLongCount ? this.peripheryLongSum / this.peripheryLongCount : null;
    const shortMean = this.peripheryShortCount ? this.peripheryShortSum / this.peripheryShortCount : null;
    // The official decks agree on direction but not on a number: long tickets reach further out than
    // the average stop and short ones sit further in. `generic` therefore only penalises the wrong
    // side; the two single-game styles keep their fitted point targets.
    let ends = 0;
    if (style.longEnds !== undefined || style.shortEnds !== undefined) {
      // A set of the map's own: ends measured from the map's average stop, or no preference, which
      // only marks down the wrong side exactly as Generic does.
      const avg = model.mapPeriphery;
      const longEnds = style.longEnds ?? null, shortEnds = style.shortEnds ?? null;
      if (longMean !== null) ends += longEnds === null ? Math.max(0, avg - longMean) ** 2 : (longMean - (avg + longEnds)) ** 2;
      if (shortMean !== null) ends += shortEnds === null ? Math.max(0, shortMean - avg) ** 2 : (shortMean - (avg + shortEnds)) ** 2;
    } else if (style.periphery === "relative") {
      if (longMean !== null) ends += Math.max(0, model.mapPeriphery - longMean) ** 2;
      if (shortMean !== null) ends += Math.max(0, shortMean - model.mapPeriphery) ** 2;
    } else {
      if (longMean !== null) ends += (longMean - TICKET_SUGGESTER.peripheryLong) ** 2;
      if (shortMean !== null) ends += (shortMean - (model.mapPeriphery + TICKET_SUGGESTER.peripheryShortDelta)) ** 2;
    }

    let cov = 0, zero = 0;
    for (const id of model.nodes) {
      const count = this.stopCounts[model.index.get(id)!];
      if (count === 0) zero += 1;
      const over = count - style.maxPerStop;
      if (over > 0) cov += over * over;
    }

    const pairs = this.members.length * (this.members.length - 1) / 2;
    const dup = Math.max(0, this.duplicates - style.dupRate * pairs);

    let unused = 0, loadSum = 0;
    const perLane = new Float64Array(model.edges.length);
    for (let i = 0; i < model.edges.length; i++) {
      if (this.edgeLoad[i] <= 1e-9) unused += 1;
      perLane[i] = this.edgeLoad[i] / model.lanesAtLargestTable[i];
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
    atTable: options.atTable ?? (data.players?.max ?? DEFAULT_PLAYERS.max),
    pointsAudit: options.pointsAudit ?? false,
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
  // The rules the map has chosen come first, whether ours or its own.
  if (data.deckRule && deckRules(data).some((rule) => rule.id === data.deckRule)) return data.deckRule;
  const deck = setId ? ticketsInSet(data, setId) : data.tickets;
  // A deck that already has long tickets, or a map that deals four or more, is shaped like Europe.
  // Everything else starts from the average of the official maps.
  if (deck.some((ticket) => ticket.long)) return "europe";
  return (data.startingTickets ?? DEFAULT_STARTING_TICKETS) >= 4 ? "europe" : "generic";
}

// Every set of rules the suggester can follow on this map: ours first, fixed, then the map's own.
// A set of the map's own carries the same values as ours, and is described from them.
export type DeckRule = typeof TICKET_SUGGESTER.styles.generic & { id: string; custom: boolean; basedOn: string; longEnds?: number | null; shortEnds?: number | null };
const percent = (share: number) => `${Math.round(share * 100)} %`;
export function deckRules(data: MapData): DeckRule[] {
  const ours = (Object.keys(TICKET_SUGGESTER.styles) as BuiltInStyle[]).map((id): DeckRule => ({ ...TICKET_SUGGESTER.styles[id], id, custom: false, basedOn: id }));
  const own = (data.deckRules ?? []).map((rule): DeckRule => {
    const from = ours.find((item) => item.id === rule.basedOn)?.label ?? "one of ours";
    return {
      ...rule,
      custom: true,
      blurb: `This map's own rules, made from ${from}.`,
      lengths: `Lengths, shortest to longest: ${rule.bins.map(percent).join(" / ")}.`,
      deck: `About ${rule.ticketsPerStop} tickets per stop${rule.longPerStop > 0 ? `, plus a long deck of about ${rule.longPerStop} per stop` : ", all in one deck"}.`,
      after: rule.bonusFrom !== null ? `The longest tickets are paid a bonus from ${percent(rule.bonusFrom)} of reach.` : "No bonus: a ticket is worth its distance.",
    };
  });
  return [...ours, ...own];
}
export function deckRuleFor(data: MapData, id: TicketStyle): DeckRule {
  const all = deckRules(data);
  return all.find((rule) => rule.id === id) ?? all[0];
}

// How many tickets a full table is dealt at the start: the largest table times the tickets each.
export function dealtToFullTable(data: Pick<MapData, "players" | "startingTickets">): number {
  return (data.players?.max ?? DEFAULT_PLAYERS.max) * (data.startingTickets ?? DEFAULT_STARTING_TICKETS);
}

// How big a deck to aim for: the rules' tickets per stop. Never forced up to what a full table is
// dealt: a deck that is too small is warned about where it is chosen, and left to the person, since
// on a small map the official density is fewer tickets than a full table needs.
export function suggestedDeckSize(data: MapData, style: TicketStyle, stops: number): { regular: number; long: number } {
  const preset = deckRuleFor(data, style);
  const long = Math.round(preset.longPerStop * stops);
  const regular = Math.max(1, Math.round(preset.ticketsPerStop * stops));
  return { regular, long };
}

function emptyReport(note: string, styleName: TicketStyle = "generic"): TicketDeckReport {
  return {
    style: styleName, bottlenecks: [], bottleneckCounts: { smallest: 0, largest: 0 }, loadRatio: null, reachablePairs: [], valuation: { exact: 0, total: 0, off: [] },
    mix: [0, 0, 0], diameter: 0, reach: 0, regular: 0, long: 0, skipped: 0, bins: [0, 0, 0, 0, 0],
    longPeriphery: null, shortPeriphery: null, mapPeriphery: 0,
    zeroStops: 0, maxPerStop: 0, duplicatePairs: [], dupPct: 0,
    unusedRoutes: [], unusedPct: 0, hard: [], ambiguous: [], perStop: 0, score: 0, note,
  };
}

const pathOf = (candidate: Candidate, longest: number): TicketPath => ({
  spaces: candidate.length, routes: candidate.routes, ferrySpaces: candidate.ferrySpaces,
  frac: candidate.frac, longest: candidate.length === longest,
});

// Which edges more tickets want than they can carry. An edge is crowded when its load per usable
// lane stands out: among the busiest tenth and wanted by at least three tickets, or at twice the
// average. The fix is nearly always a change to the map — another lane, or another way round — so
// the tickets that cause it are listed with it.
const CROWDED_SHARE = .10, CROWDED_TICKETS = 3, CROWDED_MULTIPLE = 2;

function findBottlenecks(model: SuggesterModel, deck: DeckState, ids: Map<Candidate, string>, atTable: number, rule?: LaneRule): Bottleneck[] {
  if (!model.edges.length) return [];
  const usersOf = new Map<number, Candidate[]>();
  for (const member of deck.members) {
    for (const edge of member.load.keys()) {
      const list = usersOf.get(edge);
      if (list) list.push(member); else usersOf.set(edge, [member]);
    }
  }
  const rows = model.edges.map((edge, index) => {
    const lanesUsable = lanesUsableAt(atTable, edge.lanes, rule);
    const load = deck.edgeLoad[index];
    const users = usersOf.get(index) ?? [];
    return { edge, index, lanesUsable, load, ratio: load / lanesUsable, users };
  });
  const mean = rows.reduce((sum, row) => sum + row.ratio, 0) / rows.length;
  const cut = [...rows].sort((a, b) => b.ratio - a.ratio)[Math.max(0, Math.floor(rows.length * CROWDED_SHARE) - 1)]?.ratio ?? Infinity;
  return rows
    .filter((row) => row.load > 0 && ((row.ratio >= cut && row.users.length >= CROWDED_TICKETS) || row.ratio >= CROWDED_MULTIPLE * mean))
    .sort((a, b) => b.ratio - a.ratio)
    .map((row) => ({
      a: row.edge.a, b: row.edge.b, length: row.edge.weight, lanes: row.edge.lanes, lanesUsable: row.lanesUsable,
      load: row.load, ratio: row.ratio, tickets: row.users.length,
      ticketIds: row.users.map((user) => ids.get(user) ?? "").filter(Boolean),
      routeIds: row.edge.routeIds,
    }));
}

// Mean load on edges with several lanes against mean load on single ones.
function loadRatioOf(model: SuggesterModel, deck: DeckState): number | null {
  let multi = 0, multiCount = 0, single = 0, singleCount = 0;
  model.edges.forEach((edge, index) => {
    if (edge.lanes > 1) { multi += deck.edgeLoad[index]; multiCount += 1; }
    else { single += deck.edgeLoad[index]; singleCount += 1; }
  });
  if (!multiCount || !singleCount || single === 0) return null;
  return (multi / multiCount) / (single / singleCount);
}

function buildReport(model: SuggesterModel, deck: DeckState, styleName: TicketStyle, style: DeckRule, wantRegular: number, longCount: number, ids: Map<Candidate, string>, mix: TicketMix | null, audit: TicketDeckReport["valuation"] | undefined, data: MapData | undefined, atTable: number): TicketDeckReport {
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
  const bottlenecksAt = (table: number) => findBottlenecks(model, deck, ids, table, data?.lanesUsableByPlayers);
  const players = data?.players ?? DEFAULT_PLAYERS;
  return {
    style: styleName,
    bottlenecks: bottlenecksAt(atTable),
    bottleneckCounts: { smallest: bottlenecksAt(players.min).length, largest: bottlenecksAt(players.max).length },
    loadRatio: loadRatioOf(model, deck),
    reachablePairs: model.reachablePairs(),
    valuation: audit ?? { exact: 0, total: 0, off: [] },
    mix: [...deck.mixCounts],
    diameter: model.diameter,
    reach: model.reach,
    regular: deck.regularCount,
    long: longCount,
    bins: [...deck.binCounts],
    skipped: 0,
    longPeriphery: deck.peripheryLongCount ? deck.peripheryLongSum / deck.peripheryLongCount : null,
    shortPeriphery: deck.peripheryShortCount ? deck.peripheryShortSum / deck.peripheryShortCount : null,
    mapPeriphery: model.mapPeriphery,
    zeroStops: model.nodes.filter((id) => deck.stopCounts[model.index.get(id)!] === 0).length,
    maxPerStop: model.nodes.length ? Math.max(...model.nodes.map((id) => deck.stopCounts[model.index.get(id)!])) : 0,
    duplicatePairs,
    dupPct: pairs ? 100 * duplicatePairs.length / pairs : 0,
    unusedRoutes,
    unusedPct: model.edges.length ? 100 * unusedRoutes.length / model.edges.length : 0,
    hard,
    ambiguous: deck.members
      .filter((candidate) => model.ambiguous(candidate.a, candidate.b))
      .map((candidate) => ({ ticketId: ids.get(candidate) ?? "", a: candidate.a, b: candidate.b })),
    perStop: model.nodes.length ? deck.members.length / model.nodes.length : 0,
    score: deck.score(style, wantRegular, mix),
    note: model.note,
  };
}

export function suggestTickets(data: MapData, options: Partial<TicketSuggestOptions> = {}): { tickets: Ticket[]; report: TicketDeckReport } {
  const resolved = resolveOptions(data, options);
  const style = deckRuleFor(data, resolved.style);
  if (data.stops.length < 4 || data.routes.length < 3) {
    return { tickets: [], report: emptyReport("A map needs at least four stops and a few routes before a deck can be suggested.") };
  }
  const mix = data.ticketMix ?? null;
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
      const length = model.distance(model.index.get(model.nodes[i])!, model.index.get(model.nodes[j])!);
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
        const value = deck.score(style, targets[0], mix);
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
  let current = deck.score(style, targets[0], mix);
  for (let step = 0; step < resolved.steps; step++) {
    const group = targets[1] && random() < .15 ? 1 : 0;
    if (groups[group].length <= locked[group] || !pools[group].length) continue;
    const outIndex = locked[group] + Math.floor(random() * (groups[group].length - locked[group]));
    const inIndex = pick(pools[group]);
    const outgoing = groups[group][outIndex], incoming = pools[group][inIndex];
    const regular = group === 0;
    deck.remove(outgoing, regular);
    deck.add(incoming, regular);
    const next = deck.score(style, targets[0], mix);
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
  const longest = Math.max(0, ...groups[0].concat(groups[1]).map((candidate) => candidate.length));
  [groups[0], groups[1]].forEach((group, groupIndex) => {
    group.forEach((candidate, i) => {
      const id = `t-${stamp}-${groupIndex}-${i}`;
      ids.set(candidate, id);
      // The style asks for the long-ticket bonus; the valuation decides what it is worth.
      const value = valueTicket(pathOf(candidate, longest), data, style.bonusFrom !== null ? { longBonus: true } : {});
      tickets.push({ id, a: candidate.a, b: candidate.b, points: value.points, long: groupIndex === 1 ? true : undefined });
    });
  });

  return { tickets, report: buildReport(model, deck, resolved.style, style, targets[0], groups[1].length, ids, mix, undefined, data, resolved.atTable) };
}

// Score the deck the map already has, on the same scale.
export function evaluateTicketDeck(data: MapData, options: Partial<TicketSuggestOptions> = {}): TicketDeckReport {
  const resolved = resolveOptions(data, options);
  const style = deckRuleFor(data, resolved.style);
  const deckTickets = resolved.setId ? ticketsInSet(data, resolved.setId) : data.tickets;
  if (data.stops.length < 4 || data.routes.length < 3) return emptyReport("A map needs at least four stops and a few routes before a deck can be judged.", resolved.style);
  const mix = data.ticketMix ?? null;
  const model = new SuggesterModel(data, resolved.wagonsPerPlayer, style.lengthCap);
  if (model.nodes.length < 4) return emptyReport("Fewer than four stops are connected to anything.", resolved.style);
  if (!deckTickets.length) {
    const report = emptyReport("This deck has no tickets yet.", resolved.style);
    return { ...report, diameter: model.diameter, reach: model.reach, zeroStops: model.nodes.length };
  }

  // How closely the deck's own points follow the shortest path. Measured over every ticket the
  // graph can reach, before the reach filter below, since a printed value is a printed value.
  const audit: TicketDeckReport["valuation"] = { exact: 0, total: 0, off: [] };
  if (resolved.pointsAudit) {
    for (const ticket of deckTickets) {
      const candidate = model.candidate(ticket.a, ticket.b);
      if (!candidate) continue;
      audit.total += 1;
      const value = valueTicket(pathOf(candidate, Infinity), data);
      if (value.points === ticket.points) audit.exact += 1;
      else audit.off.push({ a: ticket.a, b: ticket.b, printed: ticket.points, path: value.points });
    }
  }

  const deck = new DeckState(model);
  const ids = new Map<Candidate, string>();
  let long = 0, skipped = 0;
  for (const ticket of deckTickets) {
    const candidate = model.candidate(ticket.a, ticket.b);
    // Only a ticket a player could actually build is part of the shape being judged: an over-long
    // ticket, or one to a stop the graph does not reach, says nothing about the deck's balance.
    if (!candidate || candidate.length > model.reach) { skipped += 1; continue; }
    ids.set(candidate, ticket.id);
    const isLong = Boolean(ticket.long);
    if (isLong) long += 1;
    deck.add(candidate, !isLong);
  }
  const report = buildReport(model, deck, resolved.style, style, Math.max(deck.regularCount, 1), long, ids, mix, audit, data, resolved.atTable);
  report.skipped = skipped;
  if (skipped) report.note = `${report.note ? `${report.note} ` : ""}${skipped} ticket${skipped === 1 ? "" : "s"} could not be measured and ${skipped === 1 ? "was" : "were"} left out.`;
  return report;
}
