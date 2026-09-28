"""Reference implementation of the destination-ticket suggester (docs/TICKET-SUGGESTER.md).

Calibrated on the official USA and Europe decks in data/ttr-reference-maps.json. Not shipped with
the editor: it exists so the TypeScript port can be checked against known numbers.

    python3 scripts/ticket-suggester-reference.py data/ttr-reference-maps.json#usa     # official map by id
    python3 scripts/ticket-suggester-reference.py my-map.json                          # editor export
    options: --style classic|europe  --trains 45  --seed 1  --steps 6000  --evaluate

--evaluate scores the tickets already in the file instead of suggesting new ones.
Requires networkx (pip install networkx).
"""
import argparse, collections, itertools, json, math, random, statistics as st
import networkx as nx

# ------------------------------------------------------------------------- calibration
# Length bins are fractions of `reach` = min(diameter, 0.47 × trainsPerPlayer).
BIN_EDGES = [0.0, 0.30, 0.45, 0.60, 0.75, 1.01]
STYLES = {
    # USA: one deck, ~0.85 tickets per stop, lengths spread over the whole reach
    "classic": dict(ticketsPerStop=0.85, longPerStop=0.0,
                    bins=[0.10, 0.30, 0.27, 0.13, 0.20], longRange=None, bonusFrom=0.9),
    # Europe: short/medium regular deck + a separate long deck at the edge of reach
    "europe":  dict(ticketsPerStop=0.85, longPerStop=0.13,
                    bins=[0.25, 0.53, 0.20, 0.02, 0.00], longRange=(0.9, 1.0), bonusFrom=None),
}
PERIPHERY_LONG = 0.62        # mean periphery (0 = centre, 1 = edge) of long-ticket endpoints, both games
PERIPHERY_SHORT_DELTA = -0.05  # short-ticket endpoints sit slightly more central than the average stop
DUP_RATE = 0.02              # official decks: 0.3–1.6 % of pairs are near-duplicates
UNUSED_RATE = 0.20           # official decks: 14–27 % of routes lie on no ticket's shortest path
MAX_PER_STOP = 5             # official decks: at most 4–5 tickets name one stop
MAX_LOCOS = 2                # no official regular ticket needs more than 2 ferry locomotives
W = dict(bins=10.0, ends=40.0, cov=1.0, zero=0.5, dup=4.0, unused=1.0, load=0.5, hard=2.0)

# ------------------------------------------------------------------------- input
def load(spec):
    """Return (graph, names, tickets). Edges: w = length, lanes, locos, tunnel."""
    path, _, mid = spec.partition("#")
    data = json.load(open(path))
    if "maps" in data:
        data = next(m for m in data["maps"] if m["id"] == mid)
    G = nx.Graph(); names = {s["id"]: s["name"] for s in data["stops"]}
    G.add_nodes_from(names)
    for r in data["routes"]:
        a, b, w = r["a"], r["b"], int(r["length"])
        locos = r.get("ferryLocomotives", len(r.get("locomotiveSlots", []) or []))
        tunnel = bool(r.get("tunnel") or r.get("wagonStyle") == "tunnel")
        if G.has_edge(a, b):
            e = G[a][b]; e["lanes"] += 1
            if w < e["w"]: e.update(w=w, locos=locos, tunnel=tunnel)
        else:
            G.add_edge(a, b, w=w, lanes=1, locos=locos, tunnel=tunnel)
    G.remove_nodes_from([n for n in list(G) if G.degree(n) == 0])
    return G, names, data.get("tickets", [])

