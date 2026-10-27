import type { ShiftChangeLogEntry } from '../types';

// Mirrors shiftOnDate in server/src/utils/shiftHistory.js — keep the two in
// step. From one employee's change rows (any order): the regular shift in
// force on dateKey, or null when nothing has changed since that date, meaning
// the employee's current setting applies. Fed by GET /shift-change-logs, which
// returns exactly the rows this needs for the days a page shows.
export function shiftOnDate(logs: ShiftChangeLogEntry[] | undefined, dateKey: string) {
  if (!logs?.length) return null;
  const sorted = [...logs].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  if (dateKey >= sorted[sorted.length - 1].effectiveDate) return null;
  let inForce = sorted[0].previous;
  for (const log of sorted) {
    if (log.effectiveDate > dateKey) break;
    inForce = log.next;
  }
  return inForce ?? { category: null, startTime: null, endTime: null };
}

export function groupLogsByEmployee(logs: ShiftChangeLogEntry[] | undefined) {
  const map = new Map<string, ShiftChangeLogEntry[]>();
  for (const log of logs ?? []) {
    const key = String(log.employee);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(log);
  }
  return map;
}
