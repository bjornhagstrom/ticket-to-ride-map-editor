// Reading spreadsheets back: stops, routes and tickets as CSV, from our own exports, from the
// reference data's exports, or from a list somebody typed. The kind of file is told from its header,
// names (or a stop file's ids) tie the files together, and positions are kept when they fit the
// board, fitted to it when they do not, and worked out from the routes when there are none.
// Anything that cannot be used is left out and said so in `warnings`.
import { colorLabels, mapFormats, routeColors, type MapData, type Route, type Stop, type Ticket, type TicketSet } from "./map-data";
import { normalizeTicketFile, type TicketFile } from "./map-storage";

export type CsvFileKind = "stops" | "routes" | "tickets" | "distances" | "unknown";
export type CsvImport = {
  stops: Stop[]; routes: Route[]; sets: TicketSet[]; tickets: Ticket[];
  // True when the files held stops or routes, so the network is to be replaced; false for tickets alone.
  network: boolean;
  // Names of the stops whose position was worked out rather than read.
  placed: string[];
  // True when the positions read were fitted to the board rather than kept as they were.
  scaled: boolean;
  dropped: number;
  warnings: string[];
};

// RFC 4180, with whichever of comma, semicolon and tab the first line uses most (Swedish Excel saves
// with semicolons). A leading apostrophe that our export put before formula-like text is taken off.
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, "");
  const firstLine = body.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, "");
  const delimiter = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const endCell = () => { row.push(/^'[=+\-@]/.test(cell) ? cell.slice(1) : cell); cell = ""; };
  const endRow = () => { endCell(); rows.push(row); row = []; };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) endCell();
    else if (c === "\n") endRow();
    else if (c === "\r" && body[i + 1] === "\n") { endRow(); i++; }
    else cell += c;
  }
  if (cell || row.length) endRow();
  while (rows.length && rows[rows.length - 1].every((value) => !value.trim())) rows.pop();
  return rows;
}

const headerOf = (rows: string[][]) => (rows[0] ?? []).map((name) => name.trim().toLowerCase());
const column = (header: string[], ...names: string[]) => { for (const name of names) { const index = header.indexOf(name); if (index >= 0) return index; } return -1; };
const FROM = ["from", "a"], TO = ["to", "b"];

export function csvFileKind(rows: string[][]): CsvFileKind {
  const header = headerOf(rows);
  if (!header.length) return "unknown";
  // Our distance table: an empty corner, then the same names across the top as down the side.
  if (header[0] === "" && header.length > 2 && rows.length === header.length && rows.slice(1).every((row, i) => row[0]?.trim().toLowerCase() === header[i + 1])) return "distances";
  const ends = column(header, ...FROM) >= 0 && column(header, ...TO) >= 0;
  if (ends && column(header, "points") >= 0) return "tickets";
  if (ends && column(header, "length") >= 0) return "routes";
  if (!ends && column(header, "name") >= 0) return "stops";
  return "unknown";
}