# ------------------------------------------------------------------------- model
class Model:
    def __init__(self, G, trains=45, style="classic"):
        self.G, self.s = G, STYLES[style]
        self.nodes = sorted(G)
        self.D = dict(nx.all_pairs_dijkstra_path_length(G, weight="w"))
        self.diam = max(max(v.values()) for v in self.D.values())
        self.reach = min(self.diam, int(0.47 * trains))
        per = {n: st.mean(self.D[n].values()) for n in self.nodes}
        lo, hi = min(per.values()), max(per.values())
        self.per = {n: (per[n] - lo) / ((hi - lo) or 1) for n in self.nodes}
        self.perMean = st.mean(self.per.values())
        self.lanes = {frozenset(e): G.edges[e]["lanes"] for e in G.edges}
        self.cache = {}

    def cand(self, a, b):
        k = frozenset((a, b))
        if k in self.cache: return self.cache[k]
        G, L = self.G, self.D[a][b]
        paths = list(itertools.islice(nx.all_shortest_paths(G, a, b, weight="w"), 32))
        load = collections.Counter()
        for p in paths:
            for e in zip(p, p[1:]): load[frozenset(e)] += 1 / len(paths)
        cost = lambda p: sum(G.edges[e]["locos"] for e in zip(p, p[1:]))
        easiest = min(paths, key=cost)
        c = dict(a=a, b=b, L=L, frac=L / self.reach, load=load, pn=set().union(*map(set, paths)),
                 locos=cost(easiest), tunnels=sum(G.edges[e]["tunnel"] for e in zip(easiest, easiest[1:])))
        c["bin"] = next(i for i in range(5) if BIN_EDGES[i] <= c["frac"] < BIN_EDGES[i + 1])
        self.cache[k] = c
        return c

    def dup(self, x, y):
        if min(x["L"], y["L"]) / max(x["L"], y["L"]) < 0.6: return False
        dP = lambda s, P: min(self.D[s][t] for t in P)
        return (dP(x["a"], y["pn"]) + dP(x["b"], y["pn"]) <= 1) or (dP(y["a"], x["pn"]) + dP(y["b"], x["pn"]) <= 1)

    def score(self, reg, lng, nReg):
        """reg / lng: lists of candidates. Lower is better. Returns (total, metrics)."""
        s, allT = self.s, reg + lng
        bc = [0] * 5
        for c in reg: bc[c["bin"]] += 1
        f_bins = sum((bc[i] - s["bins"][i] * nReg) ** 2 for i in range(5)) / max(nReg, 1)
        longish = [c for c in allT if c["frac"] >= 0.6]; short = [c for c in allT if c["frac"] < 0.6]
        pm = lambda T: st.mean(self.per[c[k]] for c in T for k in "ab") if T else None
        pl, ps = pm(longish), pm(short)
        f_ends = ((pl - PERIPHERY_LONG) ** 2 if pl is not None else 0) + \
                 ((ps - (self.perMean + PERIPHERY_SHORT_DELTA)) ** 2 if ps is not None else 0)
        cov = collections.Counter(c[k] for c in allT for k in "ab")
        f_cov = sum(max(0, cov[n] - MAX_PER_STOP) ** 2 for n in self.nodes)
        zero = sum(cov[n] == 0 for n in self.nodes)
        pairs = len(allT) * (len(allT) - 1) / 2
        dups = sum(self.dup(x, y) for x, y in itertools.combinations(allT, 2))
        f_dup = max(0, dups - DUP_RATE * pairs)
        load = collections.Counter()
        for c in allT: load.update(c["load"])
        unused = sum(load[e] == 0 for e in self.lanes)
        f_unused = max(0, unused - UNUSED_RATE * len(self.lanes))
        perlane = [load[e] / self.lanes[e] for e in self.lanes]; mu = st.mean(perlane)
        f_load = st.mean((p - mu) ** 2 for p in perlane)
        f_hard = sum(max(0, c["locos"] - MAX_LOCOS) for c in allT)
        total = (W["bins"] * f_bins + W["ends"] * f_ends * 10 + W["cov"] * f_cov + W["zero"] * zero +
                 W["dup"] * f_dup + W["unused"] * f_unused + W["load"] * f_load + W["hard"] * f_hard)
        return total, dict(bins=bc, longPeriphery=pl and round(pl, 2), shortPeriphery=ps and round(ps, 2),
                           zeroStops=zero, maxPerStop=max(cov.values()) if cov else 0, dupPairs=dups,
                           dupPct=round(100 * dups / pairs, 1) if pairs else 0,
                           unusedPct=round(100 * unused / len(self.lanes)), score=round(total, 1))

    def points(self, c):
        b = self.s["bonusFrom"]
        return c["L"] + (1 if b and c["frac"] >= b else 0)

