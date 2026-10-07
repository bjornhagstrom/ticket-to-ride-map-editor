// Tickets of the decks that stay when an import replaces the stops (docs/CSV.md, "Tickets to stops that
// changed"). A ticket end is fine when its stop is still there under the same id and the same name. Any other
// end is flagged, grouped by the old stop, so that the person decides once per stop: which new stop it is, or
// that the tickets to it go. Pure, so tests/ticket-rebind.cjs can hold it to account.
import type { Stop, Ticket } from "./map-data";

export type RebindGroup = {
  oldId: string;
  oldName: string;
  // "missing": no stop has that id any more. "changed": the id is there but now belongs to a stop with another name.
  status: "missing" | "changed";
  newName?: string;
  // How many tickets name the old stop (a ticket with both ends flagged counts under each).
  tickets: number;
  // The one new stop that has the old name; null when none has it, or when more than one does.
  suggested: string | null;
};

// Which stops a map has, for noticing that the stops changed while a question about them was open.
export const stopKeyOf = (stops: Stop[]) => stops.map((stop) => stop.id).join("\u0000");

const same = (a: string, b: string) => a.trim().normalize("NFC").toLowerCase() === b.trim().normalize("NFC").toLowerCase();

export function planRebind(before: Stop[], after: Stop[], tickets: Ticket[]): RebindGroup[] {
  const oldById = new Map(before.map((stop) => [stop.id, stop]));
  const newById = new Map(after.map((stop) => [stop.id, stop]));
  const groups = new Map<string, RebindGroup>();
  for (const ticket of tickets) {
    for (const id of new Set([ticket.a, ticket.b])) {
      const old = oldById.get(id), now = newById.get(id);
      if (old && now && same(old.name, now.name)) continue;
      let group = groups.get(id);
      if (!group) {
        const oldName = old?.name ?? id;
        const named = after.filter((stop) => stop.id !== id && same(stop.name, oldName));
        group = { oldId: id, oldName, status: now ? "changed" : "missing", ...(now ? { newName: now.name } : {}), tickets: 0, suggested: named.length === 1 ? named[0].id : null };
        groups.set(id, group);
      }
      group.tickets += 1;
    }
  }
  return [...groups.values()].sort((x, y) => y.tickets - x.tickets || x.oldName.localeCompare(y.oldName));
}

// The tickets after the choices: a stop sent to a new stop takes its tickets along, a stop sent to null
// loses them, and a ticket that would run from a stop to itself goes too. Not changed in place.
export function applyRebind(tickets: Ticket[], choices: Map<string, string | null>): { tickets: Ticket[]; moved: number; removed: number } {
  const kept: Ticket[] = [];
  let moved = 0, removed = 0;
  for (const ticket of tickets) {
    const a = choices.has(ticket.a) ? choices.get(ticket.a) : ticket.a;
    const b = choices.has(ticket.b) ? choices.get(ticket.b) : ticket.b;
    if (!a || !b || a === b) { removed += 1; continue; }
    if (a !== ticket.a || b !== ticket.b) { moved += 1; kept.push({ ...ticket, a, b }); } else kept.push(ticket);
  }
  return { tickets: kept, moved, removed };
}