const number = (value: string | undefined) => { const text = (value ?? "").trim().replace(",", "."); if (!text) return null; const parsed = Number(text); return Number.isFinite(parsed) ? parsed : null; };
const yes = (value: string | undefined) => /^(yes|true|1|ja|y)$/i.test((value ?? "").trim());
const listed = (names: string[]) => { const unique = [...new Set(names)]; return `${unique.slice(0, 5).join(", ")}${unique.length > 5 ? ` and ${unique.length - 5} more` : ""}`; };
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function readCsvImport(files: { name: string; text: string }[], data: MapData): CsvImport {
  const warnings: string[] = [];
  const sorted: Record<CsvFileKind, { name: string; rows: string[][] }[]> = { stops: [], routes: [], tickets: [], distances: [], unknown: [] };
  for (const file of files) { const rows = parseCsv(file.text); sorted[csvFileKind(rows)].push({ name: file.name, rows }); }
  for (const file of sorted.distances) warnings.push(`${file.name} is a table of distances, which cannot be read back: import the stops and routes instead.`);
  for (const file of sorted.unknown) warnings.push(`${file.name} is not a stop, route or ticket file, so it was left out.`);

  const stamp = Date.now();
  const network = sorted.stops.length > 0 || sorted.routes.length > 0;
  const stops: Stop[] = [];
  const read = new Map<Stop, { x: number; y: number; geo: boolean }>();
  // A stop is found by the id its own file gave it, or by name.
  const byKey = new Map<string, Stop>();
  const junction = data.stopTypeStyles.find((style) => style.junction)?.id;
  const plainStop = data.stopTypeStyles.some((style) => style.id === "city") ? "city" : data.stopTypeStyles.find((style) => !style.junction)?.id ?? "city";
  const addStop = (name: string, type = plainStop) => { const stop: Stop = { id: `s-${stamp}-${stops.length}`, name, type, x: 0, y: 0 }; stops.push(stop); byKey.set(name.toLowerCase(), stop); return stop; };

  // ---- stops
  const twice: string[] = [], unknownTypes: string[] = [];
  for (const file of sorted.stops) {
    const header = headerOf(file.rows);
    const at = { id: column(header, "id"), name: column(header, "name"), type: column(header, "type"), kind: column(header, "kind"), x: column(header, "x"), y: column(header, "y"),
      lat: column(header, "lat", "latitude"), lon: column(header, "lon", "lng", "long", "longitude") };
    for (const row of file.rows.slice(1)) {
      const name = (row[at.name] ?? "").trim() || (row[at.id] ?? "").trim();
      if (!name) continue;
      if (byKey.has(name.toLowerCase())) { twice.push(name); continue; }
      const kind = (row[at.kind] ?? "").trim().toLowerCase();
      const typeText = (row[at.type] ?? "").trim().toLowerCase();
      let type = plainStop;
      if (kind === "waypoint" && junction) type = junction;
      if (typeText) {
        const style = data.stopTypeStyles.find((item) => item.id.toLowerCase() === typeText || item.label.toLowerCase() === typeText);
        if (style) type = style.id; else unknownTypes.push(row[at.type].trim());
      }
      const stop = addStop(name, type);
      const id = (row[at.id] ?? "").trim();
      if (id) byKey.set(id.toLowerCase(), stop);
      const x = number(row[at.x]), y = number(row[at.y]);
      if (x !== null && y !== null) read.set(stop, { x, y, geo: false });
      else { const lat = number(row[at.lat]), lon = number(row[at.lon]); if (lat !== null && lon !== null) read.set(stop, { x: lon, y: lat, geo: true }); }
    }
  }
  if (twice.length) warnings.push(`${listed(twice)} ${twice.length === 1 ? "is" : "are"} named more than once in the stop file; the first was kept.`);
  if (unknownTypes.length) warnings.push(`Stop types this map does not have became regular stops: ${listed(unknownTypes)}.`);

  // ---- routes
  const routes: Route[] = [];
  const missing: string[] = [], colours: string[] = [], routeTypes: string[] = [];
  let unusable = 0, missingRoutes = 0;
  const colourKey = (text: string) => {
    const value = text.trim().toLowerCase();
    if (!value || value === "grey" || value === "gray" || value === "neutral" || value === "any") return "neutral";
    const key = Object.keys(routeColors).find((item) => item === value || colorLabels[item]?.toLowerCase() === value);
    if (key) return key;
    colours.push(text.trim());
    return "neutral";
  };
  const plainRoute = data.routeTypeStyles.some((style) => style.id === "city") ? "city" : data.routeTypeStyles[0]?.id ?? "city";
  for (const file of sorted.routes) {
    const header = headerOf(file.rows);
    const at = { a: column(header, ...FROM), b: column(header, ...TO), length: column(header, "length"), colour: column(header, "colour", "color"), type: column(header, "type"), kind: column(header, "kind"),
      wagon: column(header, "wagon style"), tunnel: column(header, "tunnel"), locos: column(header, "locomotives", "ferrylocomotives") };
    for (const row of file.rows.slice(1)) {
      const ends = [row[at.a], row[at.b]].map((text) => (text ?? "").trim());
      if (!ends[0] && !ends[1]) continue;
      const found = ends.map((name) => byKey.get(name.toLowerCase()) ?? (sorted.stops.length || !name ? null : addStop(name)));
      if (!found[0] || !found[1]) { missingRoutes += 1; ends.forEach((name, i) => { if (!found[i] && name) missing.push(name); }); continue; }
      const length = number(row[at.length]);
      if (length === null || length < 1 || !Number.isInteger(length) || found[0] === found[1]) { unusable += 1; continue; }
      const kind = (row[at.kind] ?? "").trim().toLowerCase();
      const typeText = (row[at.type] ?? "").trim().toLowerCase();
      let type = kind === "ship" && data.routeTypeStyles.some((style) => style.id === "boat") ? "boat" : plainRoute;
      if (typeText) {
        const style = data.routeTypeStyles.find((item) => item.id.toLowerCase() === typeText || item.label.toLowerCase() === typeText);
        if (style) type = style.id; else routeTypes.push(row[at.type].trim());
      }
      const wagonText = (row[at.wagon] ?? "").trim().toLowerCase();
      const wagonStyle = wagonText ? (data.wagonStyles ?? []).find((item) => item.id.toLowerCase() === wagonText || item.label.toLowerCase() === wagonText)?.id
        : yes(row[at.tunnel]) ? (data.wagonStyles ?? []).find((item) => item.id === "tunnel")?.id : undefined;
      const locos = Math.max(0, Math.min(length, Math.round(number(row[at.locos]) ?? 0)));
      const route: Route = { id: `r-${stamp}-${routes.length}`, a: found[0].id, b: found[1].id, length, type, color: colourKey(row[at.colour] ?? "") };
      if (wagonStyle) route.wagonStyle = wagonStyle;
      if (locos) route.locomotiveSlots = Array.from({ length: locos }, (_, index) => index);
      routes.push(route);
    }
  }
  if (missingRoutes) warnings.push(`${plural(missingRoutes, "route names a stop", "routes name stops")} the stop file does not have (${listed(missing)}), and ${missingRoutes === 1 ? "was" : "were"} left out.`);
  if (unusable) warnings.push(`${plural(unusable, "route", "routes")} had no usable length, or joined a stop to itself, and ${unusable === 1 ? "was" : "were"} left out.`);
  if (colours.length) warnings.push(`Colours the editor does not have became grey: ${listed(colours)}.`);
  if (routeTypes.length) warnings.push(`Route types this map does not have became railways: ${listed(routeTypes)}.`);

  // ---- positions
  const board = mapFormats[data.format] ?? mapFormats["board-2x3"];
  const { placed, scaled } = position(stops, routes, read, board);
  if (placed.length) warnings.push(`${plural(placed.length, "stop", "stops")} had no position and ${placed.length === 1 ? "was" : "were"} laid out from the routes: drag ${placed.length === 1 ? "it" : "them"} into place (${listed(placed)}).`);

  // ---- tickets, through the same reader as a ticket file, so decks arrive the same way
  let sets: TicketSet[] = [], tickets: Ticket[] = [], dropped = 0;
  if (sorted.tickets.length) {
    const lookup = network ? byKey : new Map<string, Stop>([...data.stops.map((stop) => [stop.id.toLowerCase(), stop] as const), ...data.stops.map((stop) => [stop.name.trim().toLowerCase(), stop] as const)]);
    const raw: TicketFile = { kind: "tickets", map: data.name, sets: [], tickets: [] };
    const decks = new Map<string, string>();
    for (const file of sorted.tickets) {
      const header = headerOf(file.rows);
      const at = { deck: column(header, "deck"), a: column(header, ...FROM), b: column(header, ...TO), points: column(header, "points"), long: column(header, "long deck", "long") };
      for (const row of file.rows.slice(1)) {
        const label = (row[at.deck] ?? "").trim() || "Imported deck";
        if (!decks.has(label)) { decks.set(label, `deck-${decks.size}`); raw.sets.push({ id: decks.get(label)!, label }); }
        const ends = [row[at.a], row[at.b]].map((text) => (text ?? "").trim());
        const found = ends.map((name) => lookup.get(name.toLowerCase()));
        raw.tickets.push({ id: "", a: found[0]?.id ?? "", b: found[1]?.id ?? "", aName: found[0]?.name ?? "", bName: found[1]?.name ?? "", points: number(row[at.points]) ?? 1, long: yes(row[at.long]) || undefined, set: decks.get(label) });
      }
    }
    ({ sets, tickets, dropped } = normalizeTicketFile(raw, { ...data, stops: network ? stops : data.stops }));
    if (dropped) warnings.push(`${plural(dropped, "ticket names a stop", "tickets name stops")} ${network ? "the stop file" : "this map"} does not have, and ${dropped === 1 ? "was" : "were"} left out.`);
  }
  return { stops, routes, sets, tickets, network, placed, scaled, dropped, warnings };
}

