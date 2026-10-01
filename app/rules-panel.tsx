"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bold, Heading, Italic, List, ListOrdered, Minus, Quote, Table } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { MapData } from "./map-data";
import { RulesText, type RulesHover } from "./rules-text";

// The rules of the map being designed: markdown in a plain text area, with a toolbar that writes the
// markdown for you and a preview that draws stops and routes the way the map does. Written into the
// map, and printed after the board when the print dialog says so. In the right column, so the map
// stays in view beside it.
const STARTER = "# Rules\n\nWrite the rules of this map here. Name a stop as [[Westport]], or a route as [[Westport–Central]], and it is drawn as it is on the map.\n\n- **Bold**, *italic*, lists, tables and headings work\n- Pointing at a name in the preview marks it on the map";
const MARKDOWN_HELP = "https://commonmark.org/help/";

// The toolbar edits the text area itself, through the browser's own insert, so the text area's undo
// keeps working; where that is not allowed it sets the text and tells the page it changed.
function edit(el: HTMLTextAreaElement, from: number, to: number, text: string, selectFrom: number, selectTo: number) {
  el.focus();
  el.setSelectionRange(from, to);
  if (!document.execCommand("insertText", false, text)) {
    el.setRangeText(text, from, to, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.setSelectionRange(selectFrom, selectTo);
}

function wrap(el: HTMLTextAreaElement, mark: string, placeholder = "text") {
  const { selectionStart: from, selectionEnd: to, value } = el;
  const chosen = value.slice(from, to);
  const around = value.slice(from - mark.length, from) === mark && value.slice(to, to + mark.length) === mark;
  // One star is italic and two are bold: a single star next to another is the other mark's, not ours.
  const single = mark.length === 1 && (value[from - 2] === mark || value[to + 1] === mark);
  if (around && !single) { edit(el, from - mark.length, to + mark.length, chosen, from - mark.length, from - mark.length + chosen.length); return; }
  const inner = chosen || placeholder;
  edit(el, from, to, `${mark}${inner}${mark}`, from + mark.length, from + mark.length + inner.length);
}

// The lines the selection touches, as a block of text to rewrite.
function lines(el: HTMLTextAreaElement) {
  const { selectionStart: from, selectionEnd: to, value } = el;
  const start = value.lastIndexOf("\n", from - 1) + 1;
  const last = to > from && value[to - 1] === "\n" ? to - 1 : to;
  const found = value.indexOf("\n", last);
  const end = found < 0 ? value.length : found;
  return { start, end, rows: value.slice(start, end).split("\n") };
}

function prefixLines(el: HTMLTextAreaElement, has: RegExp, add: (row: string, n: number) => string) {
  const { start, end, rows } = lines(el);
  const filled = rows.filter((row) => row.trim());
  const off = filled.length > 0 && filled.every((row) => has.test(row));
  let n = 0;
  const next = rows.map((row) => { if (!row.trim()) return row; n += 1; return off ? row.replace(has, "") : add(row, n); }).join("\n");
  edit(el, start, end, next, start, start + next.length);
}

function cycleHeading(el: HTMLTextAreaElement) {
  const { start, end, rows } = lines(el);
  const [first] = rows;
  const level = /^(#{1,3})\s/.exec(first)?.[1].length ?? 0;
  const bare = first.replace(/^#{1,3}\s+/, "");
  const next = level >= 3 ? bare : `${"#".repeat(level + 1)} ${bare}`;
  edit(el, start, start + first.length, next, start + next.length, start + next.length);
  void end;
}

// A block of its own: set apart from the line before it by a blank line.
function insertBlock(el: HTMLTextAreaElement, block: string, selectFrom: number, selectTo: number) {
  const { selectionStart: at, selectionEnd: to, value } = el;
  const lead = at === 0 || value.slice(0, at).endsWith("\n\n") ? "" : value.slice(0, at).endsWith("\n") ? "\n" : "\n\n";
  edit(el, at, to, `${lead}${block}\n`, at + lead.length + selectFrom, at + lead.length + selectTo);
}

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
  const area = useRef<HTMLTextAreaElement>(null);
  latest.current = draft;
  const commit = (text: string) => { if (text !== kept.current) { kept.current = text; onChange(text); } };
  // Typing is one change in the map's history once it pauses, not one per key.
  useEffect(() => { const timer = window.setTimeout(() => commit(draft), 600); return () => window.clearTimeout(timer); }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => commit(latest.current), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Undo, redo and import change the text from outside.
  useEffect(() => { const outside = data.rules ?? ""; if (outside !== kept.current) { kept.current = outside; setDraft(outside); } }, [data.rules]);
  useEffect(() => () => { hover.stop(null); hover.routes(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const written = useMemo(() => draft.trim().length > 0, [draft]);
  const stops = useMemo(() => [...data.stops].sort((a, b) => a.name.localeCompare(b.name)), [data.stops]);
  // One entry for each pair of stops with a route between them: a double route is still one name.
  const routes = useMemo(() => {
    const name = (id: string) => data.stops.find((stop) => stop.id === id)?.name;
    const pairs = new Set<string>();
    for (const route of data.routes) { const a = name(route.a), b = name(route.b); if (a && b) pairs.add(`${a}–${b}`); }
    return [...pairs].sort((a, b) => a.localeCompare(b));
  }, [data.stops, data.routes]);
  const act = (run: (el: HTMLTextAreaElement) => void) => { if (area.current) run(area.current); };
  const tool = (label: string, shortcut: string | null, icon: React.ReactNode, run: (el: HTMLTextAreaElement) => void) =>
    <Button key={label} type="button" size="icon" variant="ghost" aria-label={label} title={shortcut ? `${label} (${shortcut})` : label} onMouseDown={(event) => event.preventDefault()} onClick={() => act(run)}>{icon}</Button>;
  return <div className="balance-panel rules-panel">
    <div className="panel-heading"><span>Rules</span><Button size="sm" variant="outline" aria-expanded={wide} onClick={onToggleWide}>{wide ? "Collapse" : "Expand"}</Button></div>
    <p className="helper">The rules of this map, written in markdown and kept in the map file. New to markdown? <a href={MARKDOWN_HELP} target="_blank" rel="noopener noreferrer">A short guide to markdown</a> (opens another site). Name a stop as <code>[[Westport]]</code> and a route as <code>[[Westport–Central]]</code>, or pick them from the lists below: the preview draws them as the map does, and pointing at one marks it on the map. They print on pages of their own after the board when the print dialog says so.</p>
    <div className="rules-body">
      <div className="rules-editor">
        <Label htmlFor="rules-text">Rules text</Label>
        <div className="rules-toolbar" role="toolbar" aria-label="Format the rules">
          {tool("Bold", "Ctrl/Cmd+B", <Bold />, (el) => wrap(el, "**"))}
          {tool("Italic", "Ctrl/Cmd+I", <Italic />, (el) => wrap(el, "*"))}
          {tool("Heading", null, <Heading />, cycleHeading)}
          {tool("Bulleted list", null, <List />, (el) => prefixLines(el, /^\s*[-*+]\s+/, (row) => `- ${row}`))}
          {tool("Numbered list", null, <ListOrdered />, (el) => prefixLines(el, /^\s*\d+[.)]\s+/, (row, n) => `${n}. ${row}`))}
          {tool("Quote", null, <Quote />, (el) => prefixLines(el, /^\s*>\s?/, (row) => `> ${row}`))}
          {tool("Table", null, <Table />, (el) => insertBlock(el, "| Column | Column |\n| --- | --- |\n| | |", 2, 8))}
          {tool("Line", null, <Minus />, (el) => insertBlock(el, "---", 3, 3))}
          <select aria-label="Insert a stop" value="" onChange={(event) => { const name = event.target.value; if (name) act((el) => { const { selectionStart: a, selectionEnd: b } = el; edit(el, a, b, `[[${name}]]`, a + name.length + 4, a + name.length + 4); }); }}>
            <option value="">Stop…</option>
            {stops.map((stop) => <option key={stop.id} value={stop.name}>{stop.name}</option>)}
          </select>
          <select aria-label="Insert a route" value="" onChange={(event) => { const name = event.target.value; if (name) act((el) => { const { selectionStart: a, selectionEnd: b } = el; edit(el, a, b, `[[${name}]]`, a + name.length + 4, a + name.length + 4); }); }}>
            <option value="">Route…</option>
            {routes.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <textarea ref={area} id="rules-text" aria-label="Rules text" value={draft} placeholder={STARTER} spellCheck onChange={(event) => setDraft(event.target.value)} onBlur={() => commit(draft)}
          onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && (event.key === "b" || event.key === "i")) { event.preventDefault(); event.stopPropagation(); wrap(event.currentTarget, event.key === "b" ? "**" : "*"); } }} />
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
