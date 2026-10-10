// An export for ttr-map-generator, the open source Python tool that comes later in the production chain
// (github.com/simulatedScience/Ticket-to-Ride_Map-Generator). It reads three plain text files: one
// place name per line, `A ; B ; length ; colour` for a route, and `A ; B` for a ticket. That is all
// they hold: positions, ticket points, tunnels, ferries and locomotive spaces have no place in them.
// docs/TTR-MAP-GENERATOR.md says what is written, what is left out and how to load the files.
import type { MapData } from "./map-data";
import { boardOf } from "./board";

export type GeneratorFiles = { locations: string; paths: string; tasks: string; positions: string; notes: string[] };

// The colour names the tool's reader knows; anything else, and our grey, is "grey".
const TOOL_COLOURS = new Set(["green", "red", "blue", "yellow", "orange", "purple", "black", "white"]);
const toolColour = (colour: string) => (TOOL_COLOURS.has(colour) ? colour : "grey");

// A name as the tool reads it: one line, no " ; " to split on, and a line break written as \n.
const safeName = (name: string) => name.replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, ",").trim();

const text = (rows: string[]) => (rows.length ? `${rows.join("\n")}\n` : "");

export function generatorFiles(data: MapData): GeneratorFiles {
  // Every stop gets a name of its own, since the files tie places together by name alone.
  const names = new Map<string, string>();
  const used = new Set<string>();
  data.stops.forEach((stop, index) => {
    const base = safeName(stop.name) || `Stop ${index + 1}`;
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base} (${n})`;
    used.add(name);
    names.set(stop.id, name);
  });
  const infrastructure = new Set(data.routeTypeStyles.filter((style) => style.infrastructure).map((style) => style.id));
  const routes = data.routes.filter((route) => !infrastructure.has(route.type) && names.has(route.a) && names.has(route.b) && route.length >= 1);
  const tickets = data.tickets.filter((ticket) => names.has(ticket.a) && names.has(ticket.b));

  const special = routes.filter((route) => route.type !== "city" || (route.locomotiveSlots?.length ?? 0) > 0 || route.wagonStyle === "tunnel").length;
  const notes: string[] = [];
  if (special > 0) notes.push(`${special} route${special === 1 ? "" : "s"} ${special === 1 ? "is a" : "are"} tunnel${special === 1 ? "" : "s"}, ferr${special === 1 ? "y" : "ies"} or ${special === 1 ? "has" : "have"} locomotive spaces or a type of its own; the tool has only plain routes, so ${special === 1 ? "it comes" : "they come"} across as such.`);
  notes.push("Ticket points and decks are not carried over: the tool has one list of tickets and works the points out from the shortest path between the two places.");
  notes.push("The background, stop types and symbols, route styles, rules and notes are not carried over.");

  return {
    locations: text(data.stops.map((stop) => names.get(stop.id)!)),
    paths: text(routes.map((route) => `${names.get(route.a)} ; ${names.get(route.b)} ; ${Math.round(route.length)} ; ${toolColour(route.color)}`)),
    tasks: text(tickets.map((ticket) => `${names.get(ticket.a)} ; ${names.get(ticket.b)}`)),
    positions: positionsJson(data, names),
    notes,
  };
}

// Where the stops are, for make_graph.py: centimetres on the board, with y pointing up as the tool's
// plots do (ours points down). Keyed by the names the tool's reader gives back, a written \n being a line break.
function positionsJson(data: MapData, names: Map<string, string>): string {
  const board = boardOf(data);
  const cmWide = board.widthMm / 10, cmHigh = board.heightMm / 10;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  // Built from entries, so a stop named __proto__ is a key like any other, not the prototype.
  const positions = Object.fromEntries(data.stops.map((stop): [string, [number, number]] => [names.get(stop.id)!.replace(/\\n/g, "\n"), [round(stop.x / board.width * cmWide), round((board.height - stop.y) / board.height * cmHigh)]]));
  return `${JSON.stringify({ unit: "cm", board: [round(cmWide), round(cmHigh)], positions }, null, 1)}\n`;
}

// A zip of everything, as one download: the three text files, the positions, the script that makes a graph
// of them with the tool's own code, and a note on using them.
export function generatorZip(data: MapData): Uint8Array {
  const files = generatorFiles(data);
  return zipOf([
    { name: "locations.txt", text: files.locations },
    { name: "paths.txt", text: files.paths },
    { name: "tasks.txt", text: files.tasks },
    { name: "positions.json", text: files.positions },
    { name: "make_graph.py", text: MAKE_GRAPH },
    { name: "README.txt", text: readme(data.name, files.notes) },
  ]);
}

const readme = (name: string, notes: string[]) => `${name}, for ttr-map-generator
${"=".repeat(name.length + 24)}

What is here
  locations.txt, paths.txt, tasks.txt   the map as the tool's own text files take it
  positions.json                        where the places are, in centimetres on the board
  make_graph.py                         makes a graph file of them, with the tool's own code

Two ways to use them
  1. In the tool: Load Nodes, Load Edges and Load Tasks (the text-file workflow) with the three files.
     The tool lays the places out itself.
  2. With positions: run make_graph.py with the Python of the tool's own environment, so its libraries
     are found, and name the tool's source folder:

       path/to/ttr-map-generator/.venv/bin/python make_graph.py path/to/ttr-map-generator/src/ttr_map_maker

     It writes graph.json beside it. Open that in the tool with Load Graph. The places are where the map
     has them; y points up, as in the tool's plots; if the map looks mirrored or upside down in the tool, that is a fault in this export, so please report it.

What does not come across
${notes.map((note) => `  - ${note}`).join("\n")}
`;

// What make_graph.py is: the tool's own TTR_Particle_Graph, given our places and routes and tickets.
const MAKE_GRAPH = `"""
Makes a ttr-map-generator graph (.json) from the files the Ticket to Ride map editor exported.

  python make_graph.py PATH/TO/ttr-map-generator/src/ttr_map_maker [graph.json]

Run it with the Python of ttr-map-generator's own environment (its .venv), so that its libraries are
found. Then open graph.json in the tool with Load Graph.
"""
import json
import os
import sys

import numpy as np

here = os.path.dirname(os.path.abspath(__file__))
if len(sys.argv) < 2:
    print(__doc__)
    sys.exit(2)
sys.path.insert(0, os.path.abspath(sys.argv[1]))
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, "graph.json")

import read_ttr_files as reader
from ttr_particle_graph import TTR_Particle_Graph

locations = reader.read_locations(os.path.join(here, "locations.txt"))
paths = reader.read_paths(os.path.join(here, "paths.txt"))
tasks = reader.read_tasks(os.path.join(here, "tasks.txt"))
with open(os.path.join(here, "positions.json"), encoding="utf-8") as file:
    placed = json.load(file)
positions = {name: np.array(xy, dtype=float) for name, xy in placed["positions"].items()}
graph = TTR_Particle_Graph(
    locations=locations,
    paths=paths,
    tasks=tasks,
    node_positions=positions,
    project_setup={"bg_image_size": placed["board"]},
)
graph.save_json(out)
print(f"Wrote {out}: {len(locations)} places, {len(paths)} routes, {len(tasks)} tickets.")
`;

// A zip with nothing packed (every file stored as it is): enough for a handful of small text files, and
// readable by every unzipper.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
const crc32 = (bytes: Uint8Array) => { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export function zipOf(files: { name: string; text: string }[], when: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const dosTime = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const dosDate = (Math.max(0, when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const push = (bytes: Uint8Array) => { chunks.push(bytes); offset += bytes.length; };
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    const crc = crc32(data);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true); header.setUint16(4, 20, true); header.setUint16(6, 0x0800, true); header.setUint16(8, 0, true);
    header.setUint16(10, dosTime, true); header.setUint16(12, dosDate, true); header.setUint32(14, crc, true);
    header.setUint32(18, data.length, true); header.setUint32(22, data.length, true); header.setUint16(26, name.length, true); header.setUint16(28, 0, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true); entry.setUint16(10, 0, true);
    entry.setUint16(12, dosTime, true); entry.setUint16(14, dosDate, true); entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true); entry.setUint32(24, data.length, true); entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    push(new Uint8Array(header.buffer)); push(name); push(data);
  }
  const centralStart = offset;
  for (const part of central) push(part);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, offset - centralStart, true); end.setUint32(16, centralStart, true);
  push(new Uint8Array(end.buffer));
  const zip = new Uint8Array(offset);
  let at = 0;
  for (const chunk of chunks) { zip.set(chunk, at); at += chunk.length; }
  return zip;
}
