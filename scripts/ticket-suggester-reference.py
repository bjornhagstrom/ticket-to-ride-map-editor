"""Reference implementation of the destination-ticket suggester (see docs/TICKET-SUGGESTER.md).

Not shipped with the editor: it exists so the TypeScript port can be checked against known
numbers. Usage:
    python3 ticket_suggester_reference.py map.json            # an editor export (kind "map"/"network")
    python3 ticket_suggester_reference.py tilburg.xlsx        # the Tilburg balancing spreadsheet
Options: --tickets N  --long K  --trains T  --seed S  --steps N
Requires networkx (pip install networkx; openpyxl only for .xlsx).
"""
import argparse, collections, itertools, json, math, random, sys
import networkx as nx

# ---------------------------------------------------------------- input
def load(path):
    """Return (graph, names). Graph edges carry w = wagon length, lanes = parallel routes."""
    G = nx.Graph(); names = {}
    def add(a, b, w):
        if G.has_edge(a, b):
            G[a][b]["lanes"] += 1; G[a][b]["w"] = min(G[a][b]["w"], w)
        else:
            G.add_edge(a, b, w=w, lanes=1)
    if path.endswith(".json"):
        data = json.load(open(path))
        for s in data["stops"]: names[s["id"]] = s["name"]; G.add_node(s["id"])
        for r in data["routes"]: add(r["a"], r["b"], int(r["length"]))
    else:
        import openpyxl, warnings; warnings.filterwarnings("ignore")
        wb = openpyxl.load_workbook(path, data_only=True)
        for r in list(wb["Connections"].iter_rows(values_only=True))[1:]:
            if not r[0]: continue
            a, b = r[0].strip().lower(), r[1].strip().lower()
            names[a] = r[0].strip(); names[b] = r[1].strip()
            add(a, b, int(r[2]))
            if r[3]: add(a, b, int(r[2]))           # "Double" column = a second lane
    return G, names

# ---------------------------------------------------------------- algorithm
DEFAULTS = dict(ticketsPerStop=2.0, longTickets=6, trainsPerPlayer=45, seed=1, steps=6000,
                binShares=(0.25, 0.50, 0.25), freeLimit=1, similarRatio=0.6,
                w_bins=10.0, w_cov=1.0, w_load=0.5, w_unused=1.0, w_dup=4.0,
                fragileDetour=4)

