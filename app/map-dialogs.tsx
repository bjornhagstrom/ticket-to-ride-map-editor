"use client";

// The modal surfaces: the first-visit guide, the balance report and the route suggestions.
import { useState } from "react";
import { ChevronDown, Copy, Download, FileStack, Sparkles, Layers3, MapPinPlus, Pencil, Plus, Printer, Save, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DEFAULT_TICKET_MIX, colorLabels, type MapData, realWagon, type Stop, type Ticket, ticketsInSet, type TicketSet } from "./map-data";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TicketLengths, type TicketLengthsView } from "./ticket-lengths";
import { type Bottleneck, deckRuleFor, deckRules, TICKET_SUGGESTER, type TicketDeckReport, type TicketStyle, type SetupBalance, type TicketReview, type ColourLengthTable, type NetworkStats, type RouteSpacing, type RouteSuggestion } from "./map-analysis";

export function WelcomeGuide({ open, onOpenChange, onChooseBlank, onChooseExample }: { open: boolean; onOpenChange: (open: boolean) => void; onChooseBlank: () => void; onChooseExample: () => void }) {
  const steps: Array<{ icon: React.ReactNode; title: string; text: string }> = [
    { icon: <FileStack />, title: "Choose a board format", text: "Pick the standard 2×3 board or the extended 2×4. Paper, and whether to print on one sheet, a sheet per panel or at full size, is chosen each time you print. Change the board whenever you like — everything keeps its relative position." },
    { icon: <Layers3 />, title: "Draw a background", text: "Sketch areas, boundaries and labels behind the network to show land, water and regions." },
    { icon: <MapPinPlus />, title: "Add stops and connect routes", text: "Place stations and draw the routes that link them, with a length, type and colour." },
    { icon: <Save />, title: "Save locally, export a backup", text: "The map saves automatically in this browser. Export a JSON backup regularly, since browser storage is not portable." },
    { icon: <Printer />, title: "Print it out and play on paper", text: "This editor does not play the game for you. Print the finished map, gather around it, and use coloured pens to mark the routes each player builds instead of placing plastic trains. Keep each player's real wagons in front of them and put one back in the box for every space they fill in — then the pile in front of them is how many they have left, exactly as in a real game. Print at full size and you can lay the wagons on the paper instead." },
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

const NUMBER_WORDS: Record<number, string> = {2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight"};
const tableWord = (count: number) => NUMBER_WORDS[count] ?? String(count);

export function AnalysisPanel({ lengthView, onClose, onPreviewRoutes, onPreviewStop, data, stats, colourTable, spacing, scaleWidthMm, setup, bottlenecks, atTable, onAtTable, onShowBottleneck, onSelectRoute, onSelectStop }: { lengthView: TicketLengthsView; setup: SetupBalance; bottlenecks: Bottleneck[]; atTable: number; onAtTable: (players: number) => void; onShowBottleneck: (routeIds: string[]) => void; onClose: () => void; onPreviewRoutes: (routeIds: string[] | null) => void; onPreviewStop: (stopId: string | null) => void; onSelectRoute: (routeId: string) => void; onSelectStop: (stopId: string) => void; data: MapData; stats: NetworkStats; colourTable: ColourLengthTable; spacing: RouteSpacing[]; scaleWidthMm: number }) {
  const stopName = (id: string) => data.stops.find((stop) => stop.id === id)?.name ?? "";
  const players = data.players ?? { min: 2, max: 5 };
  const sortedStops = [...data.stops].sort((a, b) => (stats.hubDegree.get(b.id) ?? 0) - (stats.hubDegree.get(a.id) ?? 0));
  // In the right column rather than a dialog, so the map stays in view: pointing at a row marks
  // the stop or routes it is about, and picking one selects it as before.
  return <div className="balance-panel">
    <div className="panel-heading"><span>Map balance</span><small>Point at a row to see it on the map</small></div>
      <p className="helper">A quick read on how evenly connected and coloured the network is.</p>
      <div className="analysis-section bottlenecks">
        <h3>Where the tickets crowd</h3>
        <div className="bottleneck-players">
          <Label htmlFor="bottleneck-players">At a table of</Label>
          <NativeSelect id="bottleneck-players" value={String(atTable)} onChange={(event) => onAtTable(Number(event.target.value))}>
            {Array.from({ length: Math.max(1, players.max - players.min + 1) }, (_, i) => players.min + i).map((count) => <NativeSelectOption key={count} value={String(count)}>{count} players</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <p className="helper">How many tickets want each route, against the lanes a player may use at that table. Only the second lane of a double route depends on the player count{players.max < 4 ? ", and on this map it never opens" : ""}.</p>
        {bottlenecks.length === 0
          ? <p className="helper">No route is wanted by more tickets than it can carry.</p>
          : <>
            <div className="bottleneck-list">{bottlenecks.slice(0, 8).map((edge) => <button type="button" key={`${edge.a}|${edge.b}`} className="bottleneck-row" onPointerEnter={() => onPreviewRoutes(edge.routeIds)} onPointerLeave={() => onPreviewRoutes(null)} onClick={() => onShowBottleneck(edge.routeIds)}>
              <strong>{stopName(edge.a)} → {stopName(edge.b)}</strong>
              <span>{edge.length} spaces · {edge.lanesUsable} of {edge.lanes} lane{edge.lanes === 1 ? "" : "s"} usable · {edge.tickets} ticket{edge.tickets === 1 ? "" : "s"} want it</span>
            </button>)}</div>
            <p className="helper">Many tickets need these routes. Consider making one a double route, adding a way round, or moving a ticket. The fix is nearly always a change to the map rather than to the deck.</p>
          </>}
      </div>
      <TicketLengths view={lengthView} />
      <div className="analysis-section setup-balance">
        <h3>Game setup against the map</h3>
        <p className="helper">
          The map holds <strong>{setup.totalSpaces} wagon spaces</strong>. At {setup.wagonsPerPlayer} wagons each, that is about <strong>{setup.supplies.toFixed(1)} player supplies</strong> — how many players could spend everything they have before the routes run out.
        </p>
        {setup.spaceVerdict === "tight" && <p className="helper helper-warning space-warning">Too small for {setup.wagonsPerPlayer} wagons: even two players cannot spend their supply here. Either draw more routes or cut the wagon count to about {Math.max(1, Math.floor(setup.totalSpaces / 2))}.</p>}
        {setup.spaceVerdict === "roomy" && <p className="helper helper-warning space-warning">Very roomy: a full table would leave most of the map unclaimed, so few routes are ever contested. Either raise the wagon count or draw fewer routes.</p>}
        <p className="helper">
          The deck holds <strong>{setup.deckSize} ticket{setup.deckSize === 1 ? "" : "s"}</strong>, against the {setup.dealtAtTable} a table of {tableWord(setup.table)} is dealt at the start.
        </p>
        {setup.deckVerdict === "empty" && <p className="helper helper-warning deck-warning">No tickets yet, so nothing sends anyone anywhere.</p>}
        {setup.deckVerdict === "thin" && <p className="helper helper-warning deck-warning">Too few tickets to deal a full table, let alone leave any to draw later. Aim for at least {setup.dealtAtTable}, and more if players should keep drawing.</p>}
      </div>
      <div className="analysis-section">
        <h3>Hub degree per stop</h3>
        <p className="helper">Pick a row to select that stop on the map. Neighbours + weighted links (parallel routes between the same pair count extra). Higher means more central; sorted from most to least connected.</p>
        {sortedStops.length === 0 ? <p className="helper">No stops yet.</p> : <div className="analysis-table-scroll"><table className="analysis-table">
          <thead><tr><th>Stop</th><th>Neighbours</th><th>Links</th><th>Hub degree</th></tr></thead>
          <tbody>{sortedStops.map((stop) => <tr key={stop.id} className={cn("analysis-row-link", (stats.neighbours.get(stop.id) ?? 0) < 2 && "analysis-warning-row")} tabIndex={0} role="button" onPointerEnter={() => onPreviewStop(stop.id)} onPointerLeave={() => onPreviewStop(null)} onClick={() => onSelectStop(stop.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectStop(stop.id); } }}><td>{stop.name}</td><td>{stats.neighbours.get(stop.id) ?? 0}</td><td>{stats.links.get(stop.id) ?? 0}</td><td>{stats.hubDegree.get(stop.id) ?? 0}</td></tr>)}</tbody>
        </table></div>}
      </div>
      <div className="analysis-section">
        <h3>Room per wagon</h3>
        <p className="helper">Pick a row to select that route on the map. How long each route is drawn against what a real board would use for the same wagon count: {realWagon.length + realWagon.gap} mm per space plus {realWagon.endMargin} mm of end margin, on a {scaleWidthMm.toLocaleString("en-GB")} mm board. Those figures are fitted from the published Ticket to Ride Europe map, which scores 97–106% against them throughout. Well under means the wagons are cramped; well over means the line looks roomier on screen than the finished board plays.</p>
        {spacing.length === 0 ? <p className="helper">No card routes yet.</p> : <div className="analysis-table-scroll"><table className="analysis-table">
          <thead><tr><th>Route</th><th>Wagons</th><th>Drawn</th><th>Needs</th><th>Room</th></tr></thead>
          <tbody>{[...spacing].sort((a, b) => a.ratio - b.ratio).map((item) => <tr key={item.route.id} className={cn("analysis-row-link", item.verdict !== "ok" && "analysis-warning-row")} tabIndex={0} role="button" onPointerEnter={() => onPreviewRoutes([item.route.id])} onPointerLeave={() => onPreviewRoutes(null)} onClick={() => onSelectRoute(item.route.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectRoute(item.route.id); } }}>
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
    <Button variant="outline" size="sm" onClick={onClose}>Done</Button>
  </div>;
}

// Suggested routes live in the right column, not in a dialog: the map stays in view and undimmed,
// and pointing at a suggestion draws it on the map where it would go.
export function SuggestionsPanel({ suggestions, onAdd, onHover, onClose }: { suggestions: RouteSuggestion[]; onAdd: (suggestion: RouteSuggestion) => void; onHover: (suggestion: RouteSuggestion | null) => void; onClose: () => void }) {
  return <div className="suggestion-panel">
    <div className="panel-heading"><span>Suggested routes</span><small>{suggestions.length} to consider</small></div>
    <p className="helper">Nearby stops with no route yet, that would not cross an existing route, least-connected stops first. Point at one to see it on the map. Length and colour are a starting guess to adjust.</p>
    {suggestions.length === 0 ? <p className="helper">No good candidates right now: every nearby pair is connected already, would cross a route, or there are not enough stops yet.</p>
      : <ul className="suggestion-list">
        {suggestions.map((suggestion) => <li key={`${suggestion.a}-${suggestion.b}`} className="suggestion-row" onPointerEnter={() => onHover(suggestion)} onPointerLeave={() => onHover(null)} onFocus={() => onHover(suggestion)} onBlur={() => onHover(null)}>
          <div><strong>{suggestion.aName} ↔ {suggestion.bName}</strong><p className="helper">Length {suggestion.suggestedLength} · {colorLabels[suggestion.suggestedColor]}</p></div>
          <Button size="sm" onClick={() => { onHover(null); onAdd(suggestion); }}><Plus />Add</Button>
        </li>)}
      </ul>}
    <Button variant="outline" size="sm" onClick={onClose}>Done</Button>
  </div>;
}


type TicketSortColumn = "ticket" | "spaces" | "points" | "suggested" | "long";

export function TicketsDialog({ lengthView, open, onOpenChange, data, reviews, coverage, rate, selected, activeSet, onSelect, onUpdate, onDelete, onSelectSet, onAddSet, onDuplicateSet, onRenameSet, onDeleteSet, onExport, onImport, onPrint, onStartFrom, onSuggest }: {
  lengthView: TicketLengthsView;
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
  onSuggest: () => void;
}) {
  const name = (id: string) => data.stops.find((stop) => stop.id === id)?.name ?? "—";
  const problems = reviews.filter((review) => review.verdict !== "ok");
  // The list starts in the order the deck was built, and sorts on any heading from there.
  const [sort, setSort] = useState<{ column: TicketSortColumn | null; descending: boolean }>({ column: null, descending: false });
  const sortValue = (review: TicketReview, column: TicketSortColumn): string | number => {
    if (column === "ticket") return `${name(review.ticket.a)} → ${name(review.ticket.b)}`;
    if (column === "spaces") return review.distance ?? -1;
    if (column === "points") return review.ticket.points;
    if (column === "suggested") return review.suggested ?? -1;
    return review.ticket.long ? 1 : 0;
  };
  const sorted = sort.column === null ? reviews : [...reviews].sort((a, b) => {
    const left = sortValue(a, sort.column!), right = sortValue(b, sort.column!);
    const order = typeof left === "string" ? left.localeCompare(right as string) : (left as number) - (right as number);
    return sort.descending ? -order : order;
  });
  const heading = (column: TicketSortColumn, label: string) => <th key={column} className={cn("ticket-head", sort.column === column && "sorted")}
    onClick={() => setSort({ column, descending: sort.column === column ? !sort.descending : false })}>
    {label}{sort.column === column ? (sort.descending ? " ↓" : " ↑") : ""}
  </th>;
  const lengths = reviews.map((review) => review.distance).filter((d): d is number => d !== null).sort((a, b) => a - b);
  const uncovered = coverage.filter((entry) => entry.count === 0);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="analysis-dialog">
      <DialogHeader><DialogTitle>Destination tickets</DialogTitle><DialogDescription>{reviews.length} ticket{reviews.length === 1 ? "" : "s"} in this deck, worth about {rate.toFixed(1)} point{rate.toFixed(1) === "1.0" ? "" : "s"} per wagon space.</DialogDescription></DialogHeader>

      <div className="ticket-set-bar">
        <div className="ticket-set-field"><Label htmlFor="ticket-set">Deck</Label><NativeSelect id="ticket-set" value={activeSet.id} onChange={(event) => onSelectSet(event.target.value)}>{data.ticketSets.map((set) => <NativeSelectOption key={set.id} value={set.id}>{set.label} ({ticketsInSet(data, set.id).length})</NativeSelectOption>)}</NativeSelect></div>
        <div className="ticket-set-field"><Label htmlFor="ticket-set-name">Name</Label><Input id="ticket-set-name" value={activeSet.label} onChange={(event) => onRenameSet(event.target.value)} /></div>
        <div className="ticket-set-buttons">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Plus />Add a deck<ChevronDown /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={onAddSet}><Plus />New, empty deck</DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicateSet}><Copy />Duplicate this one</DropdownMenuItem>
              <DropdownMenuItem onClick={onSuggest}><Sparkles />Suggest a deck…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Download />Import/Export decks<ChevronDown /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={onImport}><Upload />Import decks</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport("set")}><Download />Export this deck</DropdownMenuItem>
              <DropdownMenuItem disabled={data.ticketSets.length < 2} onClick={() => onExport("all")}><Download />Export every deck</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="outline" disabled={!reviews.length} onClick={onPrint}><Printer />Print deck</Button>
          <Button size="sm" variant="ghost" disabled={data.ticketSets.length < 2} onClick={onDeleteSet}><Trash2 />Delete deck</Button>
        </div>
        <p className="helper">Several decks can sit in one map, so variants can be judged side by side. Imported decks always arrive as new decks and match stops by name when the ids differ.</p>
      </div>

      {problems.length > 0 && <p className="helper helper-warning">{problems.length} need{problems.length === 1 ? "s" : ""} a look: {problems.map((review) => `${name(review.ticket.a)}–${name(review.ticket.b)}`).slice(0, 4).join(", ")}{problems.length > 4 ? ` and ${problems.length - 4} more` : ""}.</p>}

      <div className="analysis-section">
        <p className="helper">Pick a row to show that ticket&apos;s shortest path on the map. Suggested points come from this map&apos;s own tickets, not from a fixed table.</p>
        <div className="analysis-table-scroll"><table className="analysis-table">
          <thead><tr>{heading("ticket", "Ticket")}{heading("spaces", "Spaces")}{heading("points", "Points")}{heading("suggested", "Suggested")}{heading("long", "Long")}<th /></tr></thead>
          <tbody>{sorted.map((review) => <tr key={review.ticket.id} className={cn("analysis-row-link", review.verdict !== "ok" && "analysis-warning-row", review.ticket.id === selected && "analysis-row-active")} tabIndex={0} role="button"
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

      <TicketLengths view={lengthView} />

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

// The tickets behind one number in the coverage panel, as a way through to editing them.
export function StopTicketsDialog({ open, onOpenChange, stopName, band, tickets, onOpen }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stopName: string;
  band: string | null;
  tickets: { id: string; other: string; distance: number | null; points: number; deck: string }[];
  onOpen: (ticketId: string) => void;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="stop-tickets-dialog">
      <DialogHeader>
        <DialogTitle>{stopName}</DialogTitle>
        <DialogDescription>{tickets.length} {band ? `${band} ` : ""}ticket{tickets.length === 1 ? "" : "s"} name{tickets.length === 1 ? "s" : ""} this stop. Pick one to edit it.</DialogDescription>
      </DialogHeader>
      <div className="stop-ticket-rows">{tickets.map((ticket) => <button type="button" key={ticket.id} className="stop-ticket-row" onClick={() => onOpen(ticket.id)}>
        <span>{stopName} → {ticket.other}</span>
        <span className="stop-ticket-meta">{ticket.distance === null ? "not connected" : `${ticket.distance} spaces`} · {ticket.points} pt · {ticket.deck}</span>
      </button>)}</div>
    </DialogContent>
  </Dialog>;
}

// Suggest a whole deck for the map that is open, then let the person edit it as ordinary tickets.
export function SuggestTicketsDialog({ open, onOpenChange, data, current, suggestion, style, onStyle, wagons, onWagons, deckSize, onDeckSize, keepExisting, onKeepExisting, busy, deckName, onDeckName, currentDeck, onShuffle, onApply }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: MapData;
  current: TicketDeckReport;
  suggestion: { tickets: Ticket[]; report: TicketDeckReport } | null;
  style: TicketStyle;
  onStyle: (style: TicketStyle) => void;
  wagons: number;
  onWagons: (wagons: number) => void;
  deckSize: number;
  onDeckSize: (size: number) => void;
  keepExisting: boolean;
  onKeepExisting: (keep: boolean) => void;
  busy: boolean;
  deckName: string;
  onDeckName: (name: string) => void;
  currentDeck: string;
  onShuffle: () => void;
  onApply: (mode: "new" | "replace") => void;
}) {
  const report = suggestion?.report;
  const official = TICKET_SUGGESTER.official;
  const range = ([low, high]: [number, number], unit = "") => `official ${low}–${high}${unit}`;
  const row = (label: string, now: string, next: string, hint: string) => <tr key={label}>
    <td>{label}</td><td>{now}</td><td>{next}</td><td className="suggest-range">{hint}</td>
  </tr>;
  const pct = (value: number) => `${value.toFixed(1)} %`;
  const mix = data.ticketMix ?? DEFAULT_TICKET_MIX;
  const mixShare = (r: TicketDeckReport) => {
    const total = r.mix.reduce((sum, count) => sum + count, 0);
    return total ? r.mix.map((count) => Math.round(100 * count / total)).join(" / ") : "—";
  };
  // On a small map, dealing a full table needs more tickets than one per stop would give.
  // Ours and the map's own, and the one chosen now.
  const rules = deckRules(data);
  const rule = deckRuleFor(data, style);
  const perStopSize = Math.round((rule.ticketsPerStop + rule.longPerStop) * data.stops.length);
  const dealtFloor = deckSize > perStopSize ? deckSize : 0;

  return <Dialog open={open} onOpenChange={onOpenChange}>
    {/* A fixed shape, set here rather than in the stylesheet so the utility classes on DialogContent
        cannot win: shuffling repeatedly must not move the button under the pointer. */}
    <DialogContent className="suggest-dialog" style={{ height: "86vh", maxHeight: 860 }}>
      <DialogHeader>
        <DialogTitle>Suggest a ticket deck</DialogTitle>
        <DialogDescription>Every target below comes from the official Ticket to Ride decks, not from this map. Applying puts the result in a new deck stamped with today&apos;s date, so nothing you already have is touched.</DialogDescription>
      </DialogHeader>

      <div className="suggest-scroll">
      <div className="suggest-controls">
        <div><Label htmlFor="suggest-wagons">Wagons per player</Label>
          <Input id="suggest-wagons" type="number" min={1} max={99} value={wagons} onChange={(event) => onWagons(Math.max(1, Math.round(Number(event.target.value) || 1)))} /></div>
        <div><Label htmlFor="suggest-size">Tickets</Label>
          <Input id="suggest-size" type="number" min={1} max={200} value={deckSize} onChange={(event) => onDeckSize(Math.max(1, Math.round(Number(event.target.value) || 1)))} /></div>
      </div>
      <div className="style-choices">
        <Label htmlFor="suggest-style">Style</Label>
        <select id="suggest-style" className="visually-hidden" value={style} onChange={(event) => onStyle(event.target.value as TicketStyle)}>
          {rules.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <div className="style-cards">{rules.map((preset) => {
          const key = preset.id;
          return <button type="button" key={key} className={cn("style-card", key === style && "chosen")} aria-pressed={key === style} onClick={() => onStyle(key)}>
            <strong>{preset.label}</strong>
            <span>{preset.blurb}</span>
            <dl>
              <div><dt>Deck</dt><dd>{preset.deck}</dd></div>
              <div><dt>Lengths</dt><dd>{preset.lengths}</dd></div>
              <div><dt>And</dt><dd>{preset.after}</dd></div>
            </dl>
          </button>;
        })}</div>
      </div>
      <p className="helper">{busy ? "Working out a deck… " : ""} The wagon count is this map&apos;s own setting and changing it here changes it there. A player&apos;s reach is {report?.reach ?? current.reach} wagon spaces, from {rule.lengthCap} × {wagons} wagons.</p>
      {dealtFloor > 0 && <p className="helper">On a map this size, {rule.ticketsPerStop} tickets per stop would leave too few to deal {data.startingTickets ?? 3} each to a table of {tableWord(data.players?.max ?? 5)}, so the count is held at {dealtFloor}. That is denser than the official decks; lower it if you would rather match them.</p>}
      <label className="checkbox-row"><input type="checkbox" checked={keepExisting} onChange={(event) => onKeepExisting(event.target.checked)} />Keep the tickets this deck already has</label>

      {report?.note && <p className="helper helper-warning">{report.note}</p>}

      <div className={cn("analysis-table-scroll", busy && "suggest-busy")}><table className="analysis-table suggest-table">
        <thead><tr><th>Measure</th><th>Now</th><th>Suggested</th><th>Reference</th></tr></thead>
        <tbody>
          {row("Tickets", `${current.regular + current.long}`, report ? `${report.regular + report.long}` : "—", `${rule.ticketsPerStop} per stop`)}
          {row("Long tickets", `${current.long}`, report ? `${report.long}` : "—", style === "europe" ? "Europe draws 6 of its 46 separately" : rule.longPerStop > 0 ? `a long deck of about ${rule.longPerStop} per stop` : "this style has no separate long deck")}
          {row("Tickets per stop", current.perStop.toFixed(2), report ? report.perStop.toFixed(2) : "—", range(official.perStop))}
          {row("Reach", `${current.reach}`, report ? `${report.reach}` : "—", "the longest ticket a player can build")}
          {row("Stops with no ticket", `${current.zeroStops}`, report ? `${report.zeroStops}` : "—", "USA 6, Europe 0")}
          {row("Most tickets on one stop", `${current.maxPerStop}`, report ? `${report.maxPerStop}` : "—", range(official.maxPerStop))}
          {row("Near-duplicates", pct(current.dupPct), report ? pct(report.dupPct) : "—", range(official.dupPct, " %"))}
          {row("Routes no ticket uses", pct(current.unusedPct), report ? pct(report.unusedPct) : "—", range(official.unusedPct, " %"))}
          {row("Short / medium / long", mixShare(current), report ? mixShare(report) : "—", `aiming at ${mix.short} / ${mix.medium} / ${mix.long} %`)}
          {row("Score", current.score.toFixed(1), report ? report.score.toFixed(1) : "—", "under 5 is official-like, over 10 is random")}
        </tbody>
      </table></div>

      {report && report.bins.some((count) => count > 0) && <p className="helper">Lengths, shortest to longest: {report.bins.join(" · ")} against a target of {rule.bins.map((share) => (share * report.regular).toFixed(1)).join(" · ")}.</p>}
      {report && report.ambiguous.length > 0 && <p className="helper">{report.ambiguous.length} ticket{report.ambiguous.length === 1 ? " has" : "s have"} a way round that costs one space more but is built from one route fewer, so it takes a turn less. Several official cards are priced at that higher figure. These are left at the shortest path — raise them by hand if you want to follow suit.</p>}
      {report && report.hard.length > 0 && <p className="helper">{report.hard.length} ticket{report.hard.length === 1 ? "" : "s"} cross a tunnel or need ferry locomotives. They are worth their wagon count all the same — the difficulty is yours to judge.</p>}
      </div>

      <div className="suggest-apply">
        <div><Label htmlFor="suggest-name">Name for a new deck</Label>
          <Input id="suggest-name" value={deckName} onChange={(event) => onDeckName(event.target.value)} placeholder="Give it a name" /></div>
        <p className="helper">Shuffle asks for another deck from the same map: the search is not deterministic, so a second try is a genuinely different reading. Replacing throws away the tickets in {currentDeck}.</p>
        <div className="suggest-apply-buttons">
          <Button variant="outline" disabled={busy} onClick={onShuffle}>Shuffle</Button>
          <Button variant="outline" disabled={busy || !suggestion?.tickets.length} onClick={() => onApply("replace")}>Replace {currentDeck}</Button>
          <Button disabled={busy || !suggestion?.tickets.length || !deckName.trim()} onClick={() => onApply("new")}>Save as a new deck</Button>
        </div>
      </div>

    </DialogContent>
  </Dialog>;
}
