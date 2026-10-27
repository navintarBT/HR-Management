const AttendanceLog = require('../models/AttendanceLog');
const AttendanceDaily = require('../models/AttendanceDaily');
const Shift = require('../models/Shift');
const Employee = require('../models/Employee');
const Leave = require('../models/Leave');
const ShiftCategory = require('../models/ShiftCategory');
const ShiftChangeLog = require('../models/ShiftChangeLog');
const { shiftOnDate, shiftLogsFor } = require('./shiftHistory');
const { severityFieldsForAbsence, CLEARED_SEVERITY } = require('./absenceSeverity');
const { restDaysOn, restDaysOnFor, loadRestDaySchedules } = require('./restDaySchedule');

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
      // employee's regular shift — resolveShiftWindow uses this to keep a
      // back-to-back day's own check-in inside its window (see there).
      fromOverride: true,
    };
  }

  // A day before the latest change to their regular shift is judged by the
  // regular shift they had on that day, not today's — see
  // models/ShiftChangeLog.js.
  const historical = shiftOnDate(await shiftLogsFor(employeeId), dateKey);
  if (historical) {
    if (!historical.startTime || !historical.endTime) return null;
    const category = historical.category ? await ShiftCategory.findById(historical.category) : null;
    const [startHour, startMinute] = historical.startTime.split(':').map(Number);
    const [endHour, endMinute] = historical.endTime.split(':').map(Number);
    return {
      startHour,
      startMinute,
      endHour,
      endMinute,
      graceMinutes: category?.graceMinutes ?? GRACE_MINUTES,
      autoAbsentMinutes: category?.autoAbsentMinutes ?? null,
      severeLateMinutes: category?.severeLateMinutes ?? SEVERE_LATE_MINUTES,
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

// One person can end up with more than one Shift row on the same date (a
// cover on top of their own override, an old 'cancelled' row) — every caller
// that looks at a day's rows picks the same one: a working shift wins over a
// swapped-blank day, which wins over a rest day, and 'cancelled' never counts.
// Same order resolveExpectedShift and ສະຫຼຸບເງິນເດືອນ already follow.
const OVERRIDE_PRECEDENCE = ['scheduled', 'swapped', 'rest'];
function pickDayOverride(rows) {
  let best = null;
  for (const row of rows ?? []) {
    const rank = OVERRIDE_PRECEDENCE.indexOf(row.status);
    if (rank === -1) continue;
    if (!best || rank < OVERRIDE_PRECEDENCE.indexOf(best.status)) best = row;
  }
  return best;
}

function groupByEmployee(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = String(row.employee);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

// Called only for a day with no 'scheduled'/'swapped' Shift row of its own.
// The recurring rest day is the one in force on dateKey (restDaySchedule.js),
// not today's.
async function isRestDay(employeeId, dateKey) {
  if (await Shift.exists({ employee: employeeId, date: dateKey, status: 'rest' })) return true;
  return (await restDaysOnFor(employeeId, dateKey)).includes(new Date(`${dateKey}T00:00:00`).getDay());
}

// A rest day only behaves like their regular overnight shift if they actually
// came in for it that evening — people do work rest days without a planner
// entry (about 1 scanned day in 11), so it can't simply count as "no shift".
// Left unworked, it has no night to run past midnight, and the next morning's
// scans belong to the next day (e.g. the first day shift after a night→day
// move with a rest day in between).
async function isUnworkedRestNight(employeeId, dateKey, shift) {
  if (!isOvernightShift(shift) || shift.fromOverride) return false;
  if (!(await isRestDay(employeeId, dateKey))) return false;
  const start = new Date(`${dateKey}T00:00:00`);
  start.setHours(shift.startHour, shift.startMinute, 0, 0);
  const evening = new Date(start.getTime() - OVERNIGHT_BUFFER_HOURS * 3600000);
  const midnight = new Date(`${dateKey}T23:59:59.999`);
  return !(await AttendanceLog.exists({ employee: employeeId, timestamp: { $gte: evening, $lte: midnight } }));
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
  let expected = await resolveExpectedShift(employeeId, dateKey);
  if (await isUnworkedRestNight(employeeId, dateKey, expected)) expected = null;
  const overnight = isOvernightShift(expected);

  let windowStart = new Date(`${dateKey}T00:00:00`);
  let windowEnd = overnight ? null : new Date(`${dateKey}T23:59:59.999`);

  if (overnight) {
    windowEnd = new Date(`${dateKey}T00:00:00`);
    windowEnd.setDate(windowEnd.getDate() + 1);
    windowEnd.setHours(expected.endHour, expected.endMinute, 0, 0);
    windowEnd = new Date(windowEnd.getTime() + OVERNIGHT_BUFFER_HOURS * 3600000);
  }

  // "Yesterday" is resolved as the shift it really was (a Shift row, or the
  // regular shift in force then — utils/shiftHistory.js), so this holds even
  // on the day a schedule changes. A day with its own Shift row can follow a
  // night back to back (standing in for someone, the first day of a new
  // schedule) — its window then never starts later than 3 hours before its
  // own start, so that morning's check-in isn't swallowed by last night.
  const yesterdayKey = addDays(dateKey, -1);
  let yesterdayShift = await resolveExpectedShift(employeeId, yesterdayKey);
  if (await isUnworkedRestNight(employeeId, yesterdayKey, yesterdayShift)) yesterdayShift = null;
  if (isOvernightShift(yesterdayShift)) {
    const yesterdayExpectedEnd = new Date(`${dateKey}T00:00:00`);
    yesterdayExpectedEnd.setHours(yesterdayShift.endHour, yesterdayShift.endMinute, 0, 0);
    let yesterdayCutoff = new Date(yesterdayExpectedEnd.getTime() + OVERNIGHT_BUFFER_HOURS * 3600000);
    if (expected?.fromOverride) {
      const todayStart = new Date(`${dateKey}T00:00:00`);
      todayStart.setHours(expected.startHour, expected.startMinute, 0, 0);
      const latestStart = new Date(todayStart.getTime() - OVERNIGHT_BUFFER_HOURS * 3600000);
      if (latestStart < yesterdayCutoff) yesterdayCutoff = latestStart;
    }
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

  let firstIn = logs[0].timestamp;
  let lastOut = logs.length > 1 ? logs[logs.length - 1].timestamp : null;

  let standardStart = null;
  let standardEnd = null;
  if (expected) {
    standardStart = new Date(`${dateKey}T00:00:00`);
    standardStart.setHours(expected.startHour, expected.startMinute, 0, 0);
    standardEnd = new Date(`${dateKey}T00:00:00`);
    standardEnd.setHours(expected.endHour, expected.endMinute, 0, 0);
    if (overnight) standardEnd.setDate(standardEnd.getDate() + 1);
  }

  // A single scan is ambiguous on its own — it could be a check-in with no
  // check-out yet, or a check-out from someone who forgot to scan in at the
  // start. Split the shift at its own midpoint: a lone scan before that
  // (covers anywhere from arriving early through an ordinary late check-in)
  // reads as check-in same as before; at or past it, this was almost
  // certainly their check-out, not a check-in nobody would ever be this
  // late for. Only possible when there's an expected shift to split at all.
  if (logs.length === 1 && standardStart && standardEnd) {
    const shiftMidpoint = new Date(standardStart.getTime() + (standardEnd.getTime() - standardStart.getTime()) / 2);
    if (firstIn >= shiftMidpoint) {
      lastOut = firstIn;
      firstIn = null;
    }
  }

  let lateMinutes = 0;
  let earlyLeaveMinutes = 0;
  const autoAbsentMinutes = expected ? expected.autoAbsentMinutes : null;
  if (standardStart && firstIn) {
    // Measured from the exact shift start — graceMinutes no longer shifts
    // this threshold (and so no longer keeps a slightly-late scan classified
    // as "present"); it now only sizes the "ຊ້າ" vs "ຊ້າເກີນ X ນາທີ" label
    // tiers on the attendance-log UI, against the raw minutes here.
    lateMinutes = firstIn > standardStart ? Math.round((firstIn - standardStart) / 60000) : 0;
  }
  if (standardEnd && lastOut) {
    earlyLeaveMinutes = lastOut < standardEnd ? Math.round((standardEnd - lastOut) / 60000) : 0;
  }

  const workedHours = firstIn && lastOut ? Math.round(((lastOut - firstIn) / 3600000) * 100) / 100 : 0;
  const otHours = workedHours > STANDARD_WORK_HOURS
    ? Math.round((workedHours - STANDARD_WORK_HOURS) * 100) / 100
    : 0;
  const expectedHours = computeExpectedHours(expected);

  const status = !firstIn || !lastOut
    ? 'incomplete'
    : autoAbsentMinutes != null && lateMinutes > autoAbsentMinutes
      ? 'absent'
      : lateMinutes > 0
        ? 'late'
        : 'present';
  // Late past autoAbsentMinutes counts as an absence — its tier is locked
  // like any other absence's (see models/AttendanceDaily.js).
  const severity = status === 'absent' ? await severityFieldsForAbsence(employeeId, dateKey) : CLEARED_SEVERITY;

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
      ...severity,
    },
    { upsert: true, new: true }
  );
}

// Used by the absence sweep and by a deliberate (disciplinary) ຂາດ — either
// way the tier is locked here, from the rules in force now.
async function markAbsent(employeeId, dateKey) {
  const expected = await resolveExpectedShift(employeeId, dateKey);
  const severity = await severityFieldsForAbsence(employeeId, dateKey);
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
      ...severity,
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
      ...CLEARED_SEVERITY,
    },
    { upsert: true, new: true }
  );
}

