// Small invented maps for the checks that must run for everyone. Nothing here is taken from a
// published Ticket to Ride board, so none of it is private: the stops are trees and the routes are
// made up to give the suggester something with a shape to work on.
//
// What they cannot do is show that the suggester is calibrated against the real games. That needs
// the official maps (see tests/ticket-calibration.cjs); these show that it behaves.

const COLOURS = ["red", "blue", "green", "yellow", "black", "white", "orange", "purple", "neutral"];

function build({ name, stops, routes, wagonsPerPlayer = 45 }) {
  const stopList = stops.map(([id, label, x, y, type = "city"]) => ({ id, name: label, type, x, y }));
  let n = 0;
  const routeList = routes.map(([a, b, length, extra = {}]) => ({
    id: `r-${n++}`, a, b, length, type: "city", color: extra.color ?? COLOURS[n % COLOURS.length],
    locomotiveSlots: extra.locos ? Array.from({ length: extra.locos }, (_, k) => k) : undefined,
    wagonStyle: extra.tunnel ? "tunnel" : undefined,
  }));
  return {
    name, format: "board-2x3", background: [], stops: stopList, routes: routeList, notes: [], lineStyles: [],
    routeTypeStyles: [{ id: "city", label: "City", stroke: "#736d64", dash: "", strokeWidth: 3, infrastructure: false }],
    wagonStyles: [], stopTypeStyles: [{ id: "city", label: "Stop", fill: "#fffaf0", stroke: "#721c24" }, { id: "junction", label: "Junction", fill: "#fff", stroke: "#666", junction: true }],
    tickets: [], ticketSets: [{ id: "main", label: "Main deck" }],
    wagonsPerPlayer, startingTickets: 3, keptTickets: 2, players: { min: 2, max: 4 },
  };
}

// A ring of twelve stops with four chords, one of them a double route.
function ring() {
  const names = ["Alder", "Birch", "Cedar", "Dogwood", "Elm", "Fir", "Gorse", "Hazel", "Ivy", "Juniper", "Kale", "Larch"];
  const stops = names.map((label, i) => [`s${i}`, label, Math.round(500 + 400 * Math.cos(i / 12 * 2 * Math.PI)), Math.round(350 + 250 * Math.sin(i / 12 * 2 * Math.PI))]);
  const lengths = [2, 3, 4, 3, 2, 5, 3, 4, 2, 3, 6, 3];
  const routes = lengths.map((length, i) => [`s${i}`, `s${(i + 1) % 12}`, length]);
  routes.push(["s0", "s6", 5], ["s3", "s9", 4], ["s2", "s8", 6, { tunnel: true }], ["s5", "s11", 3], ["s5", "s11", 3]);
  return build({ name: "Ring", stops, routes });
}

// A grid of five by four stops, with a ferry the long way round and a junction that joins two roads.
function grid() {
  const stops = [];
  for (let r = 0; r < 4; r += 1) for (let c = 0; c < 5; c += 1) stops.push([`g${r}${c}`, `Grid ${String.fromCharCode(65 + r)}${c + 1}`, 120 + c * 200, 100 + r * 150]);
  stops.push(["gj", "Crossing", 520, 250, "junction"]);
  const routes = [];
  for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1) if (!(r === 1 && c === 2)) routes.push([`g${r}${c}`, `g${r}${c + 1}`, 2 + ((r + c) % 3)]);
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 5; c += 1) if (!(r === 2 && c === 4)) routes.push([`g${r}${c}`, `g${r + 1}${c}`, 3 + ((r * 2 + c) % 3)]);
  routes.push(["g12", "gj", 2], ["gj", "g13", 2], ["g00", "g34", 6, { locos: 2 }]);
  return build({ name: "Grid", stops, routes });
}

// A branching map with a loop, a stop at the end of a spur, and an island nothing reaches.
function sparse() {
  const stops = [["c0", "Moss", 100, 300], ["c1", "Nettle", 300, 200], ["c2", "Oak", 500, 300], ["c3", "Pine", 700, 200], ["c4", "Quince", 900, 300], ["c5", "Rowan", 500, 500], ["c6", "Sage", 300, 500], ["c7", "Thyme", 700, 500], ["c8", "Dead Island", 950, 80]];
  const routes = [["c0", "c1", 3], ["c1", "c2", 4], ["c2", "c3", 3], ["c3", "c4", 5], ["c2", "c5", 2], ["c5", "c6", 3], ["c6", "c0", 4], ["c5", "c7", 4], ["c7", "c4", 3]];
  return build({ name: "Sparse", stops, routes });
}

module.exports = { ring, grid, sparse, build };
