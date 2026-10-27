import type { RestDayScheduleRow } from '../types';

// Same value as FROM_THE_START in server/src/utils/restDaySchedule.js — the
// effectiveDate of a row that set someone's rest day up before changes had
// dates, so it applies to every earlier day. Shown as words, never as a date.
export const REST_DAY_FROM_THE_START = '0000-01-01';

// Mirrors restDaysOn in server/src/utils/restDaySchedule.js — keep the two in
// step. Which weekdays someone rests on as of dateKey, from their rest-day
// changes (GET /rest-day-history/schedule returns exactly the rows needed for
// the range a page shows). No rows: `fallback` — their Employee.defaultRestDay,
// what applies today — holds for every date. Reading defaultRestDay directly,
// as the pages used to, re-read every earlier day as the new rest day the
// moment it changed.
export function restDaysOn(rows: RestDayScheduleRow[] | undefined, fallback: number[] | null | undefined, dateKey: string): number[] {
  if (!rows?.length) return fallback ?? [];
  const sorted = [...rows].sort(
    (a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  let inForce: number[] | null = null;
  for (const row of sorted) {
    if (row.effectiveDate > dateKey) break;
    inForce = row.newRestDay;
  }
  return inForce ?? sorted[0].previousRestDay ?? [];
}

export function groupRestRowsByEmployee(rows: RestDayScheduleRow[] | undefined) {
  const map = new Map<string, RestDayScheduleRow[]>();
  for (const row of rows ?? []) {
    if (!map.has(row.employee)) map.set(row.employee, []);
    map.get(row.employee)!.push(row);
  }
  return map;
}
