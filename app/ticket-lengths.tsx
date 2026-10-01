"use client";

import { BIN_LABELS } from "./deck-rules-panel";

// How the deck's tickets spread over the five length bands, against the official decks and, when the
// map has chosen rules of its own, against those too. Shown in Map balance and in the Tickets dialog.
export type TicketLengthsView = {
  counts: number[];
  regular: number;
  reach: number;
  skipped: number;
  long: number;
  official: number[];
  own: { label: string; bins: number[] } | null;
};

const pct = (share: number) => Math.round(share * 100);

// The band the deck sits furthest from a reference in, said in a sentence.
function gapSentence(name: string, counts: number[], regular: number, reference: number[]): string {
  const gaps = counts.map((count, index) => count / regular - reference[index]);
  const worst = gaps.reduce((best, gap, index) => (Math.abs(gap) > Math.abs(gaps[best]) ? index : best), 0);
  if (Math.abs(gaps[worst]) < .05) return `Against ${name} the deck is close in every band.`;
  return `Against ${name} the deck is furthest off at ${BIN_LABELS[worst]} of reach: ${pct(counts[worst] / regular)} % of its tickets, against ${pct(reference[worst])} %.`;
}

export function TicketLengths({ view }: { view: TicketLengthsView }) {
  const { counts, regular, reach, skipped, long, official, own } = view;
  return <div className="analysis-section ticket-lengths">
    <h3>Ticket lengths</h3>
    {regular === 0 ? <p className="helper">No regular tickets in this deck yet.</p> : <>
      <p className="helper">How the {regular} regular tickets spread over how far they reach, as a share of the longest ticket a player can build{reach ? ` (${reach} wagon spaces)` : ""}.</p>
      <div className="length-legend" aria-hidden="true">
        <span><i className="length-key deck" />This deck</span>
        <span><i className="length-key official" />Official decks</span>
        {own && <span><i className="length-key own" />{own.label}</span>}
      </div>
      <div className="length-rows">
        {counts.map((count, index) => <div className="length-row" key={index}>
          <span className="length-label">{BIN_LABELS[index]}</span>
          <div className="length-track">
            <div className="length-fill" style={{ width: `${count / regular * 100}%` }} />
            <span className="length-ref" data-ref="official" style={{ left: `${official[index] * 100}%` }} title={`Official decks: ${pct(official[index])} %`} />
            {own && <span className="length-ref" data-ref="own" style={{ left: `${own.bins[index] * 100}%` }} title={`${own.label}: ${pct(own.bins[index])} %`} />}
          </div>
          <span className="length-numbers"><b className="length-count">{count}</b> <span className="length-share">{pct(count / regular)} %</span></span>
        </div>)}
      </div>
      {(skipped > 0 || long > 0) && <p className="helper length-excluded" data-skipped={skipped} data-long={long}>
        {skipped > 0 && `${skipped} ticket${skipped === 1 ? " is" : "s are"} not in the bars: longer than a player can build with their wagons, or to a stop nothing reaches.`}{skipped > 0 && long > 0 ? " " : ""}{long > 0 && `${long} long ticket${long === 1 ? " is" : "s are"} kept apart from them.`}
      </p>}
      <p className="helper length-verdict">{gapSentence("the official decks", counts, regular, official)}{own ? ` ${gapSentence(own.label, counts, regular, own.bins)}` : ""}</p>
    </>}
  </div>;
}
