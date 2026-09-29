"use client";

// Asks the worker for a suggested deck, and falls back to computing it here when a worker cannot be
// made — an older browser, or a page opened straight off the file system.
import { useEffect, useRef, useState } from "react";
import type { MapData, Ticket } from "./map-data";
import { suggestTickets, type TicketDeckReport, type TicketSuggestOptions } from "./ticket-suggester";

export type Suggestion = { tickets: Ticket[]; report: TicketDeckReport };

export function useTicketSuggestion(active: boolean, data: MapData, options: Partial<TicketSuggestOptions>): { suggestion: Suggestion | null; busy: boolean } {
  // What has been worked out, and for which question. Whether the answer is still being worked out
  // is read off those two rather than stored, so nothing has to be set while an effect runs.
  const [result, setResult] = useState<{ key: string; suggestion: Suggestion } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  // The options object is new on every render, so everything keys off its contents.
  const key = JSON.stringify(options);

  useEffect(() => {
    if (!active) return;
    const request = ++requestRef.current;

    if (!workerRef.current && typeof Worker !== "undefined") {
      try { workerRef.current = new Worker(new URL("./ticket-suggester.worker.ts", import.meta.url)); }
      catch { workerRef.current = null; }
    }
    const worker = workerRef.current;
    if (!worker) {
      // No worker: do it here, on the next tick, and accept the pause.
      const timer = window.setTimeout(() => setResult({ key, suggestion: suggestTickets(data, JSON.parse(key)) }), 0);
      return () => window.clearTimeout(timer);
    }

    const onMessage = (event: MessageEvent<{ id: number; result?: Suggestion }>) => {
      if (event.data.id !== request || !event.data.result) return;
      setResult({ key, suggestion: event.data.result });
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage({ id: request, data, options: JSON.parse(key) });
    return () => worker.removeEventListener("message", onMessage);
  }, [active, data, key]);

  useEffect(() => () => { workerRef.current?.terminate(); workerRef.current = null; }, []);

  if (!active) return { suggestion: null, busy: false };
  return { suggestion: result?.suggestion ?? null, busy: result?.key !== key };
}