def suggest(G, opt=None, keep=()):
    o = dict(DEFAULTS, **(opt or {}))
    rng = random.Random(o["seed"])
    nodes = sorted(n for n in G if G.degree(n) > 0)
    D = dict(nx.all_pairs_dijkstra_path_length(G, weight="w"))
    diam = max(max(v.values()) for v in D.values())
    cap = o["trainsPerPlayer"] // 2                      # a ticket should use at most ~half a player's trains
    N = round(o["ticketsPerStop"] * len(nodes))
    K = o["longTickets"]
    longMin = round(0.75 * diam)
    Lmin = max(3, round(0.2 * diam))
    Lmax = min(cap, longMin - 1 if K else diam)
    b1, b2 = round(0.35 * diam), round(0.6 * diam)
    bins = [(Lmin, b1), (b1 + 1, b2 - 1), (b2, Lmax)]
    deg = {n: G.degree(n) for n in nodes}; degsum = sum(deg.values())
    lanes = {frozenset(e): G.edges[e]["lanes"] for e in G.edges}
    edges = list(lanes)

    def candidate(a, b):
        L = D[a][b]
        paths = list(nx.all_shortest_paths(G, a, b, weight="w"))
        load = collections.Counter()
        for p in paths:
            for e in zip(p, p[1:]): load[frozenset(e)] += 1 / len(paths)
        pn = set().union(*map(set, paths))
        must = [e for e, v in load.items() if v > 0.999 and lanes[e] == 1]
        worst = 0
        for e in must:                                   # detour if one single-lane route is taken
            H = G.copy(); H.remove_edge(*tuple(e))
            try: worst = max(worst, nx.dijkstra_path_length(H, a, b, weight="w") - L)
            except nx.NetworkXNoPath: worst = 99
        return dict(a=a, b=b, L=L, load=load, pn=pn, detour=worst)

    # --- 1. long deck: spread-out pairs, distinct endpoints, not near-copies of each other
    longSel = []
    if K:
        pool = [candidate(a, b) for a, b in itertools.combinations(nodes, 2) if longMin <= D[a][b] <= cap]
        used = set()
        pool.sort(key=lambda c: (-c["L"], c["a"], c["b"]))
        while len(longSel) < K and pool:
            def lscore(c):
                clash = sum(1 for s in longSel if len(c["pn"] & s["pn"]) / len(c["pn"] | s["pn"]) > 0.5)
                return (c["a"] in used) + (c["b"] in used) + 2 * clash - 0.05 * c["L"] + 0.001 * rng.random()
            best = min(pool, key=lscore); pool.remove(best); longSel.append(best); used |= {best["a"], best["b"]}

    # --- 2. regular deck
    C = [candidate(a, b) for a, b in itertools.combinations(nodes, 2) if Lmin <= D[a][b] <= Lmax]
    for c in C: c["bin"] = next(i for i, (lo, hi) in enumerate(bins) if lo <= c["L"] <= hi)
    idx = {frozenset((c["a"], c["b"])): i for i, c in enumerate(C)}
    n = len(C)
    dP = lambda x, P: min(D[x][y] for y in P)
    # dup[i][j]: once j's corridor is built, i costs <= freeLimit extra AND they are of similar length
    dup = [[False] * n for _ in range(n)]
    for i, ci in enumerate(C):
        for j, cj in enumerate(C):
            if i != j and min(ci["L"], cj["L"]) / max(ci["L"], cj["L"]) >= o["similarRatio"] \
               and dP(ci["a"], cj["pn"]) + dP(ci["b"], cj["pn"]) <= o["freeLimit"]:
                dup[i][j] = True
    tb = [s * N for s in o["binShares"]]
    tstop = {x: 2 * N * deg[x] / degsum for x in nodes}
    locked = [idx[frozenset(k)] for k in keep if frozenset(k) in idx]

    def score(sel):
        cov = collections.Counter(); bc = [0, 0, 0]; load = collections.Counter()
        for i in sel:
            c = C[i]; cov[c["a"]] += 1; cov[c["b"]] += 1; bc[c["bin"]] += 1; load.update(c["load"])
        for c in longSel: load.update(c["load"])
        f_bins = sum((bc[k] - tb[k]) ** 2 for k in range(3)) / N
        f_cov = sum((cov[x] - tstop[x]) ** 2 for x in nodes) + 20 * sum(cov[x] == 0 for x in nodes)
        per = [load[e] / lanes[e] for e in edges]; mean = sum(per) / len(per)
        f_load = sum((p - mean) ** 2 for p in per) / len(per)
        f_unused = sum(load[e] == 0 for e in edges)
        f_dup = sum(1 for x, i in enumerate(sel) for j in sel[x + 1:] if dup[i][j] or dup[j][i])
        total = (o["w_bins"] * f_bins + o["w_cov"] * f_cov + o["w_load"] * f_load
                 + o["w_unused"] * f_unused + o["w_dup"] * f_dup)
        return total, dict(bins=bc, unused=f_unused, dupPairs=f_dup,
                           coverage=(min(cov[x] for x in nodes), max(cov[x] for x in nodes)))

    # greedy start, then simulated annealing with swap moves (locked tickets never leave)
    sel = list(locked); pool = set(range(n)) - set(sel)
    while len(sel) < N and pool:
        sample = rng.sample(sorted(pool), min(120, len(pool)))
        best = min(sample, key=lambda i: score(sel + [i])[0]); sel.append(best); pool.discard(best)
    cur = score(sel)[0]
    free_slots = [k for k, i in enumerate(sel) if i not in locked]
    for step in range(o["steps"]):
        T = 5.0 * (1 - step / o["steps"]) + 0.01
        k = rng.choice(free_slots); j = rng.choice(sorted(pool))
        new = sel[:]; old = new[k]; new[k] = j
        s = score(new)[0]
        if s < cur or rng.random() < math.exp((cur - s) / T):
            pool.add(old); pool.discard(j); sel = new; cur = s
    total, metrics = score(sel)

    def ticket(c, long=False):
        return dict(a=c["a"], b=c["b"], distance=c["L"], detour=c["detour"], long=long,
                    points=c["L"] + (1 if c["detour"] >= o["fragileDetour"] else 0))
    out = [ticket(C[i]) for i in sel] + [ticket(c, True) for c in longSel]
    meta = dict(diameter=diam, tickets=N, longTickets=len(longSel), binRanges=bins,
                candidates=n, score=round(total, 1), **metrics)
    return out, meta

# ---------------------------------------------------------------- cli
if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("path")
    ap.add_argument("--tickets", type=float, help="tickets per stop (default 2.0)")
    ap.add_argument("--long", type=int); ap.add_argument("--trains", type=int)
    ap.add_argument("--seed", type=int); ap.add_argument("--steps", type=int)
    a = ap.parse_args()
    opt = {k: v for k, v in dict(ticketsPerStop=a.tickets, longTickets=a.long, trainsPerPlayer=a.trains,
                                  seed=a.seed, steps=a.steps).items() if v is not None}
    G, names = load(a.path)
    tickets, meta = suggest(G, opt)
    print(json.dumps(meta))
    for t in sorted(tickets, key=lambda t: (t["long"], -t["points"])):
        print(f'{"LONG " if t["long"] else ""}{names[t["a"]]} – {names[t["b"]]}: {t["points"]} p '
              f'(path {t["distance"]}, worst detour {t["detour"]})')