# ------------------------------------------------------------------------- search
def suggest(G, style="classic", trains=45, seed=1, steps=6000, keep=()):
    m = Model(G, trains, style); s = m.s; rng = random.Random(seed)
    nReg = round(s["ticketsPerStop"] * len(m.nodes)); nLong = round(s["longPerStop"] * len(m.nodes))
    pairs = [(a, b) for a, b in itertools.combinations(m.nodes, 2)]
    lo = max(3, round(0.15 * m.reach))
    lr = s["longRange"]
    regPool = [m.cand(a, b) for a, b in pairs if lo <= m.D[a][b] <= m.reach and (not lr or m.D[a][b] / m.reach < lr[0])]
    longPool = [m.cand(a, b) for a, b in pairs if lr and lr[0] <= m.D[a][b] / m.reach <= lr[1]]
    keepset = {frozenset(k) for k in keep}
    groups = [[c for c in regPool if frozenset((c["a"], c["b"])) in keepset],
              [c for c in longPool if frozenset((c["a"], c["b"])) in keepset]]
    locked = [len(groups[0]), len(groups[1])]
    pools = [[c for c in regPool if c not in groups[0]], [c for c in longPool if c not in groups[1]]]
    want = [nReg, nLong]
    sc = lambda: m.score(groups[0], groups[1], nReg)[0]
    for g in (1, 0):                                    # greedy fill, long deck first
        while len(groups[g]) < want[g] and pools[g]:
            sample = rng.sample(pools[g], min(80, len(pools[g])))
            def trial(c):
                groups[g].append(c); v = sc(); groups[g].pop(); return v
            best = min(sample, key=trial); groups[g].append(best); pools[g].remove(best)
    cur = sc()
    for k in range(steps):                              # simulated annealing, swap within a group
        g = 1 if (want[1] and rng.random() < 0.15) else 0
        if len(groups[g]) <= locked[g] or not pools[g]: continue
        i = rng.randrange(locked[g], len(groups[g])); j = rng.randrange(len(pools[g]))
        groups[g][i], pools[g][j] = pools[g][j], groups[g][i]
        new = sc(); T = 5.0 * (1 - k / steps) + 0.01
        if new < cur or rng.random() < math.exp((cur - new) / T): cur = new
        else: groups[g][i], pools[g][j] = pools[g][j], groups[g][i]
    _, metrics = m.score(groups[0], groups[1], nReg)
    out = [dict(a=c["a"], b=c["b"], points=m.points(c), distance=c["L"], locos=c["locos"],
                tunnels=c["tunnels"], long=(g == 1)) for g in (0, 1) for c in groups[g]]
    return out, dict(diameter=m.diam, reach=m.reach, regular=len(groups[0]), long=len(groups[1]), **metrics)

def evaluate(G, tickets, style="classic", trains=45):
    m = Model(G, trains, style)
    reg = [m.cand(t["a"], t["b"]) for t in tickets if not t.get("long")]
    lng = [m.cand(t["a"], t["b"]) for t in tickets if t.get("long")]
    _, metrics = m.score(reg, lng, len(reg))
    ptsDiff = collections.Counter(t["points"] - m.D[t["a"]][t["b"]] for t in tickets)
    return dict(diameter=m.diam, reach=m.reach, regular=len(reg), long=len(lng),
                pointsMinusPath=dict(sorted(ptsDiff.items())), **metrics)

# ------------------------------------------------------------------------- cli
if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("map")
    ap.add_argument("--style", default="classic", choices=STYLES); ap.add_argument("--trains", type=int, default=45)
    ap.add_argument("--seed", type=int, default=1); ap.add_argument("--steps", type=int, default=6000)
    ap.add_argument("--evaluate", action="store_true")
    a = ap.parse_args()
    G, names, tickets = load(a.map)
    if a.evaluate:
        print(json.dumps(evaluate(G, tickets, a.style, a.trains), ensure_ascii=False)); raise SystemExit
    out, meta = suggest(G, a.style, a.trains, a.seed, a.steps)
    print(json.dumps(meta, ensure_ascii=False))
    for t in sorted(out, key=lambda t: (t["long"], -t["points"])):
        print(f'{"LONG " if t["long"] else ""}{names[t["a"]]} – {names[t["b"]]}: {t["points"]} p '
              f'(path {t["distance"]}, locos {t["locos"]}, tunnels {t["tunnels"]})')
