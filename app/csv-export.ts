// Spreadsheet exports: the tickets, the routes, the stops and the distances between stops as CSV.
// They are for reading a map in a spreadsheet or in someone else's tool. Stops, routes and tickets
// read back through csv-import.ts; the JSON files stay the way to move a whole map, background and
// styles included. Every row has the names, so that it reads on its own, and the ids beside them, which are what
// ties the files together when they are read back (docs/CSV.md, "Ids and names").
import { bandsOf, buildAdjacency, mapDiameter, shortestPath, ticketBand, ticketEndStops } from "./map-analysis";
import { colorLabelOf, pairKeyOf, type MapData } from "./map-data";
import { zipOf } from "./ttr-map-generator-export";
import { APP_VERSION } from "./version";
import { CSV_GUIDE } from "./csv-guide";

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
const pairKey = pairKeyOf;

export function ticketsCsv(data: MapData, setIds: string[]): string {
  const name = namer(data);
  const first = data.ticketSets[0]?.id;
  const decks = new Map(data.ticketSets.map((set) => [set.id, set.label]));
  const adjacency = buildAdjacency(data);
  const diameter = mapDiameter(data);
  const bands = bandsOf(data);
  const rows: Cell[][] = [["Deck", "From", "To", "Points", "Shortest path", "Length", "Long deck", "From id", "To id", "Editor"]];
  for (const ticket of data.tickets) {
    const set = ticket.set ?? first ?? "";
    if (!setIds.includes(set)) continue;
    const distance = ticket.a === ticket.b ? null : shortestPath(adjacency, ticket.a, ticket.b)?.distance ?? null;
    rows.push([decks.get(set), name(ticket.a), name(ticket.b), ticket.points, distance, ticketBand(distance, diameter, bands), ticket.long ? "yes" : "", ticket.a, ticket.b, APP_VERSION]);
  }
  return toCsv(rows);
}

export function routesCsv(data: MapData): string {
  const name = namer(data);
  const types = new Map(data.routeTypeStyles.map((style) => [style.id, style.label]));
  const wagons = new Map((data.wagonStyles ?? []).map((style) => [style.id, style.label]));
  const lines = new Map<string, number>();
  for (const route of data.routes) lines.set(pairKey(route.a, route.b), (lines.get(pairKey(route.a, route.b)) ?? 0) + 1);
  const rows: Cell[][] = [["From", "To", "Length", "Colour", "Type", "Wagon style", "Locomotives", "Double route", "From id", "To id", "Bends", "Curved", "Editor"]];
  for (const route of data.routes) {
    rows.push([name(route.a), name(route.b), route.length, colorLabelOf(route.color) ?? route.color, types.get(route.type) ?? route.type,
      route.wagonStyle ? wagons.get(route.wagonStyle) ?? route.wagonStyle : "", route.locomotiveSlots?.length ?? 0, (lines.get(pairKey(route.a, route.b)) ?? 0) > 1 ? "yes" : "", route.a, route.b,
      // The route's bends, from its From stop to its To stop, as x|y pairs in board units (a bar, since a spreadsheet reads 500:30 as a time and 5/12 as a date); and "no" when it has been straightened.
      (route.points ?? []).map((point) => `${Math.round(point.x)}|${Math.round(point.y)}`).join(" "), route.curved === false ? "no" : "", APP_VERSION]);
  }
  return toCsv(rows);
}

export function stopsCsv(data: MapData): string {
  const types = new Map((data.stopTypeStyles ?? []).map((style) => [style.id, style.label]));
  const rows: Cell[][] = [["Name", "Type", "Routes", "Neighbours", "Tickets", "X", "Y", "Id", "Editor"]];
  for (const stop of data.stops) {
    const routes = data.routes.filter((route) => route.a === stop.id || route.b === stop.id);
    const neighbours = new Set(routes.map((route) => (route.a === stop.id ? route.b : route.a)));
    const tickets = data.tickets.filter((ticket) => ticket.a === stop.id || ticket.b === stop.id).length;
    rows.push([stop.name, types.get(stop.type) ?? stop.type, routes.length, neighbours.size, tickets, Math.round(stop.x), Math.round(stop.y), stop.id, APP_VERSION]);
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

// Templates to start a spreadsheet from: the columns the import reads, in our export's names, and a
// few rows that together make a tiny map. Imported as they are they give a working board with no
// warnings, and the rows show the harder cases: a double route, a tunnel, a boat with a locomotive, a
// junction, and a ticket from the long deck. Positions fit a board that lies or stands. docs/CSV.md
// explains every column; tests/csv-import.cjs keeps the two in step.
const TEMPLATES: Record<"stops" | "routes" | "tickets", Cell[][]> = {
  stops: [
    ["Name", "Type", "X", "Y"],
    ["Harbour", "Regular", 150, 200],
    ["Hill Town", "Regular", 450, 150],
    ["Junction 1", "Junction", 400, 400],
    ["River End", "Ferry port", 650, 600],
  ],
  routes: [
    ["From", "To", "Length", "Colour", "Type", "Wagon style", "Locomotives"],
    ["Harbour", "Hill Town", 3, "Red", "Railway", "", 0],
    ["Harbour", "Hill Town", 3, "Blue", "Railway", "", 0],
    ["Hill Town", "Junction 1", 2, "Grey", "Railway", "Tunnel", 0],
    ["Junction 1", "River End", 4, "Grey", "Boat", "", 1],
  ],
  tickets: [
    ["Deck", "From", "To", "Points", "Long deck"],
    ["Main deck", "Hill Town", "River End", 6, ""],
    ["Main deck", "Harbour", "River End", 9, "yes"],
  ],
};
export const csvTemplate = (kind: keyof typeof TEMPLATES): string => toCsv(TEMPLATES[kind]);

/** The three templates and the column guide (docs/CSV.md) as one zip: what a person needs to start a map in a
 *  spreadsheet, also when the editor is not at hand. */
export const templatesZip = (): Uint8Array => zipOf([
  { name: "stops-template.csv", text: csvTemplate("stops") },
  { name: "routes-template.csv", text: csvTemplate("routes") },
  { name: "tickets-template.csv", text: csvTemplate("tickets") },
  { name: "columns.md", text: CSV_GUIDE },
]);
