"use client";

// The hidden print trees, and the dialog that decides how the board is printed.
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { mapFormats, ticketsInSet, type MapData, type MapFormat, W } from "./map-data";
import { MapArtwork } from "./map-artwork";
import { RulesText } from "./rules-text";
import { CUT_MARK_GAP_MM, CUT_MARK_REACH_MM, describePlan, papers, PRINT_CAPTION_MM, PRINT_MARGIN_MM, printChoices, type PrintChoice, printPlan, type PrintPlan, type PrintProfile, sameChoice, splits, cardSheets } from "./print-plan";

// Tickets print as cut-out cards on plain A4, 16 to a sheet. The same print-and-cut workflow as the
// board itself: no bleed, a thin cut line, and nothing that needs colour to be readable.

export function TicketCards({ data, setId }: { data: MapData; setId: string }) {
  const set = data.ticketSets.find((item) => item.id === setId) ?? data.ticketSets[0];
  const name = (id: string) => data.stops.find((stop) => stop.id === id)?.name ?? "—";
  const tickets = ticketsInSet(data, set?.id ?? "");
  // One continuous run of cards rather than sheets of a fixed height. Any arithmetic that assumes
  // the printable area is exactly the paper would break on a browser that insists on its own
  // margins, and then every sheet spills a few millimetres onto a blank one. Letting the browser
  // paginate, with a card never split across a break, cannot overflow by construction.
  return <section className="print-tickets">
    <div className="ticket-run">
      <div className="print-caption"><strong>{data.name}</strong><span>{set?.label} · {tickets.length} ticket{tickets.length === 1 ? "" : "s"}</span></div>
      {/* Explicit rows of four, each a block that may not be split. Safari ignores break-inside on
          grid cells, which cut cards in half across the page break. */}
      {Array.from({ length: Math.ceil(tickets.length / 4) }, (_, row) => tickets.slice(row * 4, row * 4 + 4)).map((row, index) => <div className="ticket-row" key={index}>
        {row.map((ticket) => <div className="ticket-card" key={ticket.id}>
          <p className="ticket-card-from">{name(ticket.a)}</p>
          <p className="ticket-card-arrow">↕</p>
          <p className="ticket-card-to">{name(ticket.b)}</p>
          <p className="ticket-card-points">{ticket.points}</p>
          {ticket.long && <p className="ticket-card-flag">Long route</p>}
        </div>)}
      </div>)}
    </div>
  </section>;
}

// The board as the chosen print run cuts it. Page size, margins and the size of every tile come
// from printPlan, in millimetres, so the pages cannot disagree with what the dialog promised.
// What a print run holds, in the order it is printed: the board, then the tickets as cards, then the rules.
export type PrintParts = { board: boolean; tickets: boolean; rules: boolean };

