"use client";

// The hidden print tree: one page per board panel, or a single page for a test sheet.
import { cn } from "@/lib/utils";
import { mapFormats, type MapData, W } from "./map-data";
import { MapArtwork } from "./map-artwork";

export function PrintPages({ data, scaleWidthMm }: { data: MapData; scaleWidthMm: number }) {
  const format = mapFormats[data.format];
  const panels = Array.from({ length: format.columns * format.rows }, (_, index) => ({ column: index % format.columns, row: Math.floor(index / format.columns) }));
  return <div className={cn("print-pages", `format-${data.format}`)} aria-hidden="true">{panels.map(({ column, row }, index) => {
    const panelWidth = W / format.columns;
    const panelHeight = format.height / format.rows;
    const printedPanelScale = Math.round(190 / (format.widthMm / format.columns) * 100);
    const panelName = format.columns === 1 ? `${format.shortLabel} · ${format.widthMm} × ${format.heightMm} mm${format.imperial ? ` (${format.imperial})` : ""}` : `Panel ${index + 1} of ${panels.length} · row ${row + 1}, column ${column + 1} · A4 proof at about ${printedPanelScale}%`;
    return <section className="print-page" key={`${column}-${row}`}><div className="print-caption"><strong>{data.name}</strong><span>{panelName}</span></div><svg viewBox={`${column * panelWidth} ${row * panelHeight} ${panelWidth} ${panelHeight}`}><MapArtwork data={data} scaleWidthMm={scaleWidthMm} print /></svg></section>;
  })}</div>;
}

