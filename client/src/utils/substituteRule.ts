import type { Employee } from '../types';

// Whether someone has a regular shift of their own — a category, or a start
// and end time.
export function hasRegularShift(emp: Employee): boolean {
  return !!(emp.defaultShiftCategory || (emp.defaultShiftStart && emp.defaultShiftEnd));
}

// Whether the ມາບໍ່ປົກກະຕິ rule applies to this employee: their own setting
// when they have one, otherwise on for a position that has it on — and on for
// anyone with no regular shift at all, who has no schedule to be judged
// against either (asked for 2026-10-28). Mirrors the server's
// utils/substituteRule.js followsIrregularRule.
// Whether this employee's days with no shift run noon to noon (they work
// nights: the DJs) — their own setting, else their position's. Mirrors the
// server's utils/substituteRule.js worksNights.
export function worksNights(emp: Employee): boolean {
  if (emp.worksNights === true || emp.worksNights === false) return emp.worksNights;
  const position = emp.position && typeof emp.position === 'object' ? emp.position : undefined;
  return position?.worksNights === true;
}

export function followsIrregularRule(emp: Employee): boolean {
  if (emp.allowsSubstituteStatus === true || emp.allowsSubstituteStatus === false) return emp.allowsSubstituteStatus;
  const position = emp.position && typeof emp.position === 'object' ? emp.position : undefined;
  return position?.allowsSubstituteStatus === true || !hasRegularShift(emp);
}