// A day before the employee's start date — only when that start date has
// already been reached. A start date still in the future on someone already
// being processed is a data-entry error (seen: active, scanning staff with a
// 2028 start date), so it's ignored rather than hiding their real days.
function beforeStartDate(employee, dateKey, now) {
  if (!employee.hireDate) return false;
  const hireKey = toDateKey(employee.hireDate);
  return hireKey <= toDateKey(now) && dateKey < hireKey;
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
  // Same "regular shift in force on that day" rule resolveExpectedShift
  // applies, from one batched read instead of one per employee.
  const logsByEmployee = new Map();
  const logs = await ShiftChangeLog.find({ employee: { $in: employees.map((e) => e._id) } }, 'employee effectiveDate previous next').lean();
  for (const log of logs) {
    const key = String(log.employee);
    if (!logsByEmployee.has(key)) logsByEmployee.set(key, []);
    logsByEmployee.get(key).push(log);
  }
  // Same for the recurring rest day — the one in force on each day filled.
  const restSchedules = await loadRestDaySchedules(employees.map((e) => e._id), startDateKey, endDateKey);

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
    const shiftsByEmployee = groupByEmployee(dayShifts);

    const toFill = [];
    for (const employee of employees) {
      const empId = String(employee._id);
      if (hasDaily.has(empId) || onLeave.has(empId) || beforeStartDate(employee, dateKey, new Date()) || !employee.deviceUserId) {
        skipped.push({ employee: empId, date: dateKey });
        continue;
      }
      // Two 'scheduled' rows (a cover alongside their own) still leave which
      // one's time is used to whichever is found first — same ambiguity
      // resolveExpectedShift itself has.
      const shift = pickDayOverride(shiftsByEmployee.get(empId));
      if (shift && (shift.status === 'rest' || shift.status === 'swapped')) {
        skipped.push({ employee: empId, date: dateKey });
        continue;
      }
      if (!shift && restDaysOn(restSchedules.get(empId), employee.defaultRestDay, dateKey).includes(dow)) {
        skipped.push({ employee: empId, date: dateKey });
        continue;
      }

      let start;
      let end;
      if (shift && shift.status === 'scheduled' && shift.startTime && shift.endTime) {
        start = timeStringToHM(shift.startTime);
        end = timeStringToHM(shift.endTime);
      } else {
        const historical = shiftOnDate(logsByEmployee.get(empId), dateKey);
        const category = employee.defaultShiftCategory;
        if (historical) {
          if (historical.startTime && historical.endTime) {
            start = timeStringToHM(historical.startTime);
            end = timeStringToHM(historical.endTime);
          }
        } else if (category && typeof category === 'object' && category.startTime && category.endTime) {
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
//  - it's before the employee's hireDate (not employed yet),
//  - the employee has no scanner code (deviceUserId) — they can't scan at all,
//  - a Shift override marks it 'rest' or 'swapped', or no override exists but
//    it's the recurring rest day in force for them that day,
//  - there's no resolvable expected shift at all that day (nothing to be
//    absent FROM — e.g. a ມາບໍ່ປົກກະຕິ position with no fixed schedule),
//  - its scan-capture window (resolveShiftWindow, overnight-aware) hasn't
//    closed yet — too early to call it a no-show.
const ABSENT_SWEEP_DAYS_BACK = 4;

async function markAbsentForMissedScans() {
  const now = new Date();
  const employees = await Employee.find({ status: 'active' }, '_id defaultRestDay hireDate deviceUserId');
  const marked = [];
  // The recurring rest day in force on each swept day — reading today's
  // (Employee.defaultRestDay) turned someone's old rest day into a "missed"
  // work day the moment it was changed.
  const restSchedules = await loadRestDaySchedules(
    employees.map((e) => e._id),
    addDays(toDateKey(now), -ABSENT_SWEEP_DAYS_BACK),
    addDays(toDateKey(now), -1)
  );

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
    const overridesByEmployee = groupByEmployee(overrides);
    const onLeave = new Set(approvedLeaves.map((l) => String(l.employee)));

    for (const employee of employees) {
      const empId = String(employee._id);
      if (hasDaily.has(empId) || onLeave.has(empId)) continue;
      // Not employed yet that day — nothing to be absent from.
      if (beforeStartDate(employee, dateKey, now)) continue;
      // No scanner code: they can't scan at all, so a missing scan says nothing.
      if (!employee.deviceUserId) continue;

      // Previously the LAST row found decided it, 'cancelled' included — a
      // leftover cancelled row on someone's recurring rest day made that day
      // look like it had an override, so it was judged as a work day.
      const overrideStatus = pickDayOverride(overridesByEmployee.get(empId))?.status;
      if (overrideStatus === 'rest' || overrideStatus === 'swapped') continue;
      if (!overrideStatus && restDaysOn(restSchedules.get(empId), employee.defaultRestDay, dateKey).includes(dow)) continue;

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
      ...CLEARED_SEVERITY,
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
      ...CLEARED_SEVERITY,
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
  pickDayOverride,
  GRACE_MINUTES,
  STANDARD_WORK_HOURS,
};
