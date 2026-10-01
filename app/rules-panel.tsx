"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { MapData } from "./map-data";
import { RulesText, type RulesHover } from "./rules-text";

// The rules of the map being designed: markdown in a plain text area, with a preview that draws
// stops and routes the way the map does. Written into the map, and printed after the board when the
// print dialog says so. In the right column, so the map stays in view beside it.
const STARTER = "# Rules\n\nWrite the rules of this map here. Name a stop as [[Westport]], or a route as [[Westport–Central]], and it is drawn as it is on the map.\n\n- **Bold**, *italic*, lists, tables and headings work\n- Pointing at a name in the preview marks it on the map";

export function RulesPanel({ data, wide, onToggleWide, onClose, onChange, hover }: {
  data: MapData;
  wide: boolean;
  onToggleWide: () => void;
  onClose: () => void;
  onChange: (text: string) => void;
  hover: RulesHover;
}) {
  const [draft, setDraft] = useState(data.rules ?? "");
  const kept = useRef(data.rules ?? "");
  const latest = useRef(draft);
  latest.current = draft;
  const commit = (text: string) => { if (text !== kept.current) { kept.current = text; onChange(text); } };
  // Typing is one change in the map's history once it pauses, not one per key.
  useEffect(() => { const timer = window.setTimeout(() => commit(draft), 600); return () => window.clearTimeout(timer); }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => commit(latest.current), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Undo, redo and import change the text from outside.
  useEffect(() => { const outside = data.rules ?? ""; if (outside !== kept.current) { kept.current = outside; setDraft(outside); } }, [data.rules]);
  useEffect(() => () => { hover.stop(null); hover.routes(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const written = useMemo(() => draft.trim().length > 0, [draft]);
  return <div className="balance-panel rules-panel">
    <div className="panel-heading"><span>Rules</span><Button size="sm" variant="outline" aria-expanded={wide} onClick={onToggleWide}>{wide ? "Collapse" : "Expand"}</Button></div>
    <p className="helper">The rules of this map, written in markdown and kept in the map file. Name a stop as <code>[[Westport]]</code> and a route as <code>[[Westport–Central]]</code>: the preview draws them as the map does, and pointing at one marks it on the map. They print on pages of their own after the board when the print dialog says so.</p>
    <div className="rules-body">
      <div className="rules-editor">
        <Label htmlFor="rules-text">Rules text</Label>
        <textarea id="rules-text" aria-label="Rules text" value={draft} placeholder={STARTER} spellCheck onChange={(event) => setDraft(event.target.value)} onBlur={() => commit(draft)} />
        <small>Headings with #, lists with - or 1., **bold**, *italic*, tables with |, a line across with ---, quotes with &gt;.</small>
      </div>
      <div className="rules-view">
        <span className="rules-view-label">Preview</span>
        <div className="rules-preview">{written ? <RulesText source={draft} data={data} hover={hover} /> : <p className="helper">Nothing written yet.</p>}</div>
      </div>
    </div>
    <Button variant="outline" size="sm" onClick={onClose}>Done</Button>
  </div>;
}
