"use client";

// How tense a full deck of tickets is: a slider from calm through like the official maps to tense,
// with the three named places as buttons and a description of what the chosen place means. Moving the
// slider shows the description at once; the choice is made when it is let go, by pointer or key, so a deck is not built
// again at every step along the way.
import { useState } from "react";
import { cn } from "@/lib/utils";
import { TENSION_CHOICES, tensionDescription } from "./map-analysis";

export function TensionSlider({ legend, name, value, onChange, className }: { legend: string; name: string; value: number; onChange: (level: number) => void; className?: string }) {
  const [draft, setDraft] = useState(value);
  // A value chosen elsewhere (a button, another panel) replaces what was being moved here.
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setDraft(value); }
  const commit = () => { if (draft !== value) onChange(draft); };
  const described = tensionDescription(draft);
  return <fieldset className={cn("tension-slider", className)}>
    <legend>{legend}</legend>
    <div className="tension-slider-row">
      <span aria-hidden="true">Calm</span>
      <input type="range" name={name} min={0} max={100} step={1} value={draft} aria-label="Tension, from 0 calm to 100 tense" aria-valuetext={`${draft}: ${described.name}`}
        onChange={(event) => setDraft(Number(event.target.value))} onPointerUp={commit} onKeyUp={commit} />
      <span aria-hidden="true">Tense</span>
      <output className="tension-slider-value" aria-label="Tension chosen">{draft}</output>
    </div>
    <div className="tension-presets">{TENSION_CHOICES.map((choice) => <button type="button" key={choice.level} aria-pressed={draft === choice.level} className={cn("tension-preset", draft === choice.level && "chosen")} onClick={() => { setDraft(choice.level); onChange(choice.level); }}>{choice.label}</button>)}</div>
    <p className="tension-description"><strong>{described.name}.</strong> {described.text}</p>
  </fieldset>;
}
