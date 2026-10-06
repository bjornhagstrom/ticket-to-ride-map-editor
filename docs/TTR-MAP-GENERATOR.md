# Export for ttr-map-generator

[ttr-map-generator](https://github.com/simulatedScience/Ticket-to-Ride_Map-Generator) is an open source
Python tool that comes later in the production chain: it takes a graph of places and routes, lays it on
a background image of the right size, and makes the printable board and the ticket cards. This editor is
where a map is designed; **Export → For ttr-map-generator (zip)** hands it over.

This is an export only. The editor does not read that tool's files back.

## What is in the zip

| File | What it holds |
| --- | --- |
| `locations.txt` | One place name per line, one for every stop. |
| `paths.txt` | One line per lane of every buildable route: `A ; B ; length ; colour`. A double route is two lines. |
| `tasks.txt` | One line per ticket, from every deck: `A ; B`. |
| `positions.json` | Where each place is: `{"unit": "cm", "board": [w, h], "positions": {"Name": [x, y]}}`, in centimetres on the board the map is for (79 × 52.5 for the standard 2×3), with y pointing up. |
| `make_graph.py` | Makes the tool's own graph file (`graph.json`) from the files above, with the tool's own code. |
| `README.txt` | How to use them, and what does not come across. |

The three text files are the format the tool's own reader takes (`read_ttr_files.py`: ` ; ` between the
fields, `\n` in a name for a line break). The zip is stored, not packed, so every unzipper reads it.

## Two ways to use it

1. **The text-file workflow** of the tool: Load Nodes, Load Edges and Load Tasks. The tool lays the
   places out itself.
2. **With positions**: run `make_graph.py` with the Python of the tool's own environment (its `.venv`),
   naming the tool's source folder:

   ```
   path/to/ttr-map-generator/.venv/bin/python make_graph.py path/to/ttr-map-generator/src/ttr_map_maker
   ```

   It writes `graph.json`. Open that in the tool with Load Graph. The editor does not write the tool's
   JSON itself: that file is the tool's own particle model (every wagon space is a particle with a
   position, an angle and a size), and the tool is better placed to make it than a copy of it here.

## What is changed on the way

- Names are made safe: a `;` in a name becomes `,`, a line break becomes `\n`, and two stops with one
  name get ` (2)` so that they stay two places.
- The colour `neutral` is written `grey`; a colour the tool does not know is written `grey` too.
- Routes of an infrastructure type (not wagons) are left out, as everywhere else in the editor.

## What does not come across

The tool has plain routes and one list of tickets. So tunnels, ferries, locomotive spaces and a route
type of your own become plain routes; ticket points and decks are not carried over (the tool works the
points out from the shortest path, as the editor does); the background, stop types and symbols, route
styles, rules and notes stay behind. The export says so when it saves.

## How it is checked

`tests/ttr-map-generator.cjs` checks the files against what the tool's reader takes, and, when the tool
is on the machine (`../Test open source ttr editor/ttr-map-generator`, or `TTR_MAP_GENERATOR`), reads
them with its own `read_locations`, `read_paths` and `read_tasks`, runs `make_graph.py` from the zip, and
loads the result back with the tool's own `TTR_Particle_Graph.load_json`: every place and route is there,
and every node where the map has it. That y points up on the tool's plots is read from matplotlib's
default and has not been checked by eye in the tool's window.
