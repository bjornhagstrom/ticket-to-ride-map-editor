"use client";

// How tense a full deck of tickets is: a slider from calm through like the official maps to tense,
// with the three named places as buttons and a description of what the chosen place means. Moving the
// slider shows the description at once; the choice is made when it is let go, by pointer or key, so a deck is not built
// again at every step along the way. A slider moved by a screen reader (swipe up or down on a phone) sends change events and no key or
// pointer, so the choice is also made when the value has stopped changing for a moment, and when the slider loses focus.
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { TENSION_CHOICES, tensionDescription } from "./map-analysis";

// How long a value must stay put, with no pointer held, before it is chosen without a key or pointer to say so.
const SETTLE_MS = 700;

export function TensionSlider({ legend, name, value, onChange, className }: { legend: string; name: string; value: number; onChange: (level: number) => void; className?: string }) {
  const [draft, setDraft] = useState(value);
  // A value chosen elsewhere (a button, another panel) replaces what was being moved here.
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setDraft(value); }
  const commit = () => { if (draft !== value) onChange(draft); };
  // A pointer held down is still moving; otherwise a value that stays put for SETTLE_MS is chosen. The latest draft and the
  // current value are read when the timer fires, so a slider moved on, or chosen by a button meanwhile, is not overwritten.
  const held = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ draft, value, onChange });
  useEffect(() => { latest.current = { draft, value, onChange }; });
  const cancel = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const settle = () => { cancel(); timer.current = setTimeout(() => { timer.current = null; const now = latest.current; if (!held.current && now.draft !== now.value) now.onChange(now.draft); }, SETTLE_MS); };
  useEffect(() => cancel, []);
  const described = tensionDescription(draft);
  return <fieldset className={cn("tension-slider", className)}>
    <legend>{legend}</legend>
    <div className="tension-slider-row">
      <span aria-hidden="true">Calm</span>
      <input type="range" name={name} min={0} max={100} step={1} value={draft} aria-label="Tension, from 0 calm to 100 tense" aria-valuetext={`${draft}: ${described.name}`}
        onChange={(event) => { setDraft(Number(event.target.value)); if (!held.current) settle(); }}
        onPointerDown={() => { held.current = true; cancel(); }} onPointerUp={() => { held.current = false; cancel(); commit(); }} onPointerCancel={() => { held.current = false; cancel(); commit(); }}
        onKeyUp={() => { cancel(); commit(); }} onBlur={() => { cancel(); commit(); }} />
      <span aria-hidden="true">Tense</span>
      <output className="tension-slider-value" aria-label="Tension chosen">{draft}</output>
    </div>
    <div className="tension-presets">{TENSION_CHOICES.map((choice) => <button type="button" key={choice.level} aria-pressed={draft === choice.level} className={cn("tension-preset", draft === choice.level && "chosen")} onClick={() => { setDraft(choice.level); onChange(choice.level); }}>{choice.label}</button>)}</div>
    <p className="tension-description"><strong>{described.name}.</strong> {described.text}</p>
  </fieldset>;
}
