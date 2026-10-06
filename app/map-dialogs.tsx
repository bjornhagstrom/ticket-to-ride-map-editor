"use client";

// The modal surfaces: the first-visit guide, the balance report and the route suggestions.
import { useEffect, useState } from "react";
import { AlertTriangle, Play, ChevronDown, Copy, FileSpreadsheet, Download, FileStack, Sparkles, Layers3, Pencil, Plus, Printer, Save, ScrollText, Ticket as TicketIcon, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DEFAULT_TICKET_MIX, colorLabels, type MapData, realWagon, type Stop, type Ticket, ticketsInSet, type TicketSet } from "./map-data";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TicketLengths, type TicketLengthsView } from "./ticket-lengths";
import { DeckCompare, type DeckCompareView } from "./deck-compare";
import { TensionSlider } from "./tension-slider";
import { type DeckTension, BALANCE_OFFICIAL, CROWDING_OFFICIAL, networkShape, SHAPE_OFFICIAL, colourRouteIds, compareWithClassics, CLASSIC_ROUTE_MAPS, type Bottleneck, dealtToFullTable, deckRuleFor, deckRules, TICKET_SUGGESTER, type TicketDeckReport, type TicketStyle, type SetupBalance, type TicketReview, type ColourLengthTable, type NetworkStats, type RouteSpacing, type RouteSuggestion } from "./map-analysis";

