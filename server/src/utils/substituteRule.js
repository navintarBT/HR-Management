// Computes what should happen to an employee's default shift-time fields when
// their effective "ມາແທນ" eligibility (Employee.allowsSubstituteStatus, or the
// position's default when unset) flips — used by both routes/employees.js (an
// individual toggle, or being moved into/out of a flagged position) and
// routes/positions.js (a position-wide toggle, applied to everyone inheriting
// it). Returns null when nothing changed.
//
// Turning ON: nothing else keeps a copy of the current shift time once it's
// cleared, so it's snapshotted into the substituteBackup* fields first.
// Turning OFF: restored from that snapshot, then the snapshot is cleared —
// this only affects how NEW scans get judged going forward; already-stored
// AttendanceDaily records for past days are untouched either way.
function computeSubstituteTransitionUpdate(employee, wasEnabled, willBeEnabled) {
  if (wasEnabled === willBeEnabled) return null;

  if (!wasEnabled && willBeEnabled) {
    return {
      substituteBackupShiftCategory: employee.defaultShiftCategory ?? null,
      substituteBackupShiftStart: employee.defaultShiftStart ?? null,
      substituteBackupShiftEnd: employee.defaultShiftEnd ?? null,
      defaultShiftCategory: null,
      defaultShiftStart: null,
      defaultShiftEnd: null,
    };
  }

  return {
    defaultShiftCategory: employee.substituteBackupShiftCategory ?? null,
    defaultShiftStart: employee.substituteBackupShiftStart ?? null,
    defaultShiftEnd: employee.substituteBackupShiftEnd ?? null,
    substituteBackupShiftCategory: null,
    substituteBackupShiftStart: null,
    substituteBackupShiftEnd: null,
  };
}

// Whether someone has a regular shift of their own — a category, or a start
// and end time.
function hasRegularShift(employee) {
  return !!(employee?.defaultShiftCategory || (employee?.defaultShiftStart && employee?.defaultShiftEnd));
}

// Whether the ມາບໍ່ປົກກະຕິ rule applies to this employee (their `position`
// populated, to read its flag): their own setting when they have one,
// otherwise on for a position that has it on — and on for anyone with no
// regular shift at all, who has no schedule to be judged against either
// (asked for 2026-10-28). Covers ສະຫຼຸບເງິນເດືອນ's blank-unless-scanned
// days, marking ມາແທນ, and taking more than one cover a day.
// client/src/utils/substituteRule.ts mirrors this.
function followsIrregularRule(employee) {
  if (employee?.allowsSubstituteStatus === true || employee?.allowsSubstituteStatus === false) return employee.allowsSubstituteStatus;
  const position = employee?.position && typeof employee.position === 'object' ? employee.position : null;
  return position?.allowsSubstituteStatus === true || !hasRegularShift(employee);
}

module.exports = { computeSubstituteTransitionUpdate, hasRegularShift, followsIrregularRule };
