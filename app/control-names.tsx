"use client";
// Gives every field and tick box a name for a screen reader, where the page left it with none. A label that stands beside a field in the same box names the field; a tick box in a row of
// a table is named by its column and the row; a field with only a hint takes the hint. Nothing is changed that already has a name, and nothing is seen.
import { useEffect } from "react";

const CONTROLS = "input:not([type=hidden]):not([type=file]), select, textarea";

function hasName(element: HTMLElement): boolean {
  if (element.getAttribute("aria-label")?.trim() || element.getAttribute("title")?.trim()) return true;
  const labelled = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => (id ? document.getElementById(id)?.textContent ?? "" : "")).join("").trim();
  if (labelled) return true;
  const labels = (element as HTMLInputElement).labels;
  return Boolean(labels && [...labels].some((label) => label.textContent?.trim()));
}

function nameFor(element: HTMLInputElement): string {
  // The label standing in the same box: <div><label>Wagon length</label><input /></div>.
  // (A select sits in a wrapper of its own, so up to two boxes are tried.)
  let node: HTMLElement | null = element;
  for (let step = 0; step < 3 && node?.parentElement; step += 1) {
    node = node.parentElement;
    const label = node.querySelector(":scope > label, :scope > [data-slot=label], :scope > .label");
    const text = label?.textContent?.replace(/·.*$/, "").trim();
    if (text) return text;
    if (node.querySelectorAll(CONTROLS).length > 1) break;
  }
  // A tick box or a field in the row of a table: the heading of its column and the first cell of the row.
  const cell = element.closest("td");
  const row = cell?.parentElement as HTMLTableRowElement | null | undefined;
  if (cell && row) {
    const heading = cell.closest("table")?.querySelectorAll("thead th")[cell.cellIndex]?.textContent?.trim();
    const first = row.cells[0]?.textContent?.trim();
    if (heading || first) return [heading, first].filter(Boolean).join(": ");
  }
  return element.getAttribute("placeholder")?.trim() ?? "";
}

function nameControls(root: ParentNode) {
  root.querySelectorAll<HTMLInputElement>(CONTROLS).forEach((element) => {
    if (hasName(element)) return;
    const name = nameFor(element);
    if (name) element.setAttribute("aria-label", name);
  });
}

export function ControlNames() {
  useEffect(() => {
    let frame = 0;
    const run = () => { frame = 0; nameControls(document.body); };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(run); };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); if (frame) window.cancelAnimationFrame(frame); };
  }, []);
  return null;
}
