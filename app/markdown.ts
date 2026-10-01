// The rules text. A small subset of markdown, parsed to plain data and never to HTML, so nothing
// typed into the rules box can turn into markup. What it reads:
//
//   # Heading            (one to three #; deeper ones are the smallest heading)
//   paragraphs           (a blank line between them)
//   - list               (also * and +; two or more spaces deeper nests; 1. 2. 3. for a numbered one)
//   > a quote
//   ---                  (a line across)
//   | a | b |            (a table: a head, a line of ---, then rows; a colon on the right of --- aligns right)
//   **bold** *italic* _italic_ `code`   (a backslash makes a mark literal)
//   [[Westport]]  [[Westport–Central]]  (a stop, or the route between two stops)
import type { MapData, Route, Stop } from "./map-data";

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "ref"; name: string };

export type ListItem = { c: Inline[]; sub?: ListBlock };
export type ListBlock = { t: "ul" | "ol"; items: ListItem[] };
export type Block =
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | ListBlock
  | { t: "quote"; c: Inline[] }
  | { t: "hr" }
  | { t: "table"; head: Inline[][]; rows: Inline[][][]; align: (("right" | "center" | undefined))[] };

const PUNCTUATION = "\\`*_{}[]()#+-.!|<>~\"'";

// ---------------------------------------------------------------- inline
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => { if (text) { out.push({ t: "text", v: text }); text = ""; } };
  const wordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length && PUNCTUATION.includes(src[i + 1])) { text += src[i + 1]; i += 2; continue; }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) { flush(); out.push({ t: "code", v: src.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (ch === "[" && src[i + 1] === "[") {
      const end = src.indexOf("]]", i + 2);
      const name = end > 0 ? src.slice(i + 2, end).trim() : "";
      if (end > 0 && name && !name.includes("[[") && !name.includes("\n")) { flush(); out.push({ t: "ref", name }); i = end + 2; continue; }
    }
    if (ch === "*" && src[i + 1] === "*") {
      let end = src.indexOf("**", i + 2);
      while (end > 0 && /\s/.test(src[end - 1])) end = src.indexOf("**", end + 1);
      if (end > i + 2 && !/\s/.test(src[i + 2])) { flush(); out.push({ t: "strong", c: parseInline(src.slice(i + 2, end)) }); i = end + 2; continue; }
      text += "**"; i += 2; continue;
    }
    if (ch === "*" || ch === "_") {
      const opens = !/\s/.test(src[i + 1] ?? " ") && (ch === "*" || !wordChar(src[i - 1]));
      if (opens) {
        let end = i + 1;
        let found = -1;
        while (end < src.length) {
          const at = src.indexOf(ch, end);
          if (at < 0) break;
          const closes = !/\s/.test(src[at - 1]) && src[at + 1] !== ch && src[at - 1] !== ch && (ch === "*" || !wordChar(src[at + 1]));
          if (closes && at > i + 1) { found = at; break; }
          end = at + 1;
        }
        if (found > 0) { flush(); out.push({ t: "em", c: parseInline(src.slice(i + 1, found)) }); i = found + 1; continue; }
      }
    }
    text += ch; i += 1;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- blocks
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const isTableStart = (lines: string[], i: number) => lines[i].includes("|") && i + 1 < lines.length && lines[i + 1].includes("-") && SEPARATOR.test(lines[i + 1]) && lines[i + 1].includes("|");
const cells = (line: string): string[] => {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  const parts: string[] = [];
  let cell = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && body[i + 1] === "|") { cell += "|"; i += 1; continue; }
    if (body[i] === "|") { parts.push(cell.trim()); cell = ""; continue; }
    cell += body[i];
  }
  parts.push(cell.trim());
  return parts;
};
const startsBlock = (lines: string[], i: number) => HEADING.test(lines[i]) || RULE.test(lines[i]) || /^\s*>/.test(lines[i]) || ITEM.test(lines[i]) || isTableStart(lines, i);

type Flat = { indent: number; ordered: boolean; text: string };
function buildList(flat: Flat[], from: number, indent: number): { list: ListBlock; next: number } {
  const list: ListBlock = { t: flat[from].ordered ? "ol" : "ul", items: [] };
  let i = from;
  while (i < flat.length && flat[i].indent >= indent) {
    if (flat[i].indent > indent) {
      const last = list.items[list.items.length - 1];
      const nested = buildList(flat, i, flat[i].indent);
      if (last && !last.sub) last.sub = nested.list; else if (last?.sub) last.sub.items.push(...nested.list.items);
      i = nested.next;
      continue;
    }
    list.items.push({ c: parseInline(flat[i].text) });
    i += 1;
  }
  return { list, next: i };
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    const heading = HEADING.exec(line);
    if (heading) { blocks.push({ t: "h", level: Math.min(heading[1].length, 3) as 1 | 2 | 3, c: parseInline(heading[2]) }); i += 1; continue; }
    if (RULE.test(line)) { blocks.push({ t: "hr" }); i += 1; continue; }
    if (isTableStart(lines, i)) {
      const head = cells(line).map(parseInline);
      const align = cells(lines[i + 1]).map((spec) => (spec.endsWith(":") ? (spec.startsWith(":") ? "center" : "right") : undefined) as "right" | "center" | undefined);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) { rows.push(cells(lines[i]).map(parseInline)); i += 1; }
      blocks.push({ t: "table", head, rows, align });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { quoted.push(lines[i].replace(/^\s*>\s?/, "")); i += 1; }
      blocks.push({ t: "quote", c: parseInline(quoted.join(" ").trim()) });
      continue;
    }
    if (ITEM.test(line)) {
      const flat: Flat[] = [];
      while (i < lines.length) {
        const item = ITEM.exec(lines[i]);
        if (item) { flat.push({ indent: item[1].length, ordered: /\d/.test(item[2]), text: item[3] }); i += 1; continue; }
        if (!lines[i].trim()) {
          let ahead = i + 1;
          while (ahead < lines.length && !lines[ahead].trim()) ahead += 1;
          if (ahead < lines.length && ITEM.test(lines[ahead])) { i = ahead; continue; }
          break;
        }
        if (/^\s{2,}\S/.test(lines[i]) && flat.length) { flat[flat.length - 1].text += ` ${lines[i].trim()}`; i += 1; continue; }
        break;
      }
      // Indents are compared, not counted, so a list may nest by two spaces or by four.
      const base = Math.min(...flat.map((entry) => entry.indent));
      let at = 0;
      while (at < flat.length) { const built = buildList(flat, at, base); blocks.push(built.list); at = built.next; if (built.next === at && at < flat.length && flat[at].indent < base) at += 1; }
      continue;
    }
    const paragraph: string[] = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) { paragraph.push(lines[i].trim()); i += 1; }
    blocks.push({ t: "p", c: parseInline(paragraph.join(" ")) });
  }
  return blocks;
}

