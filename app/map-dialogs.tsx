"use client";

// The modal surfaces: the first-visit guide, the balance report and the route suggestions.
import { Copy, Download, FileStack, Layers3, MapPinPlus, Pencil, Plus, Printer, Save, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { colorLabels, type MapData, realWagon, type Stop, ticketsInSet, type TicketSet } from "./map-data";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type TicketReview, type ColourLengthTable, type NetworkStats, type RouteSpacing, type RouteSuggestion } from "./map-analysis";

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

export function AnalysisDialog({ open, onOpenChange, data, stats, colourTable, spacing, scaleWidthMm, onSelectRoute, onSelectStop }: { open: boolean; onSelectRoute: (routeId: string) => void; onSelectStop: (stopId: string) => void; onOpenChange: (open: boolean) => void; data: MapData; stats: NetworkStats; colourTable: ColourLengthTable; spacing: RouteSpacing[]; scaleWidthMm: number }) {
  const stopName = (id: string) => data.stops.find((stop) => stop.id === id)?.name ?? "";
  const sortedStops = [...data.stops].sort((a, b) => (stats.hubDegree.get(b.id) ?? 0) - (stats.hubDegree.get(a.id) ?? 0));
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="analysis-dialog">
      <DialogHeader><DialogTitle>Map balance</DialogTitle><DialogDescription>A quick read on how evenly connected and coloured the network is.</DialogDescription></DialogHeader>
      <div className="analysis-section">
        <h3>Hub degree per stop</h3>
        <p className="helper">Pick a row to select that stop on the map. Neighbours + weighted links (parallel routes between the same pair count extra). Higher means more central; sorted from most to least connected.</p>
        {sortedStops.length === 0 ? <p className="helper">No stops yet.</p> : <div className="analysis-table-scroll"><table className="analysis-table">
          <thead><tr><th>Stop</th><th>Neighbours</th><th>Links</th><th>Hub degree</th></tr></thead>
          <tbody>{sortedStops.map((stop) => <tr key={stop.id} className={cn("analysis-row-link", (stats.neighbours.get(stop.id) ?? 0) < 2 && "analysis-warning-row")} tabIndex={0} role="button" onClick={() => onSelectStop(stop.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectStop(stop.id); } }}><td>{stop.name}</td><td>{stats.neighbours.get(stop.id) ?? 0}</td><td>{stats.links.get(stop.id) ?? 0}</td><td>{stats.hubDegree.get(stop.id) ?? 0}</td></tr>)}</tbody>
        </table></div>}
      </div>
      <div className="analysis-section">
        <h3>Room per wagon</h3>
        <p className="helper">Pick a row to select that route on the map. How long each route is drawn against what a real board would use for the same wagon count: {realWagon.length + realWagon.gap} mm per space plus {realWagon.endMargin} mm of end margin, on a {scaleWidthMm.toLocaleString("en-GB")} mm board. Those figures are fitted from the published Ticket to Ride Europe map, which scores 97–106% against them throughout. Well under means the wagons are cramped; well over means the line looks roomier on screen than the finished board plays.</p>
        {spacing.length === 0 ? <p className="helper">No card routes yet.</p> : <div className="analysis-table-scroll"><table className="analysis-table">
          <thead><tr><th>Route</th><th>Wagons</th><th>Drawn</th><th>Needs</th><th>Room</th></tr></thead>
          <tbody>{[...spacing].sort((a, b) => a.ratio - b.ratio).map((item) => <tr key={item.route.id} className={cn("analysis-row-link", item.verdict !== "ok" && "analysis-warning-row")} tabIndex={0} role="button" onClick={() => onSelectRoute(item.route.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectRoute(item.route.id); } }}>
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
      <DialogHeader><DialogTitle>Suggested routes</DialogTitle><DialogDescription>Geometrically nearby stop pairs with no route yet, that don&apos;t cross existing routes, prioritised for the least-connected stops. Length and colour are starting guesses — adjust them afterwards like any other route.</DialogDescription></DialogHeader>
      {suggestions.length === 0 ? <p className="helper">No good candidates right now — every nearby stop pair is already connected, would cross an existing route, or there aren&apos;t enough stops yet.</p> : <ul className="suggestion-list">
        {suggestions.map((suggestion) => <li key={`${suggestion.a}-${suggestion.b}`} className="suggestion-row">
          <div><strong>{suggestion.aName} ↔ {suggestion.bName}</strong><p className="helper">Suggested length {suggestion.suggestedLength} · {colorLabels[suggestion.suggestedColor]}</p></div>
          <Button size="sm" onClick={() => onAdd(suggestion)}><Plus />Add</Button>
        </li>)}
      </ul>}
    </DialogContent>
  </Dialog>;
}


export function TicketsDialog({ open, onOpenChange, data, reviews, coverage, rate, selected, activeSet, onSelect, onUpdate, onDelete, onSelectSet, onAddSet, onDuplicateSet, onRenameSet, onDeleteSet, onExport, onImport, onPrint, onStartFrom }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: MapData;
  reviews: TicketReview[];
  coverage: { stop: Stop; count: number }[];
  rate: number;
  selected: string | null;
  activeSet: TicketSet;
  onSelect: (ticketId: string | null) => void;
  onUpdate: (ticketId: string, values: { points?: number; long?: boolean }) => void;
  onDelete: (ticketId: string) => void;
  onSelectSet: (setId: string) => void;
  onAddSet: () => void;
  onDuplicateSet: () => void;
  onRenameSet: (label: string) => void;
  onDeleteSet: () => void;
  onExport: (scope: "set" | "all") => void;
  onImport: () => void;
  onPrint: () => void;
  onStartFrom: (stopId: string) => void;
}) {
  const name = (id: string) => data.stops.find((stop) => stop.id === id)?.name ?? "—";
  const problems = reviews.filter((review) => review.verdict !== "ok");
  const lengths = reviews.map((review) => review.distance).filter((d): d is number => d !== null).sort((a, b) => a - b);
  const uncovered = coverage.filter((entry) => entry.count === 0);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="analysis-dialog">
      <DialogHeader><DialogTitle>Destination tickets</DialogTitle><DialogDescription>{reviews.length} ticket{reviews.length === 1 ? "" : "s"} in this deck, worth about {rate.toFixed(1)} point{rate.toFixed(1) === "1.0" ? "" : "s"} per wagon space.</DialogDescription></DialogHeader>

      <div className="ticket-set-bar">
        <div className="ticket-set-field"><Label htmlFor="ticket-set">Deck</Label><NativeSelect id="ticket-set" value={activeSet.id} onChange={(event) => onSelectSet(event.target.value)}>{data.ticketSets.map((set) => <NativeSelectOption key={set.id} value={set.id}>{set.label} ({ticketsInSet(data, set.id).length})</NativeSelectOption>)}</NativeSelect></div>
        <div className="ticket-set-field"><Label htmlFor="ticket-set-name">Name</Label><Input id="ticket-set-name" value={activeSet.label} onChange={(event) => onRenameSet(event.target.value)} /></div>
        <div className="ticket-set-buttons">
          <Button size="sm" variant="outline" onClick={onAddSet}><Plus />New deck</Button>
          <Button size="sm" variant="outline" onClick={onDuplicateSet}><Copy />Duplicate</Button>
          <Button size="sm" variant="ghost" disabled={data.ticketSets.length < 2} onClick={onDeleteSet}><Trash2 />Delete deck</Button>
        </div>
        <div className="ticket-set-buttons">
          <Button size="sm" variant="outline" onClick={onImport}><Upload />Import tickets</Button>
          <Button size="sm" variant="outline" onClick={() => onExport("set")}><Download />Export this deck</Button>
          <Button size="sm" variant="ghost" disabled={data.ticketSets.length < 2} onClick={() => onExport("all")}><Download />Export all decks</Button>
          <Button size="sm" variant="outline" disabled={!reviews.length} onClick={onPrint}><Printer />Print cards</Button>
        </div>
        <p className="helper">Several decks can sit in one map, so variants can be judged side by side. Imported decks always arrive as new decks and match stops by name when the ids differ.</p>
      </div>

      {problems.length > 0 && <p className="helper helper-warning">{problems.length} need{problems.length === 1 ? "s" : ""} a look: {problems.map((review) => `${name(review.ticket.a)}–${name(review.ticket.b)}`).slice(0, 4).join(", ")}{problems.length > 4 ? ` and ${problems.length - 4} more` : ""}.</p>}

      <div className="analysis-section">
        <p className="helper">Pick a row to show that ticket&apos;s shortest path on the map. Suggested points come from this map&apos;s own tickets, not from a fixed table.</p>
        <div className="analysis-table-scroll"><table className="analysis-table">
          <thead><tr><th>Ticket</th><th>Spaces</th><th>Points</th><th>Suggested</th><th>Long</th><th /></tr></thead>
          <tbody>{reviews.map((review) => <tr key={review.ticket.id} className={cn("analysis-row-link", review.verdict !== "ok" && "analysis-warning-row", review.ticket.id === selected && "analysis-row-active")} tabIndex={0} role="button"
            onClick={() => onSelect(review.ticket.id === selected ? null : review.ticket.id)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(review.ticket.id === selected ? null : review.ticket.id); } }}>
            <td>{name(review.ticket.a)} → {name(review.ticket.b)}{review.verdict === "unreachable" ? " · not connected" : review.verdict === "duplicate" ? " · duplicate" : ""}</td>
            <td>{review.distance ?? "—"}</td>
            <td onClick={(event) => event.stopPropagation()}><input className="ticket-points" type="number" min={1} max={99} value={review.ticket.points} onChange={(event) => onUpdate(review.ticket.id, { points: Math.max(1, Number(event.target.value) || 1) })} /></td>
            <td>{review.suggested ?? "—"}{review.verdict === "generous" ? " · high" : review.verdict === "stingy" ? " · low" : ""}</td>
            <td onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={Boolean(review.ticket.long)} onChange={(event) => onUpdate(review.ticket.id, { long: event.target.checked })} /></td>
            <td onClick={(event) => event.stopPropagation()}><Button size="sm" variant="ghost" onClick={() => onDelete(review.ticket.id)}>Delete</Button></td>
          </tr>)}</tbody>
        </table></div>
      </div>

      <div className="analysis-section">
        <h3>Length spread</h3>
        <p className="helper">{lengths.length ? `Shortest ${lengths[0]}, median ${lengths[Math.floor(lengths.length / 2)]}, longest ${lengths[lengths.length - 1]} wagon spaces.` : "No reachable tickets yet."} A deck with only short tickets plays differently from one with a long tail.</p>
      </div>

      <div className="analysis-section">
        <h3>Stops no ticket names</h3>
        {uncovered.length ? <>
          <p className="helper">{uncovered.length} of {coverage.length}. Nothing sends a player there — pick one to start a ticket from it.</p>
          <div className="uncovered-stops">{uncovered.map((entry) => <button type="button" key={entry.stop.id} className="uncovered-stop" onClick={() => onStartFrom(entry.stop.id)}>{entry.stop.name}</button>)}</div>
        </> : <p className="helper">Every stop is named by at least one ticket.</p>}
      </div>
    </DialogContent>
  </Dialog>;
}
