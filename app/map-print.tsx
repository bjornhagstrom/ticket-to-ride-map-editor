"use client";

// The hidden print tree: one page per board panel, or a single page for a test sheet.
import { cn } from "@/lib/utils";
import { mapFormats, ticketsInSet, type MapData, W } from "./map-data";
import { MapArtwork } from "./map-artwork";

// Tickets print as cut-out cards on plain A4, 16 to a sheet. The same print-and-cut workflow as the
// board itself: no bleed, a thin cut line, and nothing that needs colour to be readable.
const CARDS_PER_PAGE = 16;

export function TicketPrintPages({ data, setId }: { data: MapData; setId: string }) {
  const set = data.ticketSets.find((item) => item.id === setId) ?? data.ticketSets[0];
  const name = (id: string) => data.stops.find((stop) => stop.id === id)?.name ?? "—";
  const tickets = ticketsInSet(data, set?.id ?? "");
  const pageCount = Math.max(1, Math.ceil(tickets.length / CARDS_PER_PAGE));
  return <div className="print-pages print-tickets" aria-hidden="true">
    <style>{"@media print{@page{size:210mm 297mm;margin:0}}"}</style>
    {Array.from({ length: pageCount }, (_, page) => <section className="print-page ticket-page" key={page}>
      <div className="print-caption"><strong>{data.name}</strong><span>{set?.label} · tickets {page * CARDS_PER_PAGE + 1}–{Math.min(tickets.length, (page + 1) * CARDS_PER_PAGE)} of {tickets.length}</span></div>
      <div className="ticket-sheet">{tickets.slice(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE).map((ticket) => <div className="ticket-card" key={ticket.id}>
        <p className="ticket-card-from">{name(ticket.a)}</p>
        <p className="ticket-card-arrow">↕</p>
        <p className="ticket-card-to">{name(ticket.b)}</p>
        <p className="ticket-card-points">{ticket.points}</p>
        {ticket.long && <p className="ticket-card-flag">Long route</p>}
      </div>)}</div>
    </section>)}
  </div>;
}

export function PrintPages({ data, scaleWidthMm }: { data: MapData; scaleWidthMm: number }) {
  const format = mapFormats[data.format];
  // Ask the printer for the paper this format was laid out for. A sheet format prints at its own
  // size, landscape; a foldable board prints its panels as portrait A4 proofs. Explicit millimetres
  // rather than `A4 landscape`, because that form is the one print dialogs actually honour.
  // A board made of sheets prints one panel per landscape sheet at full size; a test sheet prints at
  // its own size; a real board is proofed onto portrait A4.
  const page = format.sheets ? (format.sheets === "a4" ? "297mm 210mm" : "279.4mm 215.9mm")
    : format.testSheet ? `${format.widthMm}mm ${format.heightMm}mm`
    : "210mm 297mm";
  const panels = Array.from({ length: format.columns * format.rows }, (_, index) => ({ column: index % format.columns, row: Math.floor(index / format.columns) }));
  return <div className={cn("print-pages", `format-${data.format}`)} aria-hidden="true">
    <style>{`@media print{@page{size:${page};margin:0}}`}</style>{panels.map(({ column, row }, index) => {
    const panelWidth = W / format.columns;
    const panelHeight = format.height / format.rows;
    const printedPanelScale = Math.round(190 / (format.widthMm / format.columns) * 100);
    const panelName = format.columns === 1 ? `${format.shortLabel} · ${format.widthMm} × ${format.heightMm} mm${format.imperial ? ` (${format.imperial})` : ""}` : format.sheets ? `Sheet ${index + 1} of ${panels.length} · row ${row + 1}, column ${column + 1} · full size, tape to its neighbours` : `Panel ${index + 1} of ${panels.length} · row ${row + 1}, column ${column + 1} · A4 proof at about ${printedPanelScale}%`;
    return <section className="print-page" key={`${column}-${row}`}><div className="print-caption"><strong>{data.name}</strong><span>{panelName}</span></div><svg viewBox={`${column * panelWidth} ${row * panelHeight} ${panelWidth} ${panelHeight}`}><MapArtwork data={data} scaleWidthMm={scaleWidthMm} print /></svg></section>;
  })}</div>;
}

