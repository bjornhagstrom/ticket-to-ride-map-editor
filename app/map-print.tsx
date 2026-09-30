"use client";

// The hidden print trees, and the dialog that decides how the board is printed.
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { mapFormats, ticketsInSet, type MapData, type MapFormat, W } from "./map-data";
import { MapArtwork } from "./map-artwork";
import { describePlan, papers, PRINT_CAPTION_MM, PRINT_MARGIN_MM, printChoices, type PrintChoice, printPlan, type PrintPlan, sameChoice, splits } from "./print-plan";

// Tickets print as cut-out cards on plain A4, 16 to a sheet. The same print-and-cut workflow as the
// board itself: no bleed, a thin cut line, and nothing that needs colour to be readable.

export function TicketPrintPages({ data, setId }: { data: MapData; setId: string }) {
  const set = data.ticketSets.find((item) => item.id === setId) ?? data.ticketSets[0];
  const name = (id: string) => data.stops.find((stop) => stop.id === id)?.name ?? "—";
  const tickets = ticketsInSet(data, set?.id ?? "");
  // One continuous run of cards rather than sheets of a fixed height. Any arithmetic that assumes
  // the printable area is exactly the paper would break on a browser that insists on its own
  // margins, and then every sheet spills a few millimetres onto a blank one. Letting the browser
  // paginate, with a card never split across a break, cannot overflow by construction.
  return <div className="print-pages print-tickets" aria-hidden="true">
    <style>{"@media print{@page{size:210mm 297mm;margin:10mm}}"}</style>
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
  </div>;
}

// The board as the chosen print run cuts it. Page size, margins and the size of every tile come
// from printPlan, in millimetres, so the pages cannot disagree with what the dialog promised.
export function PrintPages({ data, plan }: { data: MapData; plan: PrintPlan }) {
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
    {/* The paper and its margin are declared here, but the page box is only as wide as the paper
        less that margin and has no fixed height. A browser that ignores @page margin and uses its
        own — Safari does — then still has room for it; a box the size of the paper would spill
        onto an empty sheet after every page, or be shrunk to fit and no longer print full size. */}
    <style>{`@media print{@page{size:${plan.pageMm.width}mm ${plan.pageMm.height}mm;margin:${PRINT_MARGIN_MM}mm}}`}</style>
    {plan.pages.map((page) => <section className="print-page" key={page.index}
      style={{ width: `${plan.pageMm.width - 2 * PRINT_MARGIN_MM}mm` }}>
      <div className="print-caption" style={{ height: `${PRINT_CAPTION_MM}mm`, width: `${page.contentMm.width}mm` }}><strong>{data.name}</strong><span>{caption(page)}</span></div>
      <div className={cn("print-art", full && "trimmed")} style={{ width: `${page.contentMm.width}mm`, height: `${page.contentMm.height}mm` }}>
        <svg viewBox={`${page.tile.x * W} ${page.tile.y * format.height} ${page.tile.width * W} ${page.tile.height * format.height}`}>
          {/* Wagons are always measured against the board the map is drawn for; printing larger or
              smaller scales them with everything else. */}
          <MapArtwork data={data} scaleWidthMm={format.widthMm} print />
        </svg>
        {full && ["top-left", "top-right", "bottom-left", "bottom-right"].map((corner) => <span key={corner} className={cn("cut-mark", corner)} />)}
      </div>
    </section>)}
  </div>;
}

// Printing is decided per run. Nothing chosen here is written to the map; the last choice is kept
// in this browser only, for convenience.
export function PrintDialog({ open, onOpenChange, format, choice, onChoice, onPrint }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  format: MapFormat;
  choice: PrintChoice;
  onChoice: (choice: PrintChoice) => void;
  onPrint: () => void;
}) {
  const plan = printPlan(format, choice);
  const { sizes, columns, table } = printChoices(format);
  const current = plan.choice;
  const anniversary = sizes.find((size) => size.id === "anniversary");
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="print-dialog">
      <DialogHeader>
        <DialogTitle>Print the map</DialogTitle>
        <DialogDescription>How this print run comes out. None of it changes the map: the board stays a {mapFormats[format].shortLabel}.</DialogDescription>
      </DialogHeader>
      <div className="print-choices">
        <fieldset><legend>How it is split</legend>
          {splits.map((split) => <label key={split.id} className="print-option">
            <input type="radio" name="print-split" value={split.id} aria-label={split.label} aria-describedby={`print-split-${split.id}`}
              checked={current.split === split.id} onChange={() => onChoice({ ...current, split: split.id })} />
            <span><strong>{split.label}</strong><small id={`print-split-${split.id}`}>{split.note}</small></span>
          </label>)}
        </fieldset>
        <fieldset><legend>Paper</legend>
          {papers.map((paper) => <label key={paper.id} className="print-option">
            <input type="radio" name="print-paper" value={paper.id} aria-label={paper.label} aria-describedby={`print-paper-${paper.id}`}
              checked={current.paper === paper.id} onChange={() => onChoice({ ...current, paper: paper.id })} />
            <span><strong>{paper.label}</strong><small id={`print-paper-${paper.id}`}>{paper.note}</small></span>
          </label>)}
        </fieldset>
        {/* Anniversary exists only at full size, so ticking it asks for full size too, and a run
            that is not full size is never Anniversary. The table and the tick follow each other. */}
        {anniversary && <fieldset><legend>Supersize</legend>
          <label className="print-option">
            <input type="checkbox" name="print-anniversary" aria-label="Anniversary size" aria-describedby="print-anniversary-note"
              checked={current.split === "full" && current.size === "anniversary"}
              onChange={(event) => onChoice(event.target.checked ? { ...current, split: "full", size: "anniversary" } : { ...current, size: "standard" })} />
            <span><strong>Anniversary size</strong><small id="print-anniversary-note">{anniversary.widthMm} × {anniversary.heightMm} mm, bigger wagons too. Always printed full size.</small></span>
          </label>
        </fieldset>}
      </div>
      <p className="print-summary">{describePlan(plan)}</p>
      <h3 id="print-table-heading" className="print-table-heading">Sheets for every choice</h3>
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
      </div>
      <p className="helper print-dialog-foot">The browser’s print dialog can also save the run as a PDF. Print at 100 % — “fit to page” would undo the sizes above.</p>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={onPrint}><Printer />Print</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
