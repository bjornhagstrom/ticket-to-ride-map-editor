"use client";

// The rules the ticket suggester follows on this map. Our three sets are shown as they are and cannot
// be changed; a set of the map's own is made from one of them and can be. The map chooses which one
// the suggester follows. Shares are kept as fractions and shown as percentages.
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { deckRuleFor, deckRules, defaultStyle, type DeckRule, TICKET_SUGGESTER } from "./map-analysis";
import type { DeckRuleSet, MapData } from "./map-data";

const BIN_LABELS = ["under 30 %", "30–45 %", "45–60 %", "60–75 %", "75 % and over"];
const pct = (share: number) => Math.round(share * 1000) / 10;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const official = TICKET_SUGGESTER.official;
// "relative" and "point" in TICKET_SUGGESTER: how far from the middle of the map a deck's tickets end.
const PERIPHERY = {
  relative: "Long ones further out than an average stop, short ones further in",
  point: "Long ones a set distance out, as the USA and Europe decks do",
  explain: "How far from the middle of the map long and short tickets start and end. The first only counts tickets on the wrong side; the second aims at the distances the two official decks use.",
};

export function DeckRulesPanel({ data, change }: { data: MapData; change: (fn: (draft: MapData) => MapData) => void }) {
  const rules = deckRules(data);
  const chosenId = data.deckRule ?? defaultStyle(data);
  const chosen = deckRuleFor(data, chosenId);
  const choose = (id: string) => change((draft) => { draft.deckRule = id; return draft; });
  const createFrom = (base: DeckRule) => change((draft) => {
    const id = `rules-${Date.now()}`;
    const own: DeckRuleSet = {
      id, label: `${base.label} (own)`, basedOn: base.custom ? base.basedOn : base.id,
      ticketsPerStop: base.ticketsPerStop, longPerStop: base.longPerStop, bins: [...base.bins],
      longRange: base.longRange ? [base.longRange[0], base.longRange[1]] : null, bonusFrom: base.bonusFrom,
      lengthCap: base.lengthCap, maxPerStop: base.maxPerStop, dupRate: base.dupRate, periphery: base.periphery,
    };
    draft.deckRules = [...(draft.deckRules ?? []), own];
    draft.deckRule = id;
    return draft;
  });
  const update = (id: string, patch: Partial<DeckRuleSet>) => change((draft) => {
    draft.deckRules = (draft.deckRules ?? []).map((rule) => rule.id === id ? { ...rule, ...patch } : rule);
    return draft;
  });
  const remove = (id: string) => change((draft) => {
    draft.deckRules = (draft.deckRules ?? []).filter((rule) => rule.id !== id);
    if (!draft.deckRules.length) draft.deckRules = undefined;
    if (draft.deckRule === id) draft.deckRule = undefined;
    return draft;
  });
  const deck = data.tickets;
  const why = deck.some((ticket) => ticket.long) ? "the deck already has long tickets" : (data.startingTickets ?? 3) >= 4 ? "the map deals four or more tickets" : "it is the average of seven official maps";

  return <div className="deck-rules">
    <fieldset className="deck-rule-list">
      <legend>Rules the suggester follows on this map</legend>
      {rules.map((rule) => <label key={rule.id} className={cn("deck-rule-choice", rule.id === chosen.id && "chosen")}>
        <input type="radio" name="deck-rule" aria-label={rule.label} checked={rule.id === chosen.id} onChange={() => choose(rule.id)} />
        <span><strong>{rule.label}</strong><small>{rule.custom ? "this map's own" : "ours, fixed"}</small></span>
      </label>)}
    </fieldset>
    {data.deckRule === undefined && <p className="helper deck-rule-default">Nothing chosen yet, so the suggester picks {chosen.label}, because {why}. Choose a set to fix it for this map.</p>}
    <div className="deck-rule-values">
      {chosen.custom ? <OwnRuleFields rule={chosen} onChange={(patch) => update(chosen.id, patch)} onDelete={() => remove(chosen.id)} /> : <FixedRuleValues rule={chosen} />}
      {!chosen.custom && <Button size="sm" variant="outline" onClick={() => createFrom(chosen)}><Plus />Create your own from {chosen.label}</Button>}
      <p className="helper">{data.ticketMix
        ? "This map has its own ticket mix, below. The suggester aims at that mix rather than at these length shares."
        : "The suggester follows these length shares until you change the ticket mix below; from then on it aims at the map's own mix instead."}</p>
    </div>
  </div>;
}

// Ours, shown as they are: what each value is, and where the official decks measure.
function FixedRuleValues({ rule }: { rule: DeckRule }) {
  const row = (label: string, value: string, range?: string) => <div key={label}><dt>{label}</dt><dd>{value}{range && <small> · official {range}</small>}</dd></div>;
  return <>
    <p className="helper">{rule.blurb}</p>
    <dl className="deck-rule-table">
      {row("Tickets per stop", String(rule.ticketsPerStop), `${official.perStop[0]}–${official.perStop[1]}`)}
      {row("Long deck, per stop", rule.longPerStop ? String(rule.longPerStop) : "none")}
      {row("Lengths, share of the deck", rule.bins.map((share, index) => `${pct(share)} % ${BIN_LABELS[index]}`).join(" · "))}
      {row("Long tickets reach", rule.longRange ? `${pct(rule.longRange[0])}–${pct(rule.longRange[1])} % of reach` : "no separate long deck")}
      {row("Bonus for the longest", rule.bonusFrom === null ? "none" : `from ${pct(rule.bonusFrom)} % of reach`)}
      {row("Longest regular ticket", `${pct(rule.lengthCap)} % of reach`, `${pct(official.lengthCap[0])}–${pct(official.lengthCap[1])} %`)}
      {row("Most tickets at one stop", String(rule.maxPerStop), `${official.maxPerStop[0]}–${official.maxPerStop[1]}`)}
      {row("Near-duplicate tickets", `${pct(rule.dupRate)} %`, `${official.dupPct[0]}–${official.dupPct[1]} %`)}
      {row("Where tickets start and end", rule.periphery === "relative" ? PERIPHERY.relative : PERIPHERY.point)}
    </dl>
  </>;
}

