import type { Employee, ShiftChangeLogEntry } from '../types';

// Someone's regular shift as it stands today — just the hours, from their
// category or a time set by hand; null when neither is set.
export function regularShiftHours(emp: Employee): string | null {
  const category = emp.defaultShiftCategory;
  if (category && typeof category === 'object') return `${category.startTime}-${category.endTime}`;
  if (emp.defaultShiftStart && emp.defaultShiftEnd) return `${emp.defaultShiftStart}-${emp.defaultShiftEnd}`;
  return null;
}

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
