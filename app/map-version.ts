// The map's version: one series of numbers for every way a map leaves the editor — printed, exported
// as a file, saved as an image. A print or export of a map that has not changed since the last one
// keeps its number; one that has changed gets the next. Printed on every sheet, card and rules page,
// so the sheets from several playtests can be told apart. Stored in the map file as `mapVersion`
// (docs/FILE-FORMAT.md); tests/map-version.cjs holds the rules.
import { boardOf } from "./board";
import { PLAYTEST_MARGIN, PLAYTEST_SIZE, PLAYTEST_TEXT, type MapData, type MapVersion, type NoteBox } from "./map-data";

export type VersionBy = "print" | "export" | "image";

// Content as a stable string: keys sorted, so the order fields happen to be in does not count, and
// very long strings (a background image) stood in for by their length and ends, so the fingerprint
// stays cheap enough to work out as a stop is dragged.
const canonical = (value: unknown): string => {
  if (typeof value === "string") return JSON.stringify(value.length > 4096 ? `${value.length}:${value.slice(0, 512)}:${value.slice(-512)}` : value);
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : canonical(item))).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
};

/** A short fingerprint of everything the map file holds, the version record itself left out. */
export function fingerprint(data: MapData): string {
  const { mapVersion, unknown, ...rest } = data;
  void mapVersion;
  const text = canonical({ ...rest, ...(unknown ?? {}) });
  // FNV-1a, 32 bits: not for security, only to see whether anything changed.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, "0");
}

export type VersionStatus = { number?: number; changed: boolean; next: number; date?: string };

/** The number the map has, whether it has changed since, and the number the next print or export gets. */
export function versionStatus(data: MapData): VersionStatus {
  const record = data.mapVersion;
  if (!record) return { changed: true, next: 1 };
  const changed = fingerprint(data) !== record.fingerprint;
  const date = [...record.issued].reverse().find((entry) => entry.number === record.number)?.date;
  return { number: record.number, changed, next: changed ? record.number + 1 : record.number, date };
}

/** The number for a print or export now: the same one if nothing changed, the next one if it did. */
export function issueVersion(data: MapData, by: VersionBy, date: Date): { data: MapData; number: number; bumped: boolean } {
  const print = fingerprint(data);
  const record = data.mapVersion;
  if (record && record.fingerprint === print) return { data, number: record.number, bumped: false };
  const number = (record?.number ?? 0) + 1;
  const mapVersion: MapVersion = { ...(record ?? {}), number, fingerprint: print, issued: [...(record?.issued ?? []), { number, date: date.toISOString(), by }] };
  return { data: { ...data, mapVersion }, number, bumped: true };
}

/** "4 Oct 2026", the way the version's date is printed. */
export const versionDate = (iso?: string): string => {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
};

/** "Version 8 · 4 Oct 2026", or "Version 8" when the date is not known. */
export const versionLabel = (status: Pick<VersionStatus, "number" | "date">): string => status.number ? [`Version ${status.number}`, versionDate(status.date)].filter(Boolean).join(" · ") : "";

/** A copy of the same map with a lower number than the one it replaces: its next print would repeat
 *  numbers already on paper. Says so, and suggests a new name. Null when there is nothing to warn of. */
export function olderCopyWarning(current: Pick<MapData, "name" | "mapVersion">, incoming: Pick<MapData, "name" | "mapVersion">): string | null {
  const now = current.mapVersion?.number, then = incoming.mapVersion?.number;
  if (!now || !then || then >= now) return null;
  if (current.name.trim().toLowerCase() !== incoming.name.trim().toLowerCase()) return null;
  return `This copy of “${incoming.name}” is version ${then}, older than version ${now} that it replaces, so its next print would repeat a number already on paper. Give it a new name, such as “${incoming.name} (from v${then})”, to keep the two apart.`;
}

export { PLAYTEST_TEXT };

/** A playtest box: in the top right corner, the owner's choice, unless that covers a stop, a route or
 *  a note; then where it covers least. */
export function playtestNote(data: MapData): NoteBox {
  const board = boardOf(data);
  const { width, height } = PLAYTEST_SIZE;
  const margin = PLAYTEST_MARGIN;
  const xs = [board.width - width - margin, margin, (board.width - width) / 2];
  const ys = [margin, board.height - height - margin, (board.height - height) / 2];
  const stops = new Map(data.stops.map((stop) => [stop.id, stop]));
  // Points along every route, through its bends, to count what a box would cover.
  const samples = data.routes.flatMap((route) => {
    const a = stops.get(route.a), b = stops.get(route.b);
    if (!a || !b) return [];
    const path = [a, ...(route.points ?? []), b];
    return path.slice(1).flatMap((end, i) => Array.from({ length: 8 }, (_, step) => ({ x: path[i].x + (end.x - path[i].x) * step / 8, y: path[i].y + (end.y - path[i].y) * step / 8 })));
  });
  let best = { x: xs[0], y: ys[0], score: Infinity };
  for (const y of ys) for (const x of xs) {
    const near = (p: { x: number; y: number }, pad: number) => p.x >= x - pad && p.x <= x + width + pad && p.y >= y - pad && p.y <= y + height + pad;
    const overNote = data.notes.some((note) => note.x < x + width && x < note.x + note.width && note.y < y + height && y < note.y + note.height);
    // A background shape's name (where it is drawn, or its middle) counts like a stop; its area a little.
    const overShapes = data.background.reduce((sum, shape) => {
      if (!shape.points.length) return sum;
      const middle = shape.labelPoint ?? { x: shape.points.reduce((t, p) => t + p.x, 0) / shape.points.length, y: shape.points.reduce((t, p) => t + p.y, 0) / shape.points.length };
      const xs2 = shape.points.map((p) => p.x), ys2 = shape.points.map((p) => p.y);
      const overlaps = Math.min(...xs2) < x + width && x < Math.max(...xs2) && Math.min(...ys2) < y + height && y < Math.max(...ys2);
      return sum + (shape.label && near(middle, 40) ? 10 : 0) + (overlaps ? 3 : 0);
    }, 0);
    const score = (overNote ? 1000 : 0) + data.stops.filter((stop) => near(stop, 24)).length * 10 + samples.filter((p) => near(p, 6)).length + overShapes;
    if (score < best.score) best = { x, y, score };
  }
  return { id: `playtest-${Date.now().toString(36)}`, kind: "playtest", x: Math.round(best.x), y: Math.round(best.y), width, height, text: PLAYTEST_TEXT };
}