// The map's own: every value can be changed, and lengths that do not add up are flagged.
function OwnRuleFields({ rule, onChange, onDelete }: { rule: DeckRule; onChange: (patch: Partial<DeckRuleSet>) => void; onDelete: () => void }) {
  const number = (id: string, label: string, value: number, apply: (value: number) => void, step = 0.05, hint?: string) => <div key={id}>
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} type="number" step={step} value={value} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) apply(next); }} />
    {hint && <small className="deck-rule-hint">{hint}</small>}
  </div>;
  const binTotal = Math.round(rule.bins.reduce((sum, share) => sum + share, 0) * 1000) / 10;
  const setBin = (index: number, percent: number) => onChange({ bins: rule.bins.map((share, i) => i === index ? clamp(percent, 0, 100) / 100 : share) });
  const optionalPct = (id: string, label: string, value: number | null, apply: (value: number | null) => void) => <div key={id}>
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} type="number" step={1} placeholder="none" value={value === null ? "" : pct(value)} onChange={(event) => apply(event.target.value === "" ? null : clamp(Number(event.target.value) || 0, 0, 100) / 100)} />
  </div>;
  return <>
    <div><Label htmlFor="rule-name">Name</Label><Input id="rule-name" value={rule.label} onChange={(event) => onChange({ label: event.target.value })} /></div>
    <p className="helper">{rule.blurb}</p>
    <div className="deck-rule-fields">
      {number("rule-tickets-per-stop", "Tickets per stop", rule.ticketsPerStop, (value) => onChange({ ticketsPerStop: clamp(value, 0.05, 5) }), 0.05, `official ${official.perStop[0]}–${official.perStop[1]}`)}
      {number("rule-long-per-stop", "Long deck, per stop", rule.longPerStop, (value) => onChange({ longPerStop: clamp(value, 0, 2) }), 0.01)}
      {number("rule-max-per-stop", "Most tickets at one stop", rule.maxPerStop, (value) => onChange({ maxPerStop: Math.max(1, Math.round(value)) }), 1, `official ${official.maxPerStop[0]}–${official.maxPerStop[1]}`)}
      {number("rule-length-cap", "Longest regular ticket, % of reach", pct(rule.lengthCap), (value) => onChange({ lengthCap: clamp(value, 1, 100) / 100 }), 1, `official ${pct(official.lengthCap[0])}–${pct(official.lengthCap[1])} %`)}
      {number("rule-dup-rate", "Near-duplicate tickets, %", pct(rule.dupRate), (value) => onChange({ dupRate: clamp(value, 0, 100) / 100 }), 0.5, `official ${official.dupPct[0]}–${official.dupPct[1]} %`)}
      {optionalPct("rule-bonus-from", "Bonus from, % of reach", rule.bonusFrom, (value) => onChange({ bonusFrom: value }))}
      {optionalPct("rule-long-from", "Long deck reaches from, %", rule.longRange ? rule.longRange[0] : null, (value) => onChange({ longRange: value === null ? null : [value, Math.max(value, rule.longRange?.[1] ?? 1)] }))}
      <div className="deck-rule-wide"><Label htmlFor="rule-periphery">Where tickets start and end</Label>
        <NativeSelect id="rule-periphery" value={rule.periphery} onChange={(event) => onChange({ periphery: event.target.value as DeckRuleSet["periphery"] })}>
          <NativeSelectOption value="relative">{PERIPHERY.relative}</NativeSelectOption>
          <NativeSelectOption value="point">{PERIPHERY.point}</NativeSelectOption>
        </NativeSelect>
        <small className="deck-rule-hint">{PERIPHERY.explain}</small></div>
    </div>
    <Label>Lengths, share of the regular deck, by how far a ticket reaches</Label>
    <div className="deck-rule-bins">
      {rule.bins.map((share, index) => <div key={index}>
        <Label htmlFor={`rule-bin-${index}`}>{BIN_LABELS[index]}</Label>
        <Input id={`rule-bin-${index}`} type="number" step={1} min={0} max={100} value={pct(share)} onChange={(event) => setBin(index, Number(event.target.value) || 0)} />
      </div>)}
    </div>
    <p className={cn("helper", Math.abs(binTotal - 100) > 1 && "helper-warning")}>{Math.abs(binTotal - 100) > 1 ? `These add up to ${binTotal} %, not 100 %. The suggester scales them, but the shares will not mean what they say.` : "Reach is the longest ticket a player can build with the map's wagons."}</p>
    <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 />Delete this set</Button>
  </>;
}
