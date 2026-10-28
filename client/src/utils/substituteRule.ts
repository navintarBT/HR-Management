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
export function followsIrregularRule(emp: Employee): boolean {
  if (emp.allowsSubstituteStatus === true || emp.allowsSubstituteStatus === false) return emp.allowsSubstituteStatus;
  const position = emp.position && typeof emp.position === 'object' ? emp.position : undefined;
  return position?.allowsSubstituteStatus === true || !hasRegularShift(emp);
}
