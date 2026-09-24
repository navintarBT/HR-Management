const AttendanceLog = require('../models/AttendanceLog');
const AttendanceDaily = require('../models/AttendanceDaily');
const Shift = require('../models/Shift');
const Employee = require('../models/Employee');

const GRACE_MINUTES = 15;
const SEVERE_LATE_MINUTES = 60;
const STANDARD_WORK_HOURS = 8;
// How long after the expected shift end a scan-out still counts as part of
// that same overnight shift (covers reasonable OT/cleanup) before it's
// instead treated as the start of a new shift-day.
const OVERNIGHT_BUFFER_HOURS = 3;

function toDateKey(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayRange(dateKey) {
  const start = new Date(`${dateKey}T00:00:00`);
  const end = new Date(`${dateKey}T23:59:59.999`);
  return { start, end };
}

function addDays(dateKey, days) {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

// Length of the expected shift itself, in hours — independent of whether the
// employee actually worked it. Returns 0 when there's no resolvable shift.
function computeExpectedHours(expected) {
  if (!expected) return 0;
  const startMinutes = expected.startHour * 60 + expected.startMinute;
  let endMinutes = expected.endHour * 60 + expected.endMinute;
  if (endMinutes <= startMinutes) endMinutes += 24 * 60; // overnight shift
  return Math.round(((endMinutes - startMinutes) / 60) * 100) / 100;
}

function isOvernightShift(expected) {
  return (
    !!expected &&
    (expected.endHour < expected.startHour || (expected.endHour === expected.startHour && expected.endMinute < expected.startMinute))
  );
}

// Resolves what shift this employee is expected to work on this day — both
// ends of it, and the late-arrival policy to judge the start against. A
// day-specific Shift row (bulk schedule, a position swap, standing in for
// someone else) always wins when one exists; otherwise falls back to the
// employee's own recurring shift — the same default ຕາຕະລາງວັນພັກ itself
// falls back to when rendering a day with no override (see monthly.tsx's
// computeCell). Returns null when an employee has neither (e.g. DJ/housekeeper
// positions whose hours genuinely vary day to day and so can never have one
// fixed default) — there is then nothing legitimate to judge lateness or
// early-leaving against, so recomputeDay just records the scan instead of
// guessing against the fixed office-hours default.
async function resolveExpectedShift(employeeId, dateKey) {
  const shift = await Shift.findOne({ employee: employeeId, date: dateKey, status: 'scheduled' }).populate('category');
  if (shift) {
    const [startHour, startMinute] = shift.startTime.split(':').map(Number);
    const [endHour, endMinute] = shift.endTime.split(':').map(Number);
    return {
      startHour,
      startMinute,
      endHour,
      endMinute,
      graceMinutes: shift.category?.graceMinutes ?? GRACE_MINUTES,
      autoAbsentMinutes: shift.category?.autoAbsentMinutes ?? null,
      severeLateMinutes: shift.category?.severeLateMinutes ?? SEVERE_LATE_MINUTES,
    };
  }

  const employee = await Employee.findById(employeeId).populate('defaultShiftCategory');
  const category = employee?.defaultShiftCategory;
  if (category) {
    const [startHour, startMinute] = category.startTime.split(':').map(Number);
    const [endHour, endMinute] = category.endTime.split(':').map(Number);
    return {
      startHour,
      startMinute,
      endHour,
      endMinute,
      graceMinutes: category.graceMinutes ?? GRACE_MINUTES,
      autoAbsentMinutes: category.autoAbsentMinutes ?? null,
      severeLateMinutes: category.severeLateMinutes ?? SEVERE_LATE_MINUTES,
    };
  }
  if (employee?.defaultShiftStart && employee?.defaultShiftEnd) {
    const [startHour, startMinute] = employee.defaultShiftStart.split(':').map(Number);
    const [endHour, endMinute] = employee.defaultShiftEnd.split(':').map(Number);
    return { startHour, startMinute, endHour, endMinute, graceMinutes: GRACE_MINUTES, autoAbsentMinutes: null, severeLateMinutes: SEVERE_LATE_MINUTES };
  }

  return null;
}

// The actual scan window for shift-day `dateKey` — widened past plain
// calendar-day midnight-to-midnight on both ends when needed:
//  - end: if `dateKey`'s own shift is overnight, extended to catch its
//    scan-out on the next calendar date (plus a grace buffer for OT/cleanup).
//  - start: if the day BEFORE `dateKey` was itself an overnight shift, its
//    window already claims everything up to its own cutoff — `dateKey` must
//    not start any earlier than that, or the same scan gets picked up by
//    both days (double-counted into two different AttendanceDaily records).
// Only employees with a resolvable shift are affected at all; DJ/no-fixed-
// schedule positions keep the exact plain calendar-day behavior this system
// always had, since there's no schedule to reason about the overlap with.
async function resolveShiftWindow(employeeId, dateKey) {
  const expected = await resolveExpectedShift(employeeId, dateKey);
  const overnight = isOvernightShift(expected);

  let windowStart = new Date(`${dateKey}T00:00:00`);
  let windowEnd = overnight ? null : new Date(`${dateKey}T23:59:59.999`);

  if (overnight) {
    windowEnd = new Date(`${dateKey}T00:00:00`);
    windowEnd.setDate(windowEnd.getDate() + 1);
    windowEnd.setHours(expected.endHour, expected.endMinute, 0, 0);
    windowEnd = new Date(windowEnd.getTime() + OVERNIGHT_BUFFER_HOURS * 3600000);
  }

  const yesterdayShift = await resolveExpectedShift(employeeId, addDays(dateKey, -1));
  if (isOvernightShift(yesterdayShift)) {
    const yesterdayExpectedEnd = new Date(`${dateKey}T00:00:00`);
    yesterdayExpectedEnd.setHours(yesterdayShift.endHour, yesterdayShift.endMinute, 0, 0);
    const yesterdayCutoff = new Date(yesterdayExpectedEnd.getTime() + OVERNIGHT_BUFFER_HOURS * 3600000);
    if (yesterdayCutoff > windowStart) windowStart = yesterdayCutoff;
  }

  return { windowStart, windowEnd, expected, overnight };
}

// Given a raw scan's own timestamp, decides which shift-day (AttendanceDaily
// key) it belongs to. Plain calendar-day grouping (00:00-23:59) breaks an
// overnight shift's scan-out — e.g. clock in 22:00 on the 24th, clock out
// 02:30 on the 25th — into two orphaned "incomplete" records instead of one
// real shift.
async function resolveShiftDateKey(employeeId, timestamp) {
  const todayKey = toDateKey(timestamp);
  const yesterdayKey = addDays(todayKey, -1);
  const { windowEnd } = await resolveShiftWindow(employeeId, yesterdayKey);
  if (windowEnd && timestamp <= windowEnd) return yesterdayKey;
  return todayKey;
}

// Recomputes the daily aggregate for one employee on one day from raw logs.
async function recomputeDay(employeeId, dateKey) {
  const { windowStart, windowEnd, expected, overnight } = await resolveShiftWindow(employeeId, dateKey);

  const logs = await AttendanceLog.find({
    employee: employeeId,
    timestamp: { $gte: windowStart, $lte: windowEnd },
  }).sort('timestamp');

  if (!logs.length) return null;

  const firstIn = logs[0].timestamp;
  const lastOut = logs.length > 1 ? logs[logs.length - 1].timestamp : null;

  let lateMinutes = 0;
  let earlyLeaveMinutes = 0;
  let autoAbsentMinutes = null;
  if (expected) {
    // Measured from the exact shift start — graceMinutes no longer shifts
    // this threshold (and so no longer keeps a slightly-late scan classified
    // as "present"); it now only sizes the "ຊ້າ" vs "ຊ້າເກີນ X ນາທີ" label
    // tiers on the attendance-log UI, against the raw minutes here.
    const standardStart = new Date(`${dateKey}T00:00:00`);
    standardStart.setHours(expected.startHour, expected.startMinute, 0, 0);
    lateMinutes = firstIn > standardStart ? Math.round((firstIn - standardStart) / 60000) : 0;
    autoAbsentMinutes = expected.autoAbsentMinutes;

    if (lastOut) {
      const standardEnd = new Date(`${dateKey}T00:00:00`);
      standardEnd.setHours(expected.endHour, expected.endMinute, 0, 0);
      if (overnight) standardEnd.setDate(standardEnd.getDate() + 1);
      earlyLeaveMinutes = lastOut < standardEnd ? Math.round((standardEnd - lastOut) / 60000) : 0;
    }
  }

  const workedHours = lastOut ? Math.round(((lastOut - firstIn) / 3600000) * 100) / 100 : 0;
  const otHours = workedHours > STANDARD_WORK_HOURS
    ? Math.round((workedHours - STANDARD_WORK_HOURS) * 100) / 100
    : 0;
  const expectedHours = computeExpectedHours(expected);

  const status = !lastOut
    ? 'incomplete'
    : autoAbsentMinutes != null && lateMinutes > autoAbsentMinutes
      ? 'absent'
      : lateMinutes > 0
        ? 'late'
        : 'present';

  return AttendanceDaily.findOneAndUpdate(
    { employee: employeeId, date: dateKey },
    {
      employee: employeeId,
      date: dateKey,
      firstIn,
      lastOut,
      workedHours,
      expectedHours,
      lateMinutes,
      graceMinutes: expected?.graceMinutes ?? null,
      severeLateMinutes: expected?.severeLateMinutes ?? null,
      earlyLeaveMinutes,
      otHours,
      status,
    },
    { upsert: true, new: true }
  );
}

async function markAbsent(employeeId, dateKey) {
  const expected = await resolveExpectedShift(employeeId, dateKey);
  return AttendanceDaily.findOneAndUpdate(
    { employee: employeeId, date: dateKey },
    {
      employee: employeeId,
      date: dateKey,
      firstIn: null,
      lastOut: null,
      workedHours: 0,
      expectedHours: computeExpectedHours(expected),
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      otHours: 0,
      status: 'absent',
    },
    { upsert: true, new: true }
  );
}

async function markLeave(employeeId, dateKey) {
  const expected = await resolveExpectedShift(employeeId, dateKey);
  return AttendanceDaily.findOneAndUpdate(
    { employee: employeeId, date: dateKey },
    {
      employee: employeeId,
      date: dateKey,
      firstIn: null,
      lastOut: null,
      workedHours: 0,
      expectedHours: computeExpectedHours(expected),
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      otHours: 0,
      status: 'leave',
    },
    { upsert: true, new: true }
  );
}

// The position-eligibility check (Position.allowsSubstituteStatus) lives in
// the route, not here — this just writes the resulting state.
async function markSubstituted(employeeId, dateKey) {
  const expected = await resolveExpectedShift(employeeId, dateKey);
  return AttendanceDaily.findOneAndUpdate(
    { employee: employeeId, date: dateKey },
    {
      employee: employeeId,
      date: dateKey,
      firstIn: null,
      lastOut: null,
      workedHours: 0,
      expectedHours: computeExpectedHours(expected),
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      otHours: 0,
      status: 'substituted',
    },
    { upsert: true, new: true }
  );
}

// Re-derives daily aggregates from every raw log matching the given filter.
// Groups by each log's *resolved* shift-day (see resolveShiftDateKey), not
// its raw calendar date, so an overnight shift's scan-out doesn't produce a
// spurious extra (employee, next-day) pair alongside the real one.
async function reprocessFromLogs({ employeeId, dateKey } = {}) {
  const match = {};
  if (employeeId) match.employee = employeeId;
  if (dateKey) {
    const { start, end } = dayRange(dateKey);
    match.timestamp = { $gte: start, $lte: end };
  }

  const logs = await AttendanceLog.find(match, 'employee timestamp');

  const pairKeys = new Set();
  for (const log of logs) {
    if (!log.employee) continue;
    const shiftDateKey = await resolveShiftDateKey(log.employee, log.timestamp);
    pairKeys.add(`${log.employee}_${shiftDateKey}`);
  }

  const results = [];
  for (const key of pairKeys) {
    const [employee, dateKeyForPair] = key.split('_');
    const doc = await recomputeDay(employee, dateKeyForPair);
    if (doc) results.push(doc);
  }
  return results;
}

module.exports = {
  toDateKey,
  dayRange,
  resolveShiftDateKey,
  resolveExpectedShift,
  resolveShiftWindow,
  isOvernightShift,
  recomputeDay,
  markAbsent,
  markLeave,
  markSubstituted,
  reprocessFromLogs,
  GRACE_MINUTES,
  STANDARD_WORK_HOURS,
};