// Positions: read ones are kept when they all fit the board, and fitted to it, shape kept, when they
// do not (pixels from a scan, or latitude and longitude). Missing ones are worked out from the routes:
// between the neighbours that have a place, or, when nothing has a place, by a spring layout.
function position(stops: Stop[], routes: Route[], read: Map<Stop, { x: number; y: number; geo: boolean }>, board: { width: number; height: number }): { placed: string[]; scaled: boolean } {
  const margin = 50;
  let scaled = false;
  const known = stops.filter((stop) => read.has(stop));
  const geo = known.length > 0 && known.every((stop) => read.get(stop)!.geo);
  if (geo) {
    const midLat = known.reduce((sum, stop) => sum + read.get(stop)!.y, 0) / known.length;
    for (const stop of known) { const { x, y } = read.get(stop)!; stop.x = x * Math.cos((midLat * Math.PI) / 180); stop.y = -y; }
  } else for (const stop of known) { const { x, y } = read.get(stop)!; stop.x = x; stop.y = y; }
  const fits = known.every((stop) => stop.x >= 0 && stop.x <= board.width && stop.y >= 0 && stop.y <= board.height);
  if (known.length && (geo || !fits)) { fit(known, board, margin); scaled = true; }

  const near = new Map(stops.map((stop) => [stop, [] as Stop[]]));
  const byId = new Map(stops.map((stop) => [stop.id, stop]));
  for (const route of routes) { const a = byId.get(route.a)!, b = byId.get(route.b)!; near.get(a)!.push(b); near.get(b)!.push(a); }
  const unknown = stops.filter((stop) => !read.has(stop));
  if (!unknown.length) return { placed: [], scaled };

  if (!known.length) springLayout(stops, routes, board, margin);
  else {
    const done = new Set(known);
    let progress = true;
    while (progress) {
      progress = false;
      for (const stop of unknown) {
        if (done.has(stop)) continue;
        const anchors = near.get(stop)!.filter((other) => done.has(other));
        if (!anchors.length) continue;
        stop.x = anchors.reduce((sum, other) => sum + other.x, 0) / anchors.length;
        stop.y = anchors.reduce((sum, other) => sum + other.y, 0) / anchors.length;
        // A stop with a single placed neighbour would land on top of it: set it a little way off.
        if (anchors.length === 1) { stop.x += 40; stop.y += 30; }
        done.add(stop);
        progress = true;
      }
    }
    // What nothing leads to waits in a row along the top, to be dragged into place.
    unknown.filter((stop) => !done.has(stop)).forEach((stop, index) => { stop.x = margin + (index % 14) * 70; stop.y = 30 + Math.floor(index / 14) * 40; });
  }
  spreadApart(stops, new Set(unknown), board, 30);
  for (const stop of unknown) { stop.x = Math.round(stop.x * 10) / 10; stop.y = Math.round(stop.y * 10) / 10; }
  return { placed: unknown.map((stop) => stop.name), scaled };
}

