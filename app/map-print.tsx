"use client";

// The hidden print tree: one page per board panel, or a single page for a test sheet.
import { cn } from "@/lib/utils";
import { mapFormats, type MapData, W } from "./map-data";
import { MapArtwork } from "./map-artwork";

export function PrintPages({ data, scaleWidthMm }: { data: MapData; scaleWidthMm: number }) {
  const format = mapFormats[data.format];
  // Ask the printer for the paper this format was laid out for. A sheet format prints at its own
  // size, landscape; a foldable board prints its panels as portrait A4 proofs. Explicit millimetres
  // rather than `A4 landscape`, because that form is the one print dialogs actually honour.
  const page = format.testSheet ? `${format.widthMm}mm ${format.heightMm}mm` : "210mm 297mm";
  const panels = Array.from({ length: format.columns * format.rows }, (_, index) => ({ column: index % format.columns, row: Math.floor(index / format.columns) }));
  return <div className={cn("print-pages", `format-${data.format}`)} aria-hidden="true">
    <style>{`@media print{@page{size:${page};margin:0}}`}</style>{panels.map(({ column, row }, index) => {
    const panelWidth = W / format.columns;
    const panelHeight = format.height / format.rows;
    const printedPanelScale = Math.round(190 / (format.widthMm / format.columns) * 100);
    const panelName = format.columns === 1 ? `${format.shortLabel} · ${format.widthMm} × ${format.heightMm} mm${format.imperial ? ` (${format.imperial})` : ""}` : `Panel ${index + 1} of ${panels.length} · row ${row + 1}, column ${column + 1} · A4 proof at about ${printedPanelScale}%`;
    return <section className="print-page" key={`${column}-${row}`}><div className="print-caption"><strong>{data.name}</strong><span>{panelName}</span></div><svg viewBox={`${column * panelWidth} ${row * panelHeight} ${panelWidth} ${panelHeight}`}><MapArtwork data={data} scaleWidthMm={scaleWidthMm} print /></svg></section>;
  })}</div>;
}

