"use client";

import { useEffect, useRef } from "react";
import { mapFormats, type MapData } from "./map-data";
import { boardOf } from "./board";
import { MapArtwork } from "./map-artwork";

// The board as a picture. It is drawn the way the print draws it (no selection, handles or guides),
// in an SVG that sits off screen for a moment so the page's own style sheets apply to it. Those
// styles are then written into the copy that is rasterised, because an SVG used as an image cannot
// see the page's style sheets.
const PIXELS_PER_UNIT = 3;
const PAPER = "#f7f1e5";
const STYLED = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "font-family", "font-size", "font-weight", "font-style", "letter-spacing", "text-anchor", "dominant-baseline", "paint-order", "visibility", "display"];

const SVG_NS = "http://www.w3.org/2000/svg";

// A note's text is HTML inside the SVG (foreignObject), which taints the canvas it is drawn to. It is
// replaced by SVG text, one element per line the page laid out, read back from the live copy.
function notesAsText(source: SVGSVGElement, copy: SVGSVGElement) {
  const live = Array.from(source.querySelectorAll("foreignObject"));
  Array.from(copy.querySelectorAll("foreignObject")).forEach((object, index) => {
    const box = live[index]?.firstElementChild as HTMLElement | undefined;
    const group = document.createElementNS(SVG_NS, "g");
    const node = box?.firstChild;
    if (box && node && node.nodeType === Node.TEXT_NODE) {
      const area = box.getBoundingClientRect(), computed = getComputedStyle(box);
      const lines = new Map<number, { left: number; text: string }>();
      const range = document.createRange();
      const text = node.textContent ?? "";
      let clipped = false;
      for (let i = 0; i < text.length; i += 1) {
        range.setStart(node, i); range.setEnd(node, i + 1);
        const rect = range.getClientRects()[0];
        if (!rect || rect.width === 0) continue;
        if (rect.right > area.right + 1 || rect.bottom > area.bottom + 1) { clipped = true; continue; }
        const top = Math.round(rect.top);
        const line = lines.get(top) ?? { left: rect.left, text: "" };
        line.text += text[i]; lines.set(top, line);
      }
      [...lines.entries()].sort((a, b) => a[0] - b[0]).forEach(([top, line], row, all) => {
        const label = document.createElementNS(SVG_NS, "text");
        label.setAttribute("x", String(line.left - area.left));
        label.setAttribute("y", String(top - area.top));
        label.setAttribute("xml:space", "preserve");
        label.setAttribute("style", `dominant-baseline:text-before-edge;fill:${computed.color};font-family:${computed.fontFamily};font-size:${computed.fontSize};font-weight:${computed.fontWeight};font-style:${computed.fontStyle}`);
        label.textContent = clipped && row === all.length - 1 ? `${line.text.trimEnd()}…` : line.text;
        group.append(label);
      });
    }
    object.replaceWith(group);
  });
}

function withStylesWritten(source: SVGSVGElement): SVGSVGElement {
  const copy = source.cloneNode(true) as SVGSVGElement;
  const from = [source, ...Array.from(source.querySelectorAll("*"))];
  const to = [copy, ...Array.from(copy.querySelectorAll("*"))];
  from.forEach((el, index) => {
    const computed = getComputedStyle(el);
    const target = to[index] as SVGElement;
    // Text and strokes that are hairlines on screen stay the width the page measured them at, since
    // the stage draws one map unit as one pixel and vector-effect is dropped below.
    // Computed `url(#grid)` comes back with the page's address in front; as an image that is an outside
    // reference, and it taints the canvas.
    const here = location.href.split("#")[0];
    target.style.cssText = STYLED.map((name) => `${name}:${computed.getPropertyValue(name).split(here).join("")}`).join(";");
    target.removeAttribute("class");
  });
  notesAsText(source, copy);
  return copy;
}

export function rasteriseBoard(source: SVGSVGElement, width: number, height: number): Promise<Blob> {
  const copy = withStylesWritten(source);
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(width * PIXELS_PER_UNIT));
  copy.setAttribute("height", String(height * PIXELS_PER_UNIT));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml;charset=utf-8" }));
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * PIXELS_PER_UNIT; canvas.height = height * PIXELS_PER_UNIT;
      const context = canvas.getContext("2d");
      if (!context) { URL.revokeObjectURL(url); reject(new Error("No canvas")); return; }
      context.fillStyle = PAPER; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No picture"))), "image/png");
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The board could not be drawn")); };
    image.src = url;
  });
}

// Mounted only while a picture is being made. It reports the PNG, or the failure, and is then removed.
export function ImageStage({ data, onDone, onFail }: { data: MapData; onDone: (blob: Blob) => void; onFail: () => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const format = boardOf(data);
  useEffect(() => {
    let cancelled = false;
    // Two frames, so styles and fonts are applied before they are read.
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      if (cancelled || !svg.current) return;
      rasteriseBoard(svg.current, format.width, format.height).then((blob) => { if (!cancelled) onDone(blob); }, () => { if (!cancelled) onFail(); });
    }));
    return () => { cancelled = true; cancelAnimationFrame(frame); };
    // One picture per mount: the callbacks are new on every render and must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div className="image-stage" aria-hidden="true" style={{ position: "fixed", left: -20000, top: 0, width: format.width, height: format.height, pointerEvents: "none" }}>
    <svg ref={svg} width={format.width} height={format.height} viewBox={`0 0 ${format.width} ${format.height}`}>
      <MapArtwork data={data} scaleWidthMm={mapFormats[data.format].widthMm} print />
    </svg>
  </div>;
}