function fit(stops: Stop[], board: { width: number; height: number }, margin: number) {
  const xs = stops.map((stop) => stop.x), ys = stops.map((stop) => stop.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const width = maxX - minX, height = maxY - minY;
  const scale = Math.min(width ? (board.width - 2 * margin) / width : Infinity, height ? (board.height - 2 * margin) / height : Infinity);
  const k = Number.isFinite(scale) ? scale : 1;
  const offsetX = (board.width - width * k) / 2, offsetY = (board.height - height * k) / 2;
  for (const stop of stops) { stop.x = Math.round((offsetX + (stop.x - minX) * k) * 10) / 10; stop.y = Math.round((offsetY + (stop.y - minY) * k) * 10) / 10; }
}

// Fruchterman–Reingold from a circle, deterministic: the same file always gives the same layout.
// Routes pull with a rest length that follows their wagon count, so a long route stays long.
function springLayout(stops: Stop[], routes: Route[], board: { width: number; height: number }, margin: number) {
  const n = stops.length;
  const index = new Map(stops.map((stop, i) => [stop.id, i]));
  const pos = stops.map((_, i) => ({ x: Math.cos((2 * Math.PI * i) / n) * 300, y: Math.sin((2 * Math.PI * i) / n) * 200 }));
  const k = Math.sqrt((board.width * board.height) / Math.max(1, n));
  const edges = routes.map((route) => [index.get(route.a)!, index.get(route.b)!, route.length] as const);
  const meanLength = edges.length ? edges.reduce((sum, edge) => sum + edge[2], 0) / edges.length : 1;
  let temperature = board.width / 8;
  for (let step = 0; step < 500; step++) {
    const move = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y, d = Math.max(.01, Math.hypot(dx, dy)), f = (k * k) / d;
      move[i].x += (dx / d) * f; move[i].y += (dy / d) * f; move[j].x -= (dx / d) * f; move[j].y -= (dy / d) * f;
    }
    for (const [a, b, length] of edges) {
      const dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y, d = Math.max(.01, Math.hypot(dx, dy)), f = (d * d) / (k * (length / meanLength));
      move[a].x -= (dx / d) * f; move[a].y -= (dy / d) * f; move[b].x += (dx / d) * f; move[b].y += (dy / d) * f;
    }
    // A little gravity, so a part of the map that no route joins does not drift off.
    for (let i = 0; i < n; i++) { move[i].x -= pos[i].x * .02 * k / 100; move[i].y -= pos[i].y * .02 * k / 100; }
    for (let i = 0; i < n; i++) {
      const length = Math.max(.01, Math.hypot(move[i].x, move[i].y));
      pos[i].x += (move[i].x / length) * Math.min(length, temperature);
      pos[i].y += (move[i].y / length) * Math.min(length, temperature);
    }
    temperature = Math.max(1, temperature * .985);
  }
  stops.forEach((stop, i) => { stop.x = pos[i].x; stop.y = pos[i].y; });
  fit(stops, board, margin);
}

// Stops worked out can land too close to one another or to a stop that was read: push the worked-out
// ones apart, never the read ones, and keep them on the board.
function spreadApart(stops: Stop[], movable: Set<Stop>, board: { width: number; height: number }, gap: number) {
  for (let round = 0; round < 60; round++) {
    let moved = false;
    for (let i = 0; i < stops.length; i++) for (let j = i + 1; j < stops.length; j++) {
      const a = stops[i], b = stops[j];
      if (!movable.has(a) && !movable.has(b)) continue;
      let dx = b.x - a.x, dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d >= gap) continue;
      if (d < .01) { dx = 1 + ((i + j) % 3); dy = 1 + ((i * j) % 2); d = Math.hypot(dx, dy); }
      const push = (gap - d) / (movable.has(a) && movable.has(b) ? 2 : 1);
      if (movable.has(a)) { a.x -= (dx / d) * push; a.y -= (dy / d) * push; }
      if (movable.has(b)) { b.x += (dx / d) * push; b.y += (dy / d) * push; }
      moved = true;
    }
    for (const stop of movable) { stop.x = Math.min(board.width - 20, Math.max(20, stop.x)); stop.y = Math.min(board.height - 20, Math.max(20, stop.y)); }
    if (!moved) break;
  }
}