export function PrintPages({ data, plan, parts, setId }: { data: MapData; plan: PrintPlan; parts: PrintParts; setId: string }) {
  const format = mapFormats[data.format];
  const full = plan.choice.split === "full";
  const percent = `${Math.round(plan.scale * 100)} %`;
  const caption = (page: PrintPlan["pages"][number]) => {
    const count = plan.pages.length;
    const where = `row ${page.row + 1}, column ${page.column + 1}`;
    if (full) return `Sheet ${page.index + 1} of ${count} · ${where} · full size · trim at the marks, butt to its neighbours`;
    if (plan.choice.split === "panel") return `Panel ${page.index + 1} of ${count} · ${where} · ${percent} of full size`;
    return `${format.shortLabel} · ${plan.boardMm.width} × ${plan.boardMm.height} mm · ${percent}`;
  };
  return <div className="print-pages print-map" aria-hidden="true">
    {/* The paper, upright, and its margin are declared here. The page box is never the paper's size:
        it is the turned sheet, which fits inside the paper less the margin. A browser that ignores
        @page margin and uses its own — Safari does — then still has room for it; a box the size of
        the paper would spill onto an empty sheet after every page, or be shrunk to fit. */}
    <style>{`@media print{@page{size:${plan.pageMm.width}mm ${plan.pageMm.height}mm;margin:${PRINT_MARGIN_MM}mm}}`}</style>
    {parts.board && plan.pages.map((page) => {
      // Each page is one SVG the size of the page box, in millimetres, holding the landscape sheet —
      // caption, artwork, frame or cut marks — turned a quarter turn with an SVG transform. Turning
      // HTML with a CSS transform printed the artwork shrunk in Chromium's PDF, and a CSS media query
      // for portrait paper was not honoured in Safari: see docs/PRINTING.md.
      const width = page.contentMm.width, artHeight = page.contentMm.height, height = PRINT_CAPTION_MM + artHeight;
      const corners: [number, number, number, number][] = [[0, PRINT_CAPTION_MM, -1, -1], [width, PRINT_CAPTION_MM, 1, -1], [0, height, -1, 1], [width, height, 1, 1]];
      // The one page the size of the board is not turned: its page is as wide as the board.
      return <section className="print-page" key={page.index} style={plan.turned ? { width: `${height}mm`, height: `${width}mm` } : { width: `${width}mm`, height: `${height}mm` }}>
        <svg className="print-sheet" width="100%" height="100%" viewBox={plan.turned ? `0 0 ${height} ${width}` : `0 0 ${width} ${height}`} overflow="visible">
          <g transform={plan.turned ? `translate(${height} 0) rotate(90)` : undefined}>
            <text className="print-sheet-name" x={2.5} y={PRINT_CAPTION_MM - 2.2}>{data.name}</text>
            <text className="print-sheet-note" x={width - 2.5} y={PRINT_CAPTION_MM - 2.2} textAnchor="end">{caption(page)}</text>
            <rect className={cn("print-sheet-art", full && "trimmed")} x={0} y={PRINT_CAPTION_MM} width={width} height={artHeight} />
            <svg x={0} y={PRINT_CAPTION_MM} width={width} height={artHeight} viewBox={`${page.tile.x * W} ${page.tile.y * format.height} ${page.tile.width * W} ${page.tile.height * format.height}`}>
              {/* Wagons are always measured against the board the map is drawn for; printing larger or
                  smaller scales them with everything else. */}
              <MapArtwork data={data} scaleWidthMm={format.widthMm} print />
            </svg>
            {full && corners.map(([x, y, dx, dy]) => <g className="cut-mark" key={`${x}-${y}`}>
              <line x1={x + dx * CUT_MARK_GAP_MM} y1={y} x2={x + dx * CUT_MARK_REACH_MM} y2={y} />
              <line x1={x} y1={y + dy * CUT_MARK_GAP_MM} x2={x} y2={y + dy * CUT_MARK_REACH_MM} />
            </g>)}
          </g>
        </svg>
      </section>;
    })}
    {/* The rules, if asked for, on pages of their own after the board: as many as the text needs,
        flowing in the same page box as the board's pages. */}
    {parts.tickets && <TicketCards data={data} setId={setId} />}
    {parts.rules && data.rules?.trim() && <section className="print-rules">
      <p className="print-rules-name">{data.name} · rules</p>
      <RulesText source={data.rules} data={data} print />
    </section>}
  </div>;
}