// ---------------------------------------------------------------- references
export type Reference =
  | { kind: "stop"; stop: Stop }
  | { kind: "route"; routes: Route[]; from: Stop; to: Stop }
  | { kind: "missing"; reason: "stop" | "route" };

const normal = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const DASHES = ["–", "—", "→", "->", "-"];

// A stop by its name, or the routes between two stops named either side of a dash. A stop's own
// name may hold hyphens, so every dash is tried as the split until both sides are stops.
export function resolveRef(name: string, data: Pick<MapData, "stops" | "routes">): Reference {
  const stopNamed = (text: string) => data.stops.find((stop) => normal(stop.name) === normal(text));
  const whole = stopNamed(name);
  if (whole) return { kind: "stop", stop: whole };
  let sawBoth = false;
  for (let at = 0; at < name.length; at++) {
    const dash = DASHES.find((candidate) => name.startsWith(candidate, at));
    if (!dash) continue;
    const from = stopNamed(name.slice(0, at)), to = stopNamed(name.slice(at + dash.length));
    if (!from || !to || from.id === to.id) continue;
    sawBoth = true;
    const routes = data.routes.filter((route) => (route.a === from.id && route.b === to.id) || (route.a === to.id && route.b === from.id));
    if (routes.length) return { kind: "route", routes, from, to };
  }
  return { kind: "missing", reason: sawBoth ? "route" : "stop" };
}
