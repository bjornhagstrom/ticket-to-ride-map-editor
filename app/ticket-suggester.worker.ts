// The suggester off the main thread. Annealing a Europe-sized map takes the better part of a
// second, which is long enough to freeze the dialog it is drawn in.
import { suggestTickets, type TicketSuggestOptions } from "./ticket-suggester";
import type { MapData } from "./map-data";

export type SuggestRequest = { id: number; data: MapData; options: Partial<TicketSuggestOptions> };

self.onmessage = (event: MessageEvent<SuggestRequest>) => {
  const { id, data, options } = event.data;
  try {
    self.postMessage({ id, result: suggestTickets(data, options) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
