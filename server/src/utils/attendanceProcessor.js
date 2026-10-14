const AttendanceLog = require('../models/AttendanceLog');
const AttendanceDaily = require('../models/AttendanceDaily');
const Shift = require('../models/Shift');
const Employee = require('../models/Employee');
const Leave = require('../models/Leave');

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
  const shift = await Shift.findOne({ employee: employeeId, date: dateKey, status: { $in: ['scheduled', 'swapped'] } }).populate('category');
  if (shift?.status === 'swapped') return null; // no shift at all this day — see positionSwap.js
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
      // Marks that this came from a day-specific override rather than the
      // employee's live default — resolveShiftWindow uses this to know the
      // day is self-contained and doesn't need the "was yesterday overnight"
      // inference (see there for why that inference alone isn't safe here).
      fromOverride: true,
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

  // Skipped when today has its own day-specific override: that override
  // already fully defines today's window on its own terms, and inferring
  // "yesterday" here would mean re-reading the employee's CURRENT live
  // default as if it already applied yesterday too — wrong the moment that
  // default just changed (e.g. a position swap effective today flips it to
  // an overnight category), which would falsely push today's start hours
  // later and swallow a legitimate early check-in (see positionSwap.js).
  if (!expected?.fromOverride) {
    const yesterdayShift = await resolveExpectedShift(employeeId, addDays(dateKey, -1));
    if (isOvernightShift(yesterdayShift)) {
      const yesterdayExpectedEnd = new Date(`${dateKey}T00:00:00`);
      yesterdayExpectedEnd.setHours(yesterdayShift.endHour, yesterdayShift.endMinute, 0, 0);
      const yesterdayCutoff = new Date(yesterdayExpectedEnd.getTime() + OVERNIGHT_BUFFER_HOURS * 3600000);
      if (yesterdayCutoff > windowStart) windowStart = yesterdayCutoff;
    }
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

// The inverse of markAbsent — fills in a day as if the employee worked an
// already-resolved expected shift exactly on time (firstIn/lastOut pinned to
// its own start/end, no lateness, no early-leave, no OT). Takes the resolved
// {startHour, startMinute, endHour, endMinute} directly rather than looking
// it up itself — see bulkMarkPresentForOutage, its only caller, for why.
async function markPresentFromShift(employeeId, dateKey, expected, note) {
  const pad = (n) => String(n).padStart(2, '0');
  const firstIn = new Date(`${dateKey}T${pad(expected.startHour)}:${pad(expected.startMinute)}:00`);
  let lastOut = new Date(`${dateKey}T${pad(expected.endHour)}:${pad(expected.endMinute)}:00`);
  if (isOvernightShift(expected)) lastOut = new Date(lastOut.getTime() + 24 * 3600000);
  const hours = computeExpectedHours(expected);
  return AttendanceDaily.findOneAndUpdate(
    { employee: employeeId, date: dateKey },
    {
      employee: employeeId,
      date: dateKey,
      firstIn,
      lastOut,
      workedHours: hours,
      expectedHours: hours,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      otHours: 0,
      status: 'present',
      autoFilledReason: note,
    },
    { upsert: true, new: true }
  );
}

function timeStringToHM(hhmm) {
  const [hour, minute] = hhmm.split(':').map(Number);
  return { hour, minute };
}

// Admin-triggered bulk backfill across a date range for exactly the scenario
// markAbsentForMissedScans would otherwise misread as a wave of no-shows: the
// scanning system itself was unavailable (outage, server down), not that
// anyone failed to come in. Walks the same skip logic as that sweep —
// already has a record, on approved leave, or the day is a rest day either
// way (a queued Shift override or the recurring weekly default) — but fills
// everyone else toward 'present' instead of 'absent'.
//
// Deliberately does NOT call resolveExpectedShift per employee the way every
// other caller does — at 250+ active employees that's 250+ sequential round
// trips to Atlas (measured: 70-80s for a single day, before this fix).
// Everything resolveExpectedShift would have queried per employee (that
// day's Shift rows, each employee's own defaultShiftCategory) is instead
// fetched once per day / once overall up front, and the same start/end
// precedence — a 'scheduled' Shift wins, else the employee's own recurring
// default — is reapplied in memory against those batched results.
async function bulkMarkPresentForOutage(startDateKey, endDateKey, note) {
  const employees = await Employee.find({ status: 'active' }).populate('defaultShiftCategory');
  const filled = [];
  const skipped = [];

  let dateKey = startDateKey;
  while (dateKey <= endDateKey) {
    const dow = new Date(`${dateKey}T00:00:00`).getDay();
    // eslint-disable-next-line no-await-in-loop
    const [existingDaily, dayShifts, approvedLeaves] = await Promise.all([
      AttendanceDaily.find({ date: dateKey }, 'employee status disciplinaryNote'),
      Shift.find({ date: dateKey, status: { $in: ['scheduled', 'swapped', 'rest'] } }, 'employee status startTime endTime'),
      Leave.find(
        { status: 'approved', startDate: { $lte: new Date(`${dateKey}T23:59:59.999`) }, endDate: { $gte: new Date(`${dateKey}T00:00:00`) } },
        'employee'
      ),
    ]);
    // A plain 'absent' with no disciplinaryNote is never anything but the
    // automatic sweep's own guess (recomputeDay's real-scan path never
    // produces 'absent' — see markAbsentForMissedScans) — and that sweep runs
    // on server startup too, so it will have already "found" a multi-day
    // outage as a wave of no-shows before an admin even gets to this button.
    // That specific case is exactly what this tool exists to correct, so it's
    // the one status this bulk fill is allowed to overwrite; a disciplinary
    // absence (deliberately set) and every other status (a real scan, leave,
    // substituted, ...) still block it completely, same as before.
    const hasDaily = new Set(
      existingDaily.filter((r) => !(r.status === 'absent' && !r.disciplinaryNote)).map((r) => String(r.employee))
    );
    const onLeave = new Set(approvedLeaves.map((l) => String(l.employee)));
    const shiftByEmployee = new Map();
    for (const s of dayShifts) {
      const key = String(s.employee);
      // Same ambiguity resolveExpectedShift itself has if more than one
      // 'scheduled' row exists for one employee/day (e.g. a cover shift
      // alongside their own) — whichever is found first wins either way.
      if (!shiftByEmployee.has(key)) shiftByEmployee.set(key, s);
    }

    const toFill = [];
    for (const employee of employees) {
      const empId = String(employee._id);
      if (hasDaily.has(empId) || onLeave.has(empId)) {
        skipped.push({ employee: empId, date: dateKey });
        continue;
      }
      const shift = shiftByEmployee.get(empId);
      if (shift && (shift.status === 'rest' || shift.status === 'swapped')) {
        skipped.push({ employee: empId, date: dateKey });
        continue;
      }
      if (!shift && (employee.defaultRestDay ?? []).includes(dow)) {
        skipped.push({ employee: empId, date: dateKey });
        continue;
      }

      let start;
      let end;
      if (shift && shift.status === 'scheduled' && shift.startTime && shift.endTime) {
        start = timeStringToHM(shift.startTime);
        end = timeStringToHM(shift.endTime);
      } else {
        const category = employee.defaultShiftCategory;
        if (category && typeof category === 'object' && category.startTime && category.endTime) {
          start = timeStringToHM(category.startTime);
          end = timeStringToHM(category.endTime);
        } else if (employee.defaultShiftStart && employee.defaultShiftEnd) {
          start = timeStringToHM(employee.defaultShiftStart);
          end = timeStringToHM(employee.defaultShiftEnd);
        }
      }
      if (!start || !end) {
        skipped.push({ employee: empId, date: dateKey });
        continue;
      }

      toFill.push({
        empId,
        expected: { startHour: start.hour, startMinute: start.minute, endHour: end.hour, endMinute: end.minute },
      });
    }

    // eslint-disable-next-line no-await-in-loop
    const docs = await Promise.all(toFill.map(({ empId, expected }) => markPresentFromShift(empId, dateKey, expected, note)));
    filled.push(...docs);

    dateKey = addDays(dateKey, 1);
  }
  return { filled, skipped };
}

// Sweeps the last few days for any active employee who never scanned at all
// that day, and has no other explanation on file, then marks it ຂາດວຽກ.
// Nothing else does this automatically — recomputeDay only ever runs off an
// actual incoming scan, so a day with zero scans otherwise sits with no
// AttendanceDaily row at all (shows as a blank "-", not "ຂາດວຽກ") forever.
// Called on a timer from index.js (see runDueScheduledSwaps for the same
// pattern) — checking the last few days rather than just "yesterday" means a
// stretch of server downtime still gets caught up once it's back.
// A day is skipped (left alone) when:
//  - it already has an AttendanceDaily row (a real scan, an existing 'leave'/
//    'substituted' mark, or an earlier absent-sweep already handled it),
//  - an approved Leave covers it,
//  - a Shift override marks it 'rest' or 'swapped', or no override exists but
//    it's the employee's recurring defaultRestDay,
//  - there's no resolvable expected shift at all that day (nothing to be
//    absent FROM — e.g. a ກົດ "ມາແທນ" position with no fixed schedule),
//  - its scan-capture window (resolveShiftWindow, overnight-aware) hasn't
//    closed yet — too early to call it a no-show.
const ABSENT_SWEEP_DAYS_BACK = 4;

async function markAbsentForMissedScans() {
  const now = new Date();
  const employees = await Employee.find({ status: 'active' }, '_id defaultRestDay');
  const marked = [];

  for (let daysAgo = 1; daysAgo <= ABSENT_SWEEP_DAYS_BACK; daysAgo += 1) {
    const dateKey = addDays(toDateKey(now), -daysAgo);
    const dow = new Date(`${dateKey}T00:00:00`).getDay();

    // eslint-disable-next-line no-await-in-loop
    const [existingDaily, overrides, approvedLeaves] = await Promise.all([
      AttendanceDaily.find({ date: dateKey }, 'employee'),
      Shift.find({ date: dateKey }, 'employee status'),
      Leave.find(
        { status: 'approved', startDate: { $lte: new Date(`${dateKey}T23:59:59.999`) }, endDate: { $gte: new Date(`${dateKey}T00:00:00`) } },
        'employee'
      ),
    ]);
    const hasDaily = new Set(existingDaily.map((r) => String(r.employee)));
    const overrideStatusByEmployee = new Map(overrides.map((o) => [String(o.employee), o.status]));
    const onLeave = new Set(approvedLeaves.map((l) => String(l.employee)));

    for (const employee of employees) {
      const empId = String(employee._id);
      if (hasDaily.has(empId) || onLeave.has(empId)) continue;

      const overrideStatus = overrideStatusByEmployee.get(empId);
      if (overrideStatus === 'rest' || overrideStatus === 'swapped') continue;
      if (!overrideStatus && (employee.defaultRestDay ?? []).includes(dow)) continue;

      // eslint-disable-next-line no-await-in-loop
      const { windowEnd, expected } = await resolveShiftWindow(employee._id, dateKey);
      if (!expected || now < windowEnd) continue;

      // eslint-disable-next-line no-await-in-loop
      const doc = await markAbsent(employee._id, dateKey);
      marked.push(doc);
    }
  }

  return marked;
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
  markPresentFromShift,
  bulkMarkPresentForOutage,
  markAbsentForMissedScans,
  markLeave,
  markSubstituted,
  reprocessFromLogs,
  GRACE_MINUTES,
  STANDARD_WORK_HOURS,
};