// Printing is decided per run. Nothing chosen here is written to the map; the last choice is kept
// in this browser only, for convenience.
export function PrintDialog({ open, onOpenChange, format, profile, choice, onChoice, parts, onPrint }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  format: MapFormat;
  profile: PrintProfile;
  choice: PrintChoice;
  onChoice: (choice: PrintChoice) => void;
  // What is ticked, what each part has to print, and what is on offer: a deck with no tickets has no
  // cards, and a map with no rules text has no rules.
  parts: { value: PrintParts; onChange: (parts: PrintParts) => void; rulesWritten: boolean; ticketCount: number; deckLabel: string };
  onPrint: () => void;
}) {
  const plan = printPlan(format, choice, profile);
  const { sizes, columns, table } = printChoices(format, profile);
  const current = plan.choice;
  const anniversary = sizes.find((size) => size.id === "anniversary");
  // Without the board in the run, how it is split, its size and its sheet table do not apply.
  const boardIn = parts.value.board;
  // The whole board on one page the size of the board: the paper is the board's own, and nothing else fits on it.
  const onePage = current.split === "page";
  const anything = parts.value.board || parts.value.tickets || parts.value.rules;
  const paperLabel = papers.find((paper) => paper.id === current.paper)?.label ?? "the paper";
  const cards = cardSheets(parts.ticketCount, plan.pageMm);
  // One sentence for the whole run, in the order it prints.
  const summary = !anything ? "Nothing is ticked: tick at least one of the board, the tickets and the rules."
    : [
      parts.value.board ? describePlan(plan) : null,
      parts.value.tickets ? `${parts.value.board ? "Then the" : "The"} ${parts.ticketCount} ticket${parts.ticketCount === 1 ? "" : "s"} of ${parts.deckLabel} as cut-out cards, ${cards.sheets} sheet${cards.sheets === 1 ? "" : "s"} of ${paperLabel}.` : null,
      parts.value.rules ? `${parts.value.board || parts.value.tickets ? "Then the rules" : "The rules text"}, on pages of their own${parts.value.board || parts.value.tickets ? "" : ", upright on " + paperLabel + ", as many as it needs"}.` : null,
    ].filter(Boolean).join(" ");
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="print-dialog">
      <DialogHeader>
        <DialogTitle>Print the map</DialogTitle>
        <DialogDescription>How this print run comes out. None of it changes the map: the board stays a {mapFormats[format].shortLabel}.</DialogDescription>
      </DialogHeader>
      <div className="print-choices">
        <fieldset><legend>What to print</legend>
          <label className="print-option">
            <input type="checkbox" name="print-board" aria-label="Print the board" aria-describedby="print-board-note"
              checked={parts.value.board} onChange={(event) => parts.onChange({ ...parts.value, board: event.target.checked })} />
            <span><strong>The board</strong><small id="print-board-note">The map on its sheets, as chosen below.</small></span>
          </label>
          <label className="print-option">
            <input type="checkbox" name="print-tickets" aria-label="Print the tickets" aria-describedby="print-tickets-note" disabled={parts.ticketCount === 0 || onePage}
              checked={parts.value.tickets} onChange={(event) => parts.onChange({ ...parts.value, tickets: event.target.checked })} />
            <span><strong>The tickets</strong><small id="print-tickets-note">{parts.ticketCount === 0 ? "This deck has no tickets yet." : `${parts.deckLabel}, ${parts.ticketCount} ticket${parts.ticketCount === 1 ? "" : "s"}, as cut-out cards.`}</small></span>
          </label>
          <label className="print-option">
            <input type="checkbox" name="print-rules" aria-label="Print the rules" aria-describedby="print-rules-note" disabled={!parts.rulesWritten || onePage}
              checked={parts.value.rules} onChange={(event) => parts.onChange({ ...parts.value, rules: event.target.checked })} />
            <span><strong>The rules</strong><small id="print-rules-note">{parts.rulesWritten ? "The rules text, on pages of their own." : "Nothing written yet. Open Rules in the left column to write them."}</small></span>
          </label>
          {onePage && <p className="helper">The page is the board&apos;s size, so the tickets and the rules are printed separately.</p>}
        </fieldset>
        {boardIn && <fieldset><legend>How it is split</legend>
          {splits.map((split) => <label key={split.id} className="print-option">
            <input type="radio" name="print-split" value={split.id} aria-label={split.label} aria-describedby={`print-split-${split.id}`}
              checked={current.split === split.id} onChange={() => onChoice({ ...current, split: split.id })} />
            <span><strong>{split.label}</strong><small id={`print-split-${split.id}`}>{split.note}</small></span>
          </label>)}
        </fieldset>}
        {!onePage && <fieldset><legend>Paper</legend>
          {papers.map((paper) => <label key={paper.id} className="print-option">
            <input type="radio" name="print-paper" value={paper.id} aria-label={paper.label} aria-describedby={`print-paper-${paper.id}`}
              checked={current.paper === paper.id} onChange={() => onChoice({ ...current, paper: paper.id })} />
            <span><strong>{paper.label}</strong><small id={`print-paper-${paper.id}`}>{paper.note}</small></span>
          </label>)}
        </fieldset>}
        {/* Anniversary exists only at full size, so ticking it asks for full size too, and a run
            that is not full size is never Anniversary. The table and the tick follow each other. */}
        {boardIn && !onePage && anniversary && <fieldset><legend>Supersize</legend>
          <label className="print-option">
            <input type="checkbox" name="print-anniversary" aria-label="Anniversary size" aria-describedby="print-anniversary-note"
              checked={current.split === "full" && current.size === "anniversary"}
              onChange={(event) => onChoice(event.target.checked ? { ...current, split: "full", size: "anniversary" } : { ...current, size: "standard" })} />
            <span><strong>Anniversary size</strong><small id="print-anniversary-note">{anniversary.widthMm} × {anniversary.heightMm} mm, bigger wagons too. Always printed full size.</small></span>
          </label>
        </fieldset>}
      </div>
      <p className="print-summary">{summary}</p>
      {boardIn && !onePage && <><h3 id="print-table-heading" className="print-table-heading">Sheets for every choice</h3>
      <p id="print-table-note" className="print-table-note">Each cell shows how many sheets a print run takes, and its scale: how big the printed board is against the real one. 100 % is real size; 50 % is half as wide and half as tall. Pick a cell to use it.</p>
      <div className="print-table-wrap">
        <table className="print-table" aria-labelledby="print-table-heading" aria-describedby="print-table-note">
          <colgroup><col className="print-table-paper" />{columns.map((label) => <col key={label} />)}</colgroup>
          <thead><tr><th scope="col">Paper</th>{columns.map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{table.map((row) => <tr key={row.paper.id} data-paper={row.paper.id}>
            <th scope="row">{row.paper.label}</th>
            {row.cells.map((cell) => <td key={cell.label}><button type="button" data-pages={cell.pages} aria-pressed={sameChoice(cell.choice, current)}
              aria-label={`${row.paper.label}, ${cell.label}: ${cell.pages} sheet${cell.pages === 1 ? "" : "s"} at ${Math.round(cell.scale * 100)} %`}
              onClick={() => onChoice(cell.choice)}><span>{cell.pages} sheet{cell.pages === 1 ? "" : "s"}</span> <small>{Math.round(cell.scale * 100)} %</small></button></td>)}
          </tr>)}</tbody>
        </table>
      </div></>}
      {boardIn && !onePage && profile.id === "safari" && <p className="helper print-dialog-foot print-safari-note">In Safari the sheets are cut shorter than in other browsers. Safari’s first print layout leaves less room on the page than it shows once any setting is changed, and a full-length sheet spilled onto a second page. The counts above are Safari’s.</p>}
      {!boardIn && <p className="helper print-dialog-foot">Pages print upright (portrait), the default in every browser. The page is the paper less a margin.</p>}
      {onePage && <p className="helper print-dialog-foot print-page-note">{profile.id === "safari"
        ? `Safari ignores the size of a page. In its print dialog, add a custom paper size of ${plan.pageMm.width} × ${plan.pageMm.height} mm (Paper Size, Manage Custom Sizes), then choose PDF, or use Chrome, Edge or Firefox.`
        : `The page is ${plan.pageMm.width} × ${plan.pageMm.height} mm. In the print dialog, choose Save as PDF, or a large-format printer.`}</p>}
      {boardIn && !onePage && <p className="helper print-dialog-foot">Every page prints upright (portrait), the default in every browser, with the map turned a quarter turn on it: leave the print dialog on Portrait. Print at 100 % — “fit to page” would undo the sizes above. The same dialog can save the run as a PDF.</p>}
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={onPrint} disabled={!anything}><Printer />Print</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
