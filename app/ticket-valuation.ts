// What a destination ticket is worth. Every point value in the editor comes from here.
//
// The default is the shortest path in wagon spaces, which is exactly what the classic official maps
// do: Nordic 46/46, India 58/58, Polska 35/35, Switzerland's city tickets 34/34. Colour, grey
// routes, tunnels and ferry locomotives change nothing. docs/TICKET-VALUATION.md has the evidence
// per map, and the modifiers below are the only departures any official map justifies — all of them
// off unless a map asks for them.
import type { MapData } from "./map-data";

export type TicketValuation = {
  // +1 for a ticket at 0.9 of reach or beyond, +2 for the single longest. USA does this.
  longBonus: boolean;
  // Extra points per ferry space, rounded up over the whole ticket. Italia uses 0.5. Maps whose
  // ferries only ask for a locomotive, as Europe's and Nordic's do, get none.
  ferryPremium: number;
};

export const defaultValuation: TicketValuation = { longBonus: false, ferryPremium: 0 };

// What the path a ticket would be built along costs and crosses.
export type TicketPath = {
  spaces: number;        // the shortest path in wagon spaces
  routes: number;        // how many separate routes that path is made of
  ferrySpaces: number;   // spaces on routes that need a locomotive
  frac: number;          // spaces as a share of reach
  longest: boolean;      // the longest ticket in the deck being valued
};

export type TicketValue = {
  points: number;
  base: number;
  bonus: number;
  // A path exists that costs exactly one space more but is made of fewer routes, so it takes one
  // turn less to build. Several official +1 cards follow such a path. The value is never raised for
  // it — the designer is told and decides.
  ambiguous: boolean;
};

// The only place a ticket's points are decided.
export function valueTicket(path: TicketPath, data: MapData, options?: Partial<TicketValuation>): TicketValue {
  const valuation = { ...defaultValuation, ...(data.ticketValuation ?? {}), ...(options ?? {}) };
  const base = path.spaces;
  let bonus = 0;
  if (valuation.longBonus && path.frac >= .9) bonus += path.longest ? 2 : 1;
  if (valuation.ferryPremium > 0 && path.ferrySpaces > 0) {
    bonus += Math.ceil(base + valuation.ferryPremium * path.ferrySpaces) - base;
  }
  return { points: base + bonus, base, bonus, ambiguous: false };
}

// A designer's own correction, kept apart from the computed value so that suggesting a new deck
// never silently overwrites it.
export function finalPoints(value: TicketValue, adjust?: number): number {
  return Math.max(1, value.points + (adjust ?? 0));
}

// Maps whose rules the editor cannot model priced their tickets 1.2–1.5 times the path. Say so
// rather than guess a number.
export const UNMODELLED_RULES_WARNING =
  "This map has rules the editor cannot price: zones, festivals, shared track or region bonuses. "
  + "The official maps with such rules valued tickets at about 1.2–1.5 times the shortest path, so "
  + "expect to raise these by hand after playtesting.";
