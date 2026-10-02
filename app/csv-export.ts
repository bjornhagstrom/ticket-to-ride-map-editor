// Spreadsheet exports: the tickets, the routes, the stops and the distances between stops as CSV.
// They are for reading a map in a spreadsheet or in someone else's tool, and are never read back;
// the JSON files stay the way to move a map. Names, not ids, so a row reads on its own.
import { bandsOf, buildAdjacency, mapDiameter, shortestPath, ticketBand, ticketEndStops } from "./map-analysis";
import { colorLabels, type MapData } from "./map-data";

type Cell = string | number | null | undefined;

// RFC 4180, with a BOM so a spreadsheet reads å, ä and ö, and CRLF after every row. Text a
// spreadsheet would run as a formula gets a leading apostrophe; numbers are written as they are.
const cell = (value: Cell): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const text = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
export const toCsv = (rows: Cell[][]): string => `﻿${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;

const namer = (data: MapData) => { const names = new Map(data.stops.map((stop) => [stop.id, stop.name])); return (id: string) => names.get(id) ?? ""; };
const pairKey = (a: string, b: string) => (a < b ? `${a}~${b}` : `${b}~${a}`);

export function ticketsCsv(data: MapData, setIds: string[]): string {
  const name = namer(data);
  const first = data.ticketSets[0]?.id;
  const decks = new Map(data.ticketSets.map((set) => [set.id, set.label]));
  const adjacency = buildAdjacency(data);
  const diameter = mapDiameter(data);
  const bands = bandsOf(data);
  const rows: Cell[][] = [["Deck", "From", "To", "Points", "Shortest path", "Length", "Long deck"]];
  for (const ticket of data.tickets) {
    const set = ticket.set ?? first ?? "";
    if (!setIds.includes(set)) continue;
    const distance = ticket.a === ticket.b ? null : shortestPath(adjacency, ticket.a, ticket.b)?.distance ?? null;
    rows.push([decks.get(set), name(ticket.a), name(ticket.b), ticket.points, distance, ticketBand(distance, diameter, bands), ticket.long ? "yes" : ""]);
  }
  return toCsv(rows);
}

export function routesCsv(data: MapData): string {
  const name = namer(data);
  const types = new Map(data.routeTypeStyles.map((style) => [style.id, style.label]));
  const wagons = new Map((data.wagonStyles ?? []).map((style) => [style.id, style.label]));
  const lines = new Map<string, number>();
  for (const route of data.routes) lines.set(pairKey(route.a, route.b), (lines.get(pairKey(route.a, route.b)) ?? 0) + 1);
  const rows: Cell[][] = [["From", "To", "Length", "Colour", "Type", "Wagon style", "Locomotives", "Double route"]];
  for (const route of data.routes) {
    rows.push([name(route.a), name(route.b), route.length, colorLabels[route.color] ?? route.color, types.get(route.type) ?? route.type,
      route.wagonStyle ? wagons.get(route.wagonStyle) ?? route.wagonStyle : "", route.locomotiveSlots?.length ?? 0, (lines.get(pairKey(route.a, route.b)) ?? 0) > 1 ? "yes" : ""]);
  }
  return toCsv(rows);
}

export function stopsCsv(data: MapData): string {
  const types = new Map((data.stopTypeStyles ?? []).map((style) => [style.id, style.label]));
  const rows: Cell[][] = [["Name", "Type", "Routes", "Neighbours", "Tickets", "X", "Y"]];
  for (const stop of data.stops) {
    const routes = data.routes.filter((route) => route.a === stop.id || route.b === stop.id);
    const neighbours = new Set(routes.map((route) => (route.a === stop.id ? route.b : route.a)));
    const tickets = data.tickets.filter((ticket) => ticket.a === stop.id || ticket.b === stop.id).length;
    rows.push([stop.name, types.get(stop.type) ?? stop.type, routes.length, neighbours.size, tickets, Math.round(stop.x), Math.round(stop.y)]);
  }
  return toCsv(rows);
}

// The shortest path in wagon spaces between every two stops a ticket can name, through junctions.
// A pair that cannot be joined is left empty.
export function distancesCsv(data: MapData): string {
  const ends = ticketEndStops(data);
  const adjacency = buildAdjacency(data);
  const rows: Cell[][] = [["", ...ends.map((stop) => stop.name)]];
  for (const from of ends) rows.push([from.name, ...ends.map((to) => (from.id === to.id ? 0 : shortestPath(adjacency, from.id, to.id)?.distance ?? null))]);
  return toCsv(rows);
}
