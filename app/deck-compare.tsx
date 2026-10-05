"use client";

import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { DeckFigures } from "./map-analysis";
import { BIN_LABELS } from "./deck-rules-panel";

// This deck against another, figure by figure, with the difference. Both come from the same
// measures the rest of the Tickets panel uses, so a figure here agrees with the section it comes from.
export type DeckCompareView = {
  others: { id: string; label: string }[];
  otherId: string;
  onOther: (setId: string) => void;
  a: { label: string; figures: DeckFigures };
  b: { label: string; figures: DeckFigures };
};

type Row = { id: string; label: string; get: (f: DeckFigures) => number | null; unit?: "%"; digits?: number };
const groups: { title: string; rows: Row[] }[] = [
  { title: "The deck", rows: [
    { id: "tickets", label: "Tickets", get: (f) => f.tickets },
    { id: "long", label: "Long tickets", get: (f) => f.long },
    { id: "points", label: "Points in all", get: (f) => f.points },
    { id: "per-ticket", label: "Points per ticket", get: (f) => f.pointsPerTicket, digits: 1 },
  ] },
  { title: "How long the tickets are, in wagon spaces", rows: [
    { id: "shortest", label: "Shortest", get: (f) => f.shortest },
    { id: "median", label: "Median", get: (f) => f.median },
    { id: "longest", label: "Longest", get: (f) => f.longest },
    { id: "mix-short", label: "Short", get: (f) => f.mix?.[0] ?? null, unit: "%" },
    { id: "mix-medium", label: "Medium", get: (f) => f.mix?.[1] ?? null, unit: "%" },
    { id: "mix-long", label: "Long", get: (f) => f.mix?.[2] ?? null, unit: "%" },
    ...BIN_LABELS.map((label, index): Row => ({ id: `bin-${index}`, label: `Reach ${label}`, get: (f) => f.bins?.[index] ?? null, unit: "%" })),
  ] },
  { title: "How it lies on the map", rows: [
    { id: "uncovered", label: "Stops with no ticket names", get: (f) => f.uncovered },
    { id: "crowded", label: "Crowded routes", get: (f) => f.crowded },
    { id: "duplicates", label: "Duplicate pairs", get: (f) => f.duplicates },
    { id: "unused", label: "Routes no ticket uses", get: (f) => f.unusedPct, unit: "%" },
    { id: "off-path", label: "Points off the path rule", get: (f) => f.offPath },
  ] },
];

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
const show = (value: number | null, row: Row) => (value === null ? "—" : `${round(value, row.digits ?? 0).toLocaleString("en-GB", { minimumFractionDigits: row.digits ?? 0 })}${row.unit === "%" ? " %" : ""}`);
const signed = (value: number, row: Row) => {
  const r = round(value, row.digits ?? 0);
  if (r === 0) return "0";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toLocaleString("en-GB", { minimumFractionDigits: row.digits ?? 0 })}${row.unit === "%" ? " pts" : ""}`;
};

export function DeckCompare({ view }: { view: DeckCompareView }) {
  return <div className="analysis-section deck-compare">
    <h3>Compare decks</h3>
    <p className="helper">This deck against another, figure by figure. The last column is the other deck minus this one.</p>
    <div className="deck-compare-pick"><Label htmlFor="compare-with">Compare with</Label>
      <NativeSelect id="compare-with" aria-label="Compare with" value={view.otherId} onChange={(event) => view.onOther(event.target.value)}>
        {view.others.map((deck) => <NativeSelectOption key={deck.id} value={deck.id}>{deck.label}</NativeSelectOption>)}
      </NativeSelect></div>
    <div className="analysis-table-scroll"><table className="compare-table">
      <thead><tr><th>Figure</th><th className="cmp-a" title={view.a.label}>{view.a.label}</th><th className="cmp-b" title={view.b.label}>{view.b.label}</th><th className="cmp-delta">Other − this</th></tr></thead>
      <tbody>{groups.map((group) => [
        <tr key={group.title} className="compare-group"><th colSpan={4}>{group.title}</th></tr>,
        ...group.rows.map((row) => {
          const a = row.get(view.a.figures), b = row.get(view.b.figures);
          const delta = a !== null && b !== null ? b - a : null;
          return <tr key={row.id} data-row={row.id}>
            <td>{row.label}</td>
            <td className="cmp-a" data-value={a ?? ""}>{show(a, row)}</td>
            <td className="cmp-b" data-value={b ?? ""}>{show(b, row)}</td>
            <td className="cmp-delta" data-value={delta === null ? "" : round(delta, row.digits ?? 0)}>{delta === null ? "—" : signed(delta, row)}</td>
          </tr>;
        }),
      ])}</tbody>
    </table></div>
  </div>;
}
