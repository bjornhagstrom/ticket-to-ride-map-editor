"use client";

// The modal surfaces: the first-visit guide, the balance report and the route suggestions.
import { FileStack, Layers3, MapPinPlus, Pencil, Plus, Printer, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { colorLabels, type MapData, realWagon } from "./map-data";
import { type ColourLengthTable, type NetworkStats, type RouteSpacing, type RouteSuggestion } from "./map-analysis";

export function WelcomeGuide({ open, onOpenChange, onChooseBlank, onChooseExample }: { open: boolean; onOpenChange: (open: boolean) => void; onChooseBlank: () => void; onChooseExample: () => void }) {
  const steps: Array<{ icon: React.ReactNode; title: string; text: string }> = [
    { icon: <FileStack />, title: "Choose a board format", text: "Pick a standard, large or extended board, or an A4/A3 test sheet sized for your printer." },
    { icon: <Layers3 />, title: "Draw a background", text: "Sketch areas, boundaries and labels behind the network to show land, water and regions." },
    { icon: <MapPinPlus />, title: "Add stops and connect routes", text: "Place stations and draw the routes that link them, with a length, type and colour." },
    { icon: <Save />, title: "Save locally, export a backup", text: "The map saves automatically in this browser. Export a JSON backup regularly, since browser storage is not portable." },
    { icon: <Printer />, title: "Print it out and play on paper", text: "This editor does not play the game for you. Print the finished map, gather around it, and use coloured pens to mark the routes each player builds instead of placing plastic trains." },
  ];
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="welcome-guide">
      <DialogHeader><DialogTitle>Welcome to the map editor</DialogTitle><DialogDescription>This tool is for testing and developing new maps and expansions for Ticket to Ride. Design a custom map, then print it and play with pens instead of plastic trains.</DialogDescription></DialogHeader>
      <ol className="guide-steps">{steps.map((step) => <li key={step.title}><span className="guide-step-icon">{step.icon}</span><div><strong>{step.title}</strong><p>{step.text}</p></div></li>)}</ol>
      <DialogFooter>
        <Button variant="outline" onClick={onChooseExample}><Pencil />Load the example map</Button>
        <Button onClick={onChooseBlank}>Start with a blank map</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function AnalysisDialog({ open, onOpenChange, data, stats, colourTable, spacing, scaleWidthMm }: { open: boolean; onOpenChange: (open: boolean) => void; data: MapData; stats: NetworkStats; colourTable: ColourLengthTable; spacing: RouteSpacing[]; scaleWidthMm: number }) {
  const stopName = (id: string) => data.stops.find((stop) => stop.id === id)?.name ?? "";
  const sortedStops = [...data.stops].sort((a, b) => (stats.hubDegree.get(b.id) ?? 0) - (stats.hubDegree.get(a.id) ?? 0));
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="analysis-dialog">
      <DialogHeader><DialogTitle>Map balance</DialogTitle><DialogDescription>A quick read on how evenly connected and coloured the network is.</DialogDescription></DialogHeader>
      <div className="analysis-section">
        <h3>Hub degree per stop</h3>
        <p className="helper">Neighbours + weighted links (parallel routes between the same pair count extra). Higher means more central; sorted from most to least connected.</p>
        {sortedStops.length === 0 ? <p className="helper">No stops yet.</p> : <div className="analysis-table-scroll"><table className="analysis-table">
          <thead><tr><th>Stop</th><th>Neighbours</th><th>Links</th><th>Hub degree</th></tr></thead>
          <tbody>{sortedStops.map((stop) => <tr key={stop.id} className={cn((stats.neighbours.get(stop.id) ?? 0) < 2 && "analysis-warning-row")}><td>{stop.name}</td><td>{stats.neighbours.get(stop.id) ?? 0}</td><td>{stats.links.get(stop.id) ?? 0}</td><td>{stats.hubDegree.get(stop.id) ?? 0}</td></tr>)}</tbody>
        </table></div>}
      </div>
      <div className="analysis-section">
        <h3>Room per wagon</h3>
        <p className="helper">How long each route is drawn against the {realWagon.length + realWagon.gap} mm a real wagon space needs on a {scaleWidthMm.toLocaleString("en-GB")} mm board. Under 100% the wagons do not fit; well over means the line looks roomier on screen than the finished board plays.</p>
        {spacing.length === 0 ? <p className="helper">No card routes yet.</p> : <div className="analysis-table-scroll"><table className="analysis-table">
          <thead><tr><th>Route</th><th>Wagons</th><th>Drawn</th><th>Needs</th><th>Room</th></tr></thead>
          <tbody>{[...spacing].sort((a, b) => a.ratio - b.ratio).map((item) => <tr key={item.route.id} className={cn(item.verdict !== "ok" && "analysis-warning-row")}>
            <td>{stopName(item.route.a)} → {stopName(item.route.b)}</td>
            <td>{item.route.length}</td>
            <td>{Math.round(item.drawnMm)} mm</td>
            <td>{Math.round(item.neededMm)} mm</td>
            <td>{Math.round(item.ratio * 100)}%{item.verdict === "short" ? " · too short" : item.verdict === "long" ? " · roomy" : ""}</td>
          </tr>)}</tbody>
        </table></div>}
      </div>
      <div className="analysis-section">
        <h3>Colour × length distribution</h3>
        <p className="helper">Counts card-route colours by length. Pre-built infrastructure routes (no train cards) are excluded.</p>
        {colourTable.grandTotal === 0 ? <p className="helper">No card routes yet.</p> : <div className="analysis-table-scroll"><table className="analysis-table">
          <thead><tr><th>Length</th>{colourTable.colours.map((colour) => <th key={colour}>{colorLabels[colour]}</th>)}<th>Total</th></tr></thead>
          <tbody>
            {colourTable.lengths.map((length) => <tr key={length}><td>{length}</td>{colourTable.colours.map((colour) => <td key={colour}>{colourTable.counts.get(length)?.get(colour) ?? 0}</td>)}<td>{colourTable.lengthTotals.get(length) ?? 0}</td></tr>)}
            <tr className="analysis-total-row"><td>Total</td>{colourTable.colours.map((colour) => <td key={colour}>{colourTable.colourTotals.get(colour) ?? 0}</td>)}<td>{colourTable.grandTotal}</td></tr>
          </tbody>
        </table></div>}
      </div>
    </DialogContent>
  </Dialog>;
}

export function SuggestionsDialog({ open, onOpenChange, suggestions, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; suggestions: RouteSuggestion[]; onAdd: (suggestion: RouteSuggestion) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="analysis-dialog">
      <DialogHeader><DialogTitle>Suggested routes</DialogTitle><DialogDescription>Geometrically nearby stop pairs with no route yet, that don't cross existing routes, prioritised for the least-connected stops. Length and colour are starting guesses — adjust them afterwards like any other route.</DialogDescription></DialogHeader>
      {suggestions.length === 0 ? <p className="helper">No good candidates right now — every nearby stop pair is already connected, would cross an existing route, or there aren't enough stops yet.</p> : <ul className="suggestion-list">
        {suggestions.map((suggestion) => <li key={`${suggestion.a}-${suggestion.b}`} className="suggestion-row">
          <div><strong>{suggestion.aName} ↔ {suggestion.bName}</strong><p className="helper">Suggested length {suggestion.suggestedLength} · {colorLabels[suggestion.suggestedColor]}</p></div>
          <Button size="sm" onClick={() => onAdd(suggestion)}><Plus />Add</Button>
        </li>)}
      </ul>}
    </DialogContent>
  </Dialog>;
}