// The tour on YouTube, as a picture with a play button until someone asks for it: nothing is loaded
// from YouTube before then, so no cookie is set and no script runs for anyone who does not watch. The
// player comes from youtube-nocookie.com and starts at once, since playing is what was asked (Safari
// does not allow that for an embedded player: there its own play button waits, after the picture).
const TOUR_VIDEO_ID = "AS7XWDRvOEE";
export const TOUR_VIDEO_URL = `https://youtu.be/${TOUR_VIDEO_ID}`;
function TourVideo() {
  const [asked, setAsked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Wanting it (the pointer on the picture; not focus, which the dialog gives the button by itself) warms up the connection to the player's host, so the
  // click has less to wait for. A preconnect sends no cookie and loads nothing.
  const warmUp = () => {
    if (document.querySelector('link[rel="preconnect"][href="https://www.youtube-nocookie.com"]')) return;
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = "https://www.youtube-nocookie.com";
    document.head.appendChild(link);
  };
  return <div className="tour-video" aria-busy={asked && !loaded}>
    {asked && <iframe className={loaded ? "is-loaded" : undefined} src={`https://www.youtube-nocookie.com/embed/${TOUR_VIDEO_ID}?autoplay=1&rel=0`} title="A tour of the map editor" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen onLoad={() => setLoaded(true)} />}
    {!loaded && <button type="button" className="tour-video-play" disabled={asked} aria-label="Play the tour of the editor, 80 seconds, from YouTube" onPointerEnter={warmUp} onClick={() => setAsked(true)}>
      <img src="/ttr/images/tour-poster.jpg" width={960} height={540} alt="" />
      {!asked && <span className="tour-video-button"><Play /></span>}
      <span className="tour-video-note">{asked ? "Loading the player…" : "A tour in 80 seconds · plays from YouTube"}</span>
    </button>}
  </div>;
}

export function WelcomeGuide({ open, onOpenChange, onChooseBlank, onChooseExample, onChooseProblems }: { open: boolean; onOpenChange: (open: boolean) => void; onChooseBlank: () => void; onChooseExample: () => void; onChooseProblems: () => void }) {
  // What matters, in a line or two each. How a print is laid out is for the print dialog to say.
  const steps: Array<{ icon: React.ReactNode; title: string; text: string }> = [
    { icon: <FileStack />, title: "Choose a board", text: "The standard 2×3 or the extended 2×4, lying or standing. You can change it whenever you like; everything on the map comes along." },
    { icon: <Layers3 />, title: "Draw the map", text: "Sketch the background (land, water, regions), place stops, and connect them with routes, each with a length, a type and a colour, or bring them in from a spreadsheet." },
    { icon: <TicketIcon />, title: "Add destination tickets", text: "Link two stops to make a ticket, or let the editor build a full deck of tickets. Map balance shows how well the map and the tickets work together." },
    { icon: <ScrollText />, title: "Write the rules", text: "Keep the rules of your map in the Rules panel, in plain text with links to its stops and routes." },
    { icon: <Printer />, title: "Print it and play on paper", text: "Print the board, the tickets as cut-out cards with a small map, and the rules, or save them as a PDF. Then play with coloured pens instead of plastic trains." },
    { icon: <Save />, title: "Saved in your browser and download to your computer", text: "Your map saves automatically in this browser. Export it to a file now and then as a backup, since browser storage does not travel." },
  ];
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="welcome-guide">
      <DialogHeader><DialogTitle>Welcome to the map editor</DialogTitle><DialogDescription>This tool is for testing and developing new maps and expansions for Ticket to Ride. Design a custom map, then print it and play with pens instead of plastic trains.</DialogDescription></DialogHeader>
      <TourVideo />
      <ol className="guide-steps">{steps.map((step) => <li key={step.title}><span className="guide-step-icon">{step.icon}</span><div><strong>{step.title}</strong><p>{step.text}</p></div></li>)}</ol>
      <p className="helper guide-more">More about what it is for, and where its numbers come from, on the <a href="./about">About page</a>.</p>
      <DialogFooter className="sm:flex-wrap">
        <Button variant="outline" onClick={onChooseExample}><Pencil />Load the example map</Button>
        <Button variant="outline" onClick={onChooseProblems}><AlertTriangle />Load a map with problems</Button>
        <Button onClick={onChooseBlank}>Start with a blank map</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

const NUMBER_WORDS: Record<number, string> = {2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight"};
const tableWord = (count: number) => NUMBER_WORDS[count] ?? String(count);

export function AnalysisPanel({ official, wide, onToggleWide, onAddParallel, lengthView, pinKey, onPin, bottleneckShown, onClose, onPreviewRoutes, onPreviewStop, data, stats, colourTable, spacing, scaleWidthMm, setup, bottlenecks, atTable, onAtTable, onShowBottleneck, onSelectRoute, onSelectStop }: { official: { players: number; crowded: number; connections: number; loadRatio: number | null; unusedPct: number; maxPerStop: number }; wide: boolean; onToggleWide: () => void; onAddParallel: (routeId: string) => void; lengthView: TicketLengthsView; pinKey: string | null; onPin: (key: string, routes: string[] | null, stop: string | null) => void; bottleneckShown: Set<string>; setup: SetupBalance; bottlenecks: Bottleneck[]; atTable: number; onAtTable: (players: number) => void; onShowBottleneck: (routeIds: string[]) => void; onClose: () => void; onPreviewRoutes: (routeIds: string[] | null) => void; onPreviewStop: (stopId: string | null) => void; onSelectRoute: (routeId: string) => void; onSelectStop: (stopId: string) => void; data: MapData; stats: NetworkStats; colourTable: ColourLengthTable; spacing: RouteSpacing[]; scaleWidthMm: number }) {
  const stopName = (id: string) => data.stops.find((stop) => stop.id === id)?.name ?? "";
  // A number in the colour table marks the routes it counts while it is pointed at.
  const classicRows = compareWithClassics(data);
  const pointAt = (length: number | null, colour: string | null) => ({ className: cn("colour-cell", pinKey === `cell:${length ?? "*"}:${colour ?? "*"}` && "pinned"), "aria-pressed": pinKey === `cell:${length ?? "*"}:${colour ?? "*"}`, onClick: () => onPin(`cell:${length ?? "*"}:${colour ?? "*"}`, colourRouteIds(data, length, colour), null), onPointerEnter: () => onPreviewRoutes(colourRouteIds(data, length, colour)), onPointerLeave: () => onPreviewRoutes(null) });
  const players = data.players ?? { min: 2, max: 5 };
  const sortedStops = [...data.stops].sort((a, b) => (stats.hubDegree.get(b.id) ?? 0) - (stats.hubDegree.get(a.id) ?? 0));
  // In the right column rather than a dialog, so the map stays in view: pointing at a row marks
  // the stop or routes it is about, and picking one selects it as before.
  return <div className="balance-panel">
    <div className="panel-heading"><span>Map balance</span><Button size="sm" variant="outline" aria-expanded={wide} onClick={onToggleWide}>{wide ? "Collapse" : "Expand"}</Button></div>
      <p className="helper">A quick read on how evenly connected and coloured the network is, and how the tickets lie on it. Point at a row to see it on the map. Click one to keep it marked, and click again to let it go; double-click a stop or a route to pick it for editing.</p>
      <OfficialFigures official={official} stats={stats} />
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
          ? <p className="helper">No route is wanted by more tickets than it can carry. Official maps have {CROWDING_OFFICIAL[0]}–{CROWDING_OFFICIAL[1]} such routes at a full table, {BALANCE_OFFICIAL.crowdedPct[0]}–{BALANCE_OFFICIAL.crowdedPct[1]} % of their routes: some contention is part of the game.</p>
          : <>
            <div className="bottleneck-list">{bottlenecks.slice(0, 8).map((edge) => <button type="button" key={`${edge.a}|${edge.b}`} className={cn("bottleneck-row", edge.onPurpose && "on-purpose")} onPointerEnter={() => onPreviewRoutes(edge.routeIds)} onPointerLeave={() => onPreviewRoutes(null)} aria-pressed={edge.routeIds.length === bottleneckShown.size && edge.routeIds.every((id) => bottleneckShown.has(id))} onClick={() => onShowBottleneck(edge.routeIds)}>
              <strong>{stopName(edge.a)} → {stopName(edge.b)}{edge.onPurpose && <em className="on-purpose-tag">on purpose</em>}</strong>
              <span>{edge.length} spaces · {edge.lanesUsable} of {edge.lanes} lane{edge.lanes === 1 ? "" : "s"} usable · {edge.tickets} ticket{edge.tickets === 1 ? "" : "s"} want it</span>
            </button>)}</div>
            {bottlenecks.some((edge) => edge.onPurpose) && <p className="helper">{bottlenecks.filter((edge) => edge.onPurpose).length} of them {bottlenecks.filter((edge) => edge.onPurpose).length === 1 ? "is" : "are"} contested on purpose, as marked in Properties.</p>}
            <p className="helper">{bottlenecks.length} route{bottlenecks.length === 1 ? " is" : "s are"} wanted by more tickets than {bottlenecks.length === 1 ? "it" : "they"} can carry at this table. Official maps have {CROWDING_OFFICIAL[0]}–{CROWDING_OFFICIAL[1]} at a full table, {BALANCE_OFFICIAL.crowdedPct[0]}–{BALANCE_OFFICIAL.crowdedPct[1]} % of their routes, most of them on double routes: contention is part of the game. Where a corridor is crowded on purpose, a second lane keeps it open at bigger tables; where it is not, a way round or another ticket eases it. Click a row to keep its route marked, and click again to let go.</p>
          </>}
      </div>
      <NetworkShapeSection data={data} onPreviewRoutes={onPreviewRoutes} onPreviewStop={onPreviewStop} onAddParallel={onAddParallel} onSelectStop={onSelectStop} />
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
        <p className="helper">Click a row to keep that stop ringed on the map, and click again to let go; double-click to pick the stop for editing. Neighbours + weighted links (parallel routes between the same pair count extra). Higher means more central; sorted from most to least connected.</p>
        {sortedStops.length === 0 ? <p className="helper">No stops yet.</p> : <div className="analysis-table-scroll"><table className="analysis-table">
          <thead><tr><th>Stop</th><th>Neighbours</th><th>Links</th><th>Hub degree</th></tr></thead>
          <tbody>{sortedStops.map((stop) => <tr key={stop.id} className={cn("analysis-row-link", (stats.neighbours.get(stop.id) ?? 0) < 2 && "analysis-warning-row", pinKey === `stop:${stop.id}` && "pinned")} aria-pressed={pinKey === `stop:${stop.id}`} tabIndex={0} role="button" onPointerEnter={() => onPreviewStop(stop.id)} onPointerLeave={() => onPreviewStop(null)} onClick={() => onPin(`stop:${stop.id}`, null, stop.id)} onDoubleClick={() => onSelectStop(stop.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPin(`stop:${stop.id}`, null, stop.id); } }}><td>{stop.name}</td><td>{stats.neighbours.get(stop.id) ?? 0}</td><td>{stats.links.get(stop.id) ?? 0}</td><td>{stats.hubDegree.get(stop.id) ?? 0}</td></tr>)}</tbody>
        </table></div>}
      </div>
      <div className="analysis-section">
        <h3>Room per wagon</h3>
        <p className="helper">Click a row to keep that route marked on the map, and click again to let go; double-click to pick the route for editing. How long each route is drawn against what a real board would use for the same wagon count: {realWagon.length + realWagon.gap} mm per space plus {realWagon.endMargin} mm of end margin, on a {scaleWidthMm.toLocaleString("en-GB")} mm board. Those figures are fitted from the published Ticket to Ride Europe map, which scores 97–106% against them throughout. Well under means the wagons are cramped; well over means the line looks roomier on screen than the finished board plays.</p>
        {spacing.length === 0 ? <p className="helper">No card routes yet.</p> : <div className="analysis-table-scroll"><table className="analysis-table">
          <thead><tr><th>Route</th><th>Wagons</th><th>Drawn</th><th>Needs</th><th>Room</th></tr></thead>
          <tbody>{[...spacing].sort((a, b) => a.ratio - b.ratio).map((item) => <tr key={item.route.id} className={cn("analysis-row-link", item.verdict !== "ok" && "analysis-warning-row", pinKey === `route:${item.route.id}` && "pinned")} aria-pressed={pinKey === `route:${item.route.id}`} tabIndex={0} role="button" onPointerEnter={() => onPreviewRoutes([item.route.id])} onPointerLeave={() => onPreviewRoutes(null)} onClick={() => onPin(`route:${item.route.id}`, [item.route.id], null)} onDoubleClick={() => onSelectRoute(item.route.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPin(`route:${item.route.id}`, [item.route.id], null); } }}>
            <td>{stopName(item.route.a)} → {stopName(item.route.b)}</td>
            <td>{item.route.length}</td>
            <td>{Math.round(item.drawnMm)} mm</td>
            <td>{Math.round(item.neededMm)} mm</td>
            <td>{Math.round(item.ratio * 100)}%<span className={cn("room-mark", item.verdict)}>{item.verdict === "short" ? "Too short" : item.verdict === "long" ? "Roomy" : "OK"}</span></td>
          </tr>)}</tbody>
        </table></div>}
      </div>
      <div className="analysis-section">
        <h3>Colour × length distribution</h3>
        <p className="helper">Counts card-route colours by length, and below them the wagon spaces each colour adds up to. Point at a number to see its routes on the map; click to keep them marked, and click again to let go. Pre-built infrastructure routes (no train cards) are excluded.</p>
        {colourTable.grandTotal === 0 ? <p className="helper">No card routes yet.</p> : <div className="analysis-table-scroll"><table className="analysis-table colour-table">
          <thead><tr><th>Length</th>{colourTable.colours.map((colour) => <th key={colour}>{colorLabels[colour]}</th>)}<th>Total</th></tr></thead>
          <tbody>
            {colourTable.lengths.map((length) => <tr key={length}>
              <td {...pointAt(length, null)}>{length}</td>
              {colourTable.colours.map((colour) => <td key={colour} {...pointAt(length, colour)}>{colourTable.counts.get(length)?.get(colour) ?? 0}</td>)}
              <td {...pointAt(length, null)}>{colourTable.lengthTotals.get(length) ?? 0}</td>
            </tr>)}
            <tr className="analysis-total-row"><td {...pointAt(null, null)}>Routes</td>{colourTable.colours.map((colour) => <td key={colour} {...pointAt(null, colour)}>{colourTable.colourTotals.get(colour) ?? 0}</td>)}<td {...pointAt(null, null)}>{colourTable.grandTotal}</td></tr>
            <tr className="analysis-wagons-row"><td {...pointAt(null, null)}>Wagons</td>{colourTable.colours.map((colour) => <td key={colour} {...pointAt(null, colour)}>{colourTable.colourWagons.get(colour) ?? 0}</td>)}<td {...pointAt(null, null)}>{colourTable.grandWagons}</td></tr>
          </tbody>
        </table></div>}
        {classicRows && <div className="classic-compare">
          <h4>Against the seven classic maps</h4>
          <p className="helper">{CLASSIC_ROUTE_MAPS.join(", ")}: the lowest and highest of their seven, and the median. Official maps differ a lot in route lengths and in grey routes, but share their wagons very evenly between the colours. Colour balance is the largest colour’s wagons against the average colour’s: 1.00 is perfectly even.</p>
          <div className="analysis-table-scroll"><table className="analysis-table classic-table">
            <thead><tr><th>Measure</th><th>This map</th><th>Classic maps</th><th /></tr></thead>
            <tbody>{classicRows.map((row) => {
              const digits = row.unit === "×" ? 2 : 0;
              const text = (value: number) => value.toFixed(digits);
              return <tr key={row.kind} data-kind={row.kind} className={cn("classic-row", row.verdict !== "within" && "analysis-warning-row")}>
                <td>{row.label}</td>
                <td><b className="classic-this">{text(row.value)}{row.unit === "%" ? " %" : " ×"}</b></td>
                <td className="classic-range">{text(row.range[0])}–{text(row.range[2])}{row.unit === "%" ? " %" : " ×"}<small>median {text(row.range[1])}</small></td>
                <td className="classic-verdict">{row.verdict}</td>
              </tr>;
            })}</tbody>
          </table></div>
          <p className="helper classic-summary">{classicRows.filter((row) => row.verdict !== "within").length === 0 ? "Every measure is within what the classic maps do." : `Outside the classic range: ${classicRows.filter((row) => row.verdict !== "within").map((row) => `${row.label.toLowerCase()} (${row.verdict})`).join("; ")}.`}</p>
        </div>}
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

export function TicketsPanel({ compare, onHoverTicket, lengthView, wide, onToggleWide, onClose, data, reviews, coverage, rate, selected, activeSet, onSelect, onUpdate, onDelete, onSelectSet, onAddSet, onDuplicateSet, onRenameSet, onDeleteSet, onExport, onExportCsv, onImport, onPrint, onStartFrom, onSuggest }: {
  compare: DeckCompareView | null;
  onHoverTicket: (ticketId: string | null) => void;
  lengthView: TicketLengthsView;
  wide: boolean;
  onToggleWide: () => void;
  onClose: () => void;
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
  onExportCsv: (scope: "set" | "all") => void;
  onImport: () => void;
  onPrint: () => void;
  onStartFrom: (stopId: string) => void;
  onSuggest: () => void;
}) {
  // Closing the panel with the pointer still on a row must not leave that ticket marked.
  useEffect(() => () => onHoverTicket(null), [onHoverTicket]);
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

  // In the right column rather than a dialog, so the map stays in view beside the list.
  return <div className="balance-panel tickets-panel">
    <div className="panel-heading"><span>Destination tickets</span><Button size="sm" variant="outline" aria-expanded={wide} onClick={onToggleWide}>{wide ? "Collapse" : "Expand"}</Button></div>
    <p className="helper">{reviews.length} ticket{reviews.length === 1 ? "" : "s"} in this deck, worth about {rate.toFixed(1)} point{rate.toFixed(1) === "1.0" ? "" : "s"} per wagon space.</p>

      <div className="ticket-set-bar">
        <div className="ticket-set-field"><Label htmlFor="ticket-set">Deck</Label><NativeSelect id="ticket-set" value={activeSet.id} onChange={(event) => onSelectSet(event.target.value)}>{data.ticketSets.map((set) => <NativeSelectOption key={set.id} value={set.id}>{set.label} ({ticketsInSet(data, set.id).length})</NativeSelectOption>)}</NativeSelect></div>
        <div className="ticket-set-field"><Label htmlFor="ticket-set-name">Name</Label><Input id="ticket-set-name" value={activeSet.label} onChange={(event) => onRenameSet(event.target.value)} /></div>
        <div className="ticket-set-buttons">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Plus />Add a deck<ChevronDown /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={onAddSet}><Plus />New, empty deck</DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicateSet}><Copy />Duplicate this one</DropdownMenuItem>
              <DropdownMenuItem onClick={onSuggest}><Sparkles />Build a full deck of tickets…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Download />Import/Export decks<ChevronDown /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={onImport}><Upload />Import decks</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport("set")}><Download />Export this deck</DropdownMenuItem>
              <DropdownMenuItem disabled={data.ticketSets.length < 2} onClick={() => onExport("all")}><Download />Export every deck</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExportCsv("set")}><FileSpreadsheet />Export this deck as CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="outline" disabled={!reviews.length} onClick={onPrint}><Printer />Print deck</Button>
          <Button size="sm" variant="ghost" disabled={data.ticketSets.length < 2} onClick={onDeleteSet}><Trash2 />Delete deck</Button>
        </div>
        <p className="helper">Several decks can sit in one map, so variants can be judged side by side. Imported decks always arrive as new decks and match stops by name when the ids differ.</p>
      </div>

      {problems.length > 0 && <p className="helper helper-warning">{problems.length} need{problems.length === 1 ? "s" : ""} a look: {problems.map((review) => `${name(review.ticket.a)}–${name(review.ticket.b)}`).slice(0, 4).join(", ")}{problems.length > 4 ? ` and ${problems.length - 4} more` : ""}.</p>}

      <div className="analysis-section">
        <p className="helper">Point at a row to see that ticket&apos;s shortest path on the map; click to keep it marked, and click again to let go. Suggested points come from this map&apos;s own tickets, not from a fixed table.</p>
        <div className="analysis-table-scroll"><table className="analysis-table">
          <thead><tr>{heading("ticket", "Ticket")}{heading("spaces", "Spaces")}{heading("points", "Points")}{heading("suggested", "Suggested")}{heading("long", "Long")}<th /></tr></thead>
          <tbody>{sorted.map((review) => <tr key={review.ticket.id} className={cn("analysis-row-link", review.verdict !== "ok" && "analysis-warning-row", review.ticket.id === selected && "analysis-row-active")} tabIndex={0} role="button"
            onPointerEnter={() => onHoverTicket(review.ticket.id)} onPointerLeave={() => onHoverTicket(null)} onFocus={() => onHoverTicket(review.ticket.id)} onBlur={() => onHoverTicket(null)}
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

      {compare && <DeckCompare view={compare} />}

      <div className="analysis-section">
        <h3>Length spread</h3>
        <p className="helper">{lengths.length ? `Shortest ${lengths[0]}, median ${lengths[Math.floor(lengths.length / 2)]}, longest ${lengths[lengths.length - 1]} wagon spaces.` : "No reachable tickets yet."} A deck with only short tickets plays differently from one with a long tail.</p>
      </div>

      <div className="analysis-section">
        <h3>Stops with no ticket names</h3>
        {uncovered.length ? <>
          <p className="helper">{uncovered.length} of {coverage.length}. Nothing sends a player there — pick one to start a ticket from it.</p>
          <div className="uncovered-stops">{uncovered.map((entry) => <button type="button" key={entry.stop.id} className="uncovered-stop" onClick={() => onStartFrom(entry.stop.id)}>{entry.stop.name}</button>)}</div>
        </> : <p className="helper">Every stop is named by at least one ticket.</p>}
      </div>
    <Button variant="outline" size="sm" onClick={onClose}>Done</Button>
  </div>;
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

// Build a full deck of tickets for the map that is open, then let the person edit it as ordinary tickets.
export function SuggestTicketsDialog({ tension, onTension, open, onOpenChange, data, current, suggestion, style, onStyle, wagons, onWagons, deckSize, onDeckSize, keepExisting, onKeepExisting, busy, deckName, onDeckName, currentDeck, onShuffle, onApply }: { tension: DeckTension; onTension: (tension: DeckTension) => void;
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
  // Ours and the map's own, and the one chosen now.
  const rules = deckRules(data);
  const rule = deckRuleFor(data, style);
  // On a small map the official density is fewer tickets than a full table is dealt. That is the
  // person's to decide, so a deck that is too small is warned about here and never held up.
  const needed = dealtToFullTable(data);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    {/* A fixed shape, set here rather than in the stylesheet so the utility classes on DialogContent
        cannot win: shuffling repeatedly must not move the button under the pointer. */}
    <DialogContent className="suggest-dialog" style={{ height: "86vh", maxHeight: 860 }}>
      <DialogHeader>
        <DialogTitle>Build a full deck of tickets</DialogTitle>
        <DialogDescription>Every target below comes from the official Ticket to Ride decks, not from this map. Save the result as a new deck under a name of your own, or let it replace the deck you are working on.</DialogDescription>
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
      <TensionSlider legend="How tense" name="suggest-tension" value={tension} onChange={onTension} />
      <p className="helper">{busy ? "Working out a deck… " : ""} The wagon count is this map&apos;s own setting and changing it here changes it there. A player&apos;s reach is {report?.reach ?? current.reach} wagon spaces, from {rule.lengthCap} × {wagons} wagons.</p>
      {deckSize < needed && <div className="helper helper-warning deck-size-warning" role="status">
        <span>Too few to deal a full table: {needed} tickets are dealt at the start ({tableWord(data.players?.max ?? 5)} players, {data.startingTickets ?? 3} each), and this deck has {deckSize}. It is allowed. Official decks have {TICKET_SUGGESTER.official.perStop[0]}–{TICKET_SUGGESTER.official.perStop[1]} tickets per stop.</span>
        <Button size="sm" variant="outline" onClick={() => onDeckSize(needed)}>Use {needed}</Button>
      </div>}
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

// How the network holds together, described rather than judged: dead ends, routes whose loss cuts
// the map in two, and corners reached only through one or two stops, each beside what the official
// maps have. Pointing at a row marks it on the map.
// This map's figures beside what the eight official maps measure, each with its own deck at a full
// table. A fact, never a warning: outside the range says how the map differs, not that it is wrong.
function OfficialFigures({ official, stats }: { official: { players: number; crowded: number; connections: number; loadRatio: number | null; unusedPct: number; maxPerStop: number }; stats: NetworkStats }) {
  const hubs = [...stats.hubDegree.values()];
  const hubMean = hubs.length ? hubs.reduce((sum, value) => sum + value, 0) / hubs.length : null;
  const span = ([low, high]: [number, number], unit = "") => `${low}–${high}${unit}`;
  const rows: [string, string, string][] = [
    ["Crowded routes at a full table, as a share of all routes", official.connections === 0 ? "no routes" : `${Math.round(100 * official.crowded / official.connections)} % (${official.crowded} of ${official.connections} routes, at ${official.players} player${official.players === 1 ? "" : "s"})`, span(BALANCE_OFFICIAL.crowdedPct, " %")],
    ["Double routes: their ticket traffic against single ones", official.loadRatio === null ? "no double routes" : `${official.loadRatio.toFixed(1)}×`, span(BALANCE_OFFICIAL.loadRatio, "×")],
    ["Routes no ticket needs", `${Math.round(official.unusedPct)} %`, span(BALANCE_OFFICIAL.unusedPct, " %")],
    ["Most tickets on one stop", String(official.maxPerStop), span(BALANCE_OFFICIAL.maxPerStop)],
    ["Average hub degree", hubMean === null ? "no stops" : hubMean.toFixed(1), span(BALANCE_OFFICIAL.hubDegree)],
  ];
  return <div className="analysis-section against-official">
    <h3>Against the official maps</h3>
    <p className="helper">This map beside what the eight official maps measure, each with its own deck at a full table. Outside the range is not a fault: it says how this map differs.</p>
    <div className="analysis-table-scroll"><table className="analysis-table official-table">
      <thead><tr><th>Figure</th><th>This map</th><th>Official maps</th></tr></thead>
      <tbody>{rows.map(([label, here, range]) => <tr key={label}><td>{label}</td><td>{here}</td><td>{range}</td></tr>)}</tbody>
    </table></div>
  </div>;
}

// What it warns of comes with something to do: a second lane for a route that cuts the map with one,
// and the stop itself, selected, for a stop no route reaches. Dead ends and corners are character.
function NetworkShapeSection({ data, onPreviewRoutes, onPreviewStop, onAddParallel, onSelectStop }: { data: MapData; onPreviewRoutes: (routeIds: string[] | null) => void; onPreviewStop: (stopId: string | null) => void; onAddParallel: (routeId: string) => void; onSelectStop: (stopId: string) => void }) {
  const shape = networkShape(data);
  const names = (stops: { name: string }[]) => stops.map((stop) => stop.name).join(", ");
  const and = (stops: { name: string }[]) => stops.length === 1 ? stops[0].name : `${stops.slice(0, -1).map((stop) => stop.name).join(", ")} and ${stops[stops.length - 1].name}`;
  const leave = () => { onPreviewRoutes(null); onPreviewStop(null); };
  const nothing = !shape.unconnected.length && !shape.deadEnds.length && !shape.bridges.length && !shape.corners.length;
  return <div className="analysis-section network-shape">
    <h3>How the network holds together</h3>
    <p className="helper">Edges and corners give a map its character. Of {SHAPE_OFFICIAL.maps} official maps, {SHAPE_OFFICIAL.mapsWithCorners} have corners reached through one or two stops, such as Iberia in Europe, behind Pamplona and Marseille, and one has a dead end, Edinburgh, behind a double route. None has a route with one lane whose loss cuts the map in two: there, a single claim shuts part of the map off.</p>
    {nothing && <p className="helper">No dead end, nothing that cuts the map in two, no corner: every part of the map can be reached more than one way.</p>}
    {shape.unconnected.length > 0 && <div className="shape-group"><h4>Stops with no route</h4>{shape.unconnected.map((stop) => <div key={stop.id} className="shape-line"><button type="button" className="shape-row has-warning" onPointerEnter={() => onPreviewStop(stop.id)} onPointerLeave={leave} onFocus={() => onPreviewStop(stop.id)} onBlur={leave}><strong>{stop.name}</strong><span>no route reaches it</span></button><Button size="sm" variant="outline" className="shape-action" aria-label={`Select ${stop.name}`} onClick={() => { leave(); onSelectStop(stop.id); }}>Select it</Button></div>)}</div>}
    {shape.deadEnds.length > 0 && <div className="shape-group"><h4>Dead ends</h4>{shape.deadEnds.map((stop) => <button type="button" key={stop.id} className="shape-row" onPointerEnter={() => onPreviewStop(stop.id)} onPointerLeave={leave} onFocus={() => onPreviewStop(stop.id)} onBlur={leave}><strong>{stop.name}</strong><span>one way in</span></button>)}</div>}
    {shape.bridges.length > 0 && <div className="shape-group"><h4>Routes that cut the map in two</h4>{shape.bridges.map((bridge) => <div key={bridge.routeIds.join()} className="shape-line"><button type="button" className={cn("shape-row", bridge.lanes === 1 && "has-warning")} onPointerEnter={() => onPreviewRoutes(bridge.routeIds)} onPointerLeave={leave} onFocus={() => onPreviewRoutes(bridge.routeIds)} onBlur={leave}><strong>{bridge.a.name}–{bridge.b.name}</strong><span>{bridge.lanes === 1 ? "one lane: a single claim cuts off what lies beyond" : `a double route, as Edinburgh–London is: still open while one lane is free`}</span></button>{bridge.lanes === 1 && <Button size="sm" variant="outline" className="shape-action" onClick={() => { leave(); onAddParallel(bridge.routeIds[0]); }}>Add a second lane</Button>}</div>)}</div>}
    {shape.corners.length > 0 && <div className="shape-group"><h4>Corners</h4>{shape.corners.map((corner) => <button type="button" key={corner.stops.map((stop) => stop.id).join()} className="shape-row" onPointerEnter={() => onPreviewRoutes(corner.routeIds)} onPointerLeave={leave} onFocus={() => onPreviewRoutes(corner.routeIds)} onBlur={leave}><strong>{names(corner.stops)}</strong><span>reached only through {and(corner.gates)} ({corner.routeIds.length} route{corner.routeIds.length === 1 ? "" : "s"})</span></button>)}</div>}
  </div>;
}
