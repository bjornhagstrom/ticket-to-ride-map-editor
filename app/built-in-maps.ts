// Is the map on the screen one of the editor's own, unchanged: the empty map, the example, or the example with problems? Then nothing is lost by replacing it, and no question is asked.
import { emptyMap, initialMap, problemMap, type MapData } from "./map-data";
import { normalizeMap } from "./map-storage";
import { fingerprint } from "./map-version";

let known: Set<string> | null = null;
const knownFingerprints = (): Set<string> => (known ??= new Set([emptyMap, initialMap, problemMap].map((map) => fingerprint(normalizeMap(JSON.parse(JSON.stringify(map)))))));

/** True for a map that is exactly one of the editor's own, whatever has been done to it and undone again. */
export function isUnchangedBuiltIn(data: MapData): boolean {
  return knownFingerprints().has(fingerprint(normalizeMap(JSON.parse(JSON.stringify(data)))));
}
