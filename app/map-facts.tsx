import { Badge } from "@/components/ui/badge";
import type { MapData } from "./map-data";
import { plural } from "./plural";
import { versionLabel, type VersionStatus } from "./map-version";

// The small boxes with the facts of the map: its board, how many stops, routes, tickets, background objects and notes, and which version
// of it a print or an export now would be. Over the map's top edge on a wide screen; in a row of their own under the header on a phone.
export function MapFacts({ data, format, version, ticketCount, ticketCountLabel, setLabel }: { data: MapData; format: { label: string; widthMm: number; heightMm: number }; version: VersionStatus; ticketCount: number | string; ticketCountLabel: string; setLabel: string }) {
  return <><Badge variant="secondary">{format.label}</Badge><Badge variant="secondary">{format.widthMm.toLocaleString("en-GB")} × {format.heightMm.toLocaleString("en-GB")} mm</Badge><Badge variant="secondary">{plural(data.stops.length, "stop")}</Badge><Badge variant="secondary">{plural(data.routes.length, "route")}</Badge>{version.number !== undefined && <Badge variant="secondary" className="map-version" title={version.changed ? `${versionLabel(version)}. Changed since: the next print or export will be version ${version.next}.` : `${versionLabel(version)}. Unchanged since: a print or export now is version ${version.number} too.`}>Version {version.number}{version.changed ? " · changed" : ""}</Badge>}<Badge variant="secondary" className="ticket-count" title={`${ticketCount} in ${setLabel}`}>{ticketCountLabel}</Badge><Badge variant="secondary">{plural(data.background.length, "background object")}</Badge>{data.notes.length > 0 && <Badge variant="secondary">{plural(data.notes.length, "note")}</Badge>}<Badge variant="outline" className="map-status-note">Everything is stored in the exported map file</Badge></>;
}
