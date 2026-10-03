// A reminder to export. The map lives only in this browser, which can lose it (Safari clears a site's
// storage after a week without a visit), so after a while of work without an export the editor says
// so. Work is counted in actions, not keystrokes: changes less than a moment apart are one action.
// "Later" waits as long again; "less often" waits longer each time, and at the longest offers to
// stop. Kept in this browser only, never in the map file.

export const EXPORT_REMINDER_KEY = "ttr-export-reminder";
/** Changes between reminders, step by step as the person asks for fewer. */
export const REMINDER_STEPS = [40, 120, 300];
/** Changes closer together than this are one action: a burst of typing, a drag, a whole deck built. */
export const ACTION_GAP_MS = 1500;

export type ExportReminder = { changes: number; nextAt: number; level: number; off: boolean; lastExport: string | null };
export const freshReminder = (): ExportReminder => ({ changes: 0, nextAt: REMINDER_STEPS[0], level: 0, off: false, lastExport: null });

export function readReminder(raw: string | null): ExportReminder {
  try {
    const value = JSON.parse(raw ?? "null") as Partial<ExportReminder> | null;
    if (!value) return freshReminder();
    const level = Math.min(REMINDER_STEPS.length - 1, Math.max(0, Math.round(Number(value.level) || 0)));
    const changes = Math.max(0, Math.round(Number(value.changes) || 0));
    return { changes, level, off: value.off === true, lastExport: typeof value.lastExport === "string" ? value.lastExport : null,
      nextAt: Number.isFinite(Number(value.nextAt)) ? Number(value.nextAt) : changes + REMINDER_STEPS[level] };
  } catch {
    return freshReminder();
  }
}

export const isDue = (r: ExportReminder) => !r.off && r.changes >= r.nextAt;
export const isLastStep = (r: ExportReminder) => r.level >= REMINDER_STEPS.length - 1;
export const countChange = (r: ExportReminder): ExportReminder => ({ ...r, changes: r.changes + 1 });
export const later = (r: ExportReminder): ExportReminder => ({ ...r, nextAt: r.changes + REMINDER_STEPS[r.level] });
export const lessOften = (r: ExportReminder): ExportReminder => { const level = Math.min(r.level + 1, REMINDER_STEPS.length - 1); return { ...r, level, nextAt: r.changes + REMINDER_STEPS[level] }; };
export const stop = (r: ExportReminder): ExportReminder => ({ ...r, off: true });
export const turnOn = (r: ExportReminder): ExportReminder => ({ ...r, off: false, level: 0, nextAt: r.changes + REMINDER_STEPS[0] });
/** A full map exported, or a full map file opened: the work is in a file, so counting starts again. */
export const exported = (r: ExportReminder, now: Date): ExportReminder => ({ ...r, changes: 0, nextAt: REMINDER_STEPS[r.level], lastExport: now.toISOString() });

/** "not exported yet", "exported just now", "exported 5 minutes ago", "exported 2 days ago". */
export function exportAge(lastExport: string | null, now: Date): string {
  if (!lastExport) return "not exported yet";
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(lastExport)) / 60000));
  if (minutes < 1) return "exported just now";
  if (minutes < 60) return `exported ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `exported ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `exported ${days} day${days === 1 ? "" : "s"} ago`;
}
