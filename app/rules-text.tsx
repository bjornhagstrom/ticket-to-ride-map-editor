"use client";

import type { ReactNode } from "react";
import { fallbackStopTypeStyle, routeColorOf, routeColors, type MapData } from "./map-data";
import { parseMarkdown, resolveRef, type Block, type Inline, type ListBlock } from "./markdown";

// The rules text drawn: on screen beside the map, and on the pages after the board. Nothing here
// writes HTML; every node is built from the parsed text, so what is typed can only ever be text.
// A reference to a stop or a route is shown the way the map shows it: the stop's own symbol, the
// route's own colour. On screen they can be pointed at (the map marks them) and a name that is not
// there is flagged; in print a missing name is just its plain text.
export type RulesHover = { stop: (stopId: string | null) => void; routes: (routeIds: string[] | null) => void };

type Context = { data: MapData; print: boolean; hover?: RulesHover };

function Reference({ name, ctx }: { name: string; ctx: Context }) {
  const { data, print, hover } = ctx;
  const ref = resolveRef(name, data);
  if (ref.kind === "stop") {
    const meta = data.stopTypeStyles?.find((style) => style.id === ref.stop.type) ?? fallbackStopTypeStyle;
    return <span className="rule-ref stop" onPointerEnter={hover ? () => hover.stop(ref.stop.id) : undefined} onPointerLeave={hover ? () => hover.stop(null) : undefined}>
      <svg className="rule-symbol" viewBox="-10 -10 20 20" width="14" height="14" aria-hidden="true"><circle r="6.5" fill={meta.fill} stroke={meta.stroke} strokeWidth="2.4" />{meta.square && <rect x="-3" y="-3" width="6" height="6" fill={meta.stroke} />}</svg>
      {ref.stop.name}
    </span>;
  }
  if (ref.kind === "route") {
    const colourOf = (route: (typeof ref.routes)[number]) => {
      const type = data.routeTypeStyles.find((style) => style.id === route.type);
      return type?.infrastructure ? type.stroke : routeColorOf(route.color) ?? routeColors.neutral;
    };
    return <span className="rule-ref route" onPointerEnter={hover ? () => hover.routes(ref.routes.map((route) => route.id)) : undefined} onPointerLeave={hover ? () => hover.routes(null) : undefined}>
      {ref.routes.map((route) => <span key={route.id} className="rule-swatch" style={{ background: colourOf(route) }} />)}
      {ref.from.name}–{ref.to.name}
    </span>;
  }
  if (print) return <>{name}</>;
  return <span className="rule-ref missing" title={ref.reason === "stop" ? "No such stop on this map" : "No route between these two stops"}>{name}</span>;
}

function Inlines({ nodes, ctx }: { nodes: Inline[]; ctx: Context }): ReactNode {
  return <>{nodes.map((node, index) => {
    if (node.t === "text") return node.v;
    if (node.t === "code") return <code key={index}>{node.v}</code>;
    if (node.t === "strong") return <strong key={index}><Inlines nodes={node.c} ctx={ctx} /></strong>;
    if (node.t === "em") return <em key={index}><Inlines nodes={node.c} ctx={ctx} /></em>;
    return <Reference key={index} name={node.name} ctx={ctx} />;
  })}</>;
}

function List({ list, ctx }: { list: ListBlock; ctx: Context }) {
  const Tag = list.t;
  return <Tag>{list.items.map((item, index) => <li key={index}><Inlines nodes={item.c} ctx={ctx} />{item.sub && <List list={item.sub} ctx={ctx} />}</li>)}</Tag>;
}

function BlockView({ block, ctx }: { block: Block; ctx: Context }) {
  if (block.t === "h") { const Tag = `h${block.level}` as "h1" | "h2" | "h3"; return <Tag><Inlines nodes={block.c} ctx={ctx} /></Tag>; }
  if (block.t === "p") return <p><Inlines nodes={block.c} ctx={ctx} /></p>;
  if (block.t === "quote") return <blockquote><Inlines nodes={block.c} ctx={ctx} /></blockquote>;
  if (block.t === "hr") return <hr />;
  if (block.t !== "table") return <List list={block} ctx={ctx} />;
  return <table><thead><tr>{block.head.map((cell, i) => <th key={i} style={{ textAlign: block.align[i] }}><Inlines nodes={cell} ctx={ctx} /></th>)}</tr></thead>
    <tbody>{block.rows.map((row, r) => <tr key={r}>{block.head.map((_, i) => <td key={i} style={{ textAlign: block.align[i] }}>{row[i] ? <Inlines nodes={row[i]} ctx={ctx} /> : null}</td>)}</tr>)}</tbody></table>;
}

export function RulesText({ source, data, print = false, hover }: { source: string; data: MapData; print?: boolean; hover?: RulesHover }) {
  const ctx: Context = { data, print, hover };
  return <>{parseMarkdown(source).map((block, index) => <BlockView key={index} block={block} ctx={ctx} />)}</>;
}
