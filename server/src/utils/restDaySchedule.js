const mongoose = require('mongoose');
const RestDayHistory = require('../models/RestDayHistory');
const Employee = require('../models/Employee');
const Shift = require('../models/Shift');

// Which weekdays an employee rests on, as of any given date — from their
// RestDayHistory rows (models/RestDayHistory.js). Everything that judges a
// day (the absence sweep, the outage fill, night-shift attribution, leave
// deductions, and the pages via GET /rest-day-history/schedule) asks this
// instead of reading Employee.defaultRestDay, which only says what applies
// TODAY. Mirrored in client/src/utils/restDays.ts — keep the two in step.

// Local-day helpers (attendanceProcessor.js requires this file, so it can't
// require that one back).
function toDateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(dateKey, days) {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}
function weekdayOf(dateKey) {
  return new Date(`${dateKey}T00:00:00`).getDay();
}
// Monday-to-Sunday weeks, same as ຕາຕະລາງກະ.
function mondayOf(dateKey) {
  const dow = weekdayOf(dateKey);
  return addDays(dateKey, dow === 0 ? -6 : 1 - dow);
}
const isDateKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// The first Monday after today that opens a month (falls on its 1st–7th) —
// where HR's plan for that month's rest days starts. Mirrored in
// client/src/utils/restDays.ts.
function firstMondayOfMonthAfter(today) {
  let monday = addDays(mondayOf(today), 7);
  while (Number(monday.slice(8)) > 7) monday = addDays(monday, 7);
  return monday;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function sameRestDays(a, b) {
  const x = [...(a ?? [])].sort();
  const y = [...(b ?? [])].sort();
  return x.length === y.length && x.every((d, i) => d === y[i]);
}

function sortRows(rows) {
  return [...rows].sort(
    (a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || new Date(a.createdAt) - new Date(b.createdAt)
  );
}

// From one employee's rows — any subset holding the latest row on or before
// dateKey, or (when there is none) their earliest row — the rest days in force
// on dateKey. No rows at all: `fallback` (their Employee.defaultRestDay)
// applies to every date.
function restDaysOn(rows, fallback, dateKey) {
  if (!rows?.length) return fallback ?? [];
  const sorted = sortRows(rows);
  let inForce = null;
  for (const row of sorted) {
    if (row.effectiveDate > dateKey) break;
    inForce = row.newRestDay;
  }
  return inForce ?? sorted[0].previousRestDay ?? [];
}

// Exactly the rows restDaysOn needs for any day in [fromKey, toKey], per
// employee (Map of employee id → rows): the latest change on or before
// fromKey, the first one after it, and every one inside the range — instead
// of an employee's whole history, which grows every month for staff whose
// rest day rotates monthly. `employeeIds` null = everyone.
async function loadRestDaySchedules(employeeIds, fromKey, toKey) {
  const scope = employeeIds ? { employee: { $in: employeeIds.map((id) => new mongoose.Types.ObjectId(String(id))) } } : {};
  const firstPer = (match, direction) =>
    RestDayHistory.aggregate([
      { $match: { ...scope, ...match } },
      { $sort: { employee: 1, effectiveDate: direction, createdAt: direction } },
      { $group: { _id: '$employee', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
    ]);
  const fields = 'employee effectiveDate previousRestDay newRestDay createdAt';
  const [latestBefore, firstAfter, inside] = await Promise.all([
    firstPer({ effectiveDate: { $lte: fromKey } }, -1),
    firstPer({ effectiveDate: { $gt: fromKey } }, 1),
    RestDayHistory.find({ ...scope, effectiveDate: { $gt: fromKey, $lte: toKey } }, fields).lean(),
  ]);
  const byEmployee = new Map();
  const seen = new Set();
  for (const row of [...latestBefore, ...firstAfter, ...inside]) {
    const id = String(row._id);
    if (seen.has(id)) continue;
    seen.add(id);
    const key = String(row.employee);
    if (!byEmployee.has(key)) byEmployee.set(key, []);
    byEmployee.get(key).push({
      _id: id,
      employee: key,
      effectiveDate: row.effectiveDate,
      previousRestDay: row.previousRestDay ?? [],
      newRestDay: row.newRestDay ?? [],
      createdAt: row.createdAt,
    });
  }
  return byEmployee;
}

// One employee, one date — for the per-scan night-shift check.
async function restDaysOnFor(employeeId, dateKey) {
  const [schedules, employee] = await Promise.all([
    loadRestDaySchedules([employeeId], dateKey, dateKey),
    Employee.findById(employeeId, 'defaultRestDay').lean(),
  ]);
  return restDaysOn(schedules.get(String(employeeId)), employee?.defaultRestDay, dateKey);
}

// The soonest a change can start: tomorrow, if they haven't had their rest
// day yet this week and one of the new rest days is still ahead in it;
// otherwise next Monday — so the week it changes in still gets exactly one
// rest day. Never today or earlier: a rest day isn't changed after the fact.
// "Rested" counts their recurring rest day (as it stood on each day) or a
// personal one-off ພັກ — not a day a queued shift brought them in on, and
// not a company holiday. Only someone with no recurring rest day yet starts
// this soon (startOfChange below).
async function effectiveDateForChange(employee, newRestDays, now = new Date()) {
  const today = toDateKey(now);
  const weekStart = mondayOf(today);
  const weekEnd = addDays(weekStart, 6);
  const tomorrow = addDays(today, 1);
  const nextMonday = addDays(weekStart, 7);

  const [schedules, overrides] = await Promise.all([
    loadRestDaySchedules([employee._id], weekStart, weekEnd),
    Shift.find({ employee: employee._id, date: { $gte: weekStart, $lte: weekEnd }, status: { $in: ['scheduled', 'rest', 'swapped'] } }, 'date status holiday').lean(),
  ]);
  const rows = schedules.get(String(employee._id)) ?? [];
  const workingDates = new Set(overrides.filter((o) => o.status === 'scheduled').map((o) => o.date));
  const personalRestDates = new Set(overrides.filter((o) => o.status === 'rest' && !o.holiday).map((o) => o.date));

  let restedThisWeek = false;
  for (let d = weekStart; d <= today; d = addDays(d, 1)) {
    if (personalRestDates.has(d)) restedThisWeek = true;
    else if (!workingDates.has(d) && restDaysOn(rows, employee.defaultRestDay, d).includes(weekdayOf(d))) restedThisWeek = true;
  }
  let newDayAhead = false;
  for (let d = tomorrow; d <= weekEnd; d = addDays(d, 1)) {
    if (newRestDays.includes(weekdayOf(d)) && !workingDates.has(d)) newDayAhead = true;
  }

  if (!restedThisWeek && newDayAhead) return { effectiveDate: tomorrow, reason: 'thisWeek' };
  return { effectiveDate: nextMonday, reason: restedThisWeek ? 'restedThisWeek' : 'newDayPassed' };
}

// When a change made by hand starts: on a Monday after today — the one asked
// for, else the first Monday of the next month to begin, where HR's monthly
// plan starts — so every Monday-to-Sunday week rests on one pattern from
// start to end, and none gets two rest days or none. Someone with no
// recurring rest day today has nothing to rest on twice: unless a date is
// asked for, theirs starts as soon as effectiveDateForChange allows, and
// that day may be asked for too. `reason` says which: 'chosen', 'monthStart',
// or effectiveDateForChange's own.
async function startOfChange(employee, newRestDays, requestedDate, now = new Date()) {
  const today = toDateKey(now);
  const schedules = await loadRestDaySchedules([employee._id], today, today);
  const setup = !restDaysOn(schedules.get(String(employee._id)), employee.defaultRestDay, today).length;
  const soonest = setup ? await effectiveDateForChange(employee, newRestDays, now) : null;
  if (!requestedDate) {
    return soonest
      ? { effectiveDate: soonest.effectiveDate, setup, reason: soonest.reason }
      : { effectiveDate: firstMondayOfMonthAfter(today), setup, reason: 'monthStart' };
  }
  if (!isDateKey(requestedDate) || requestedDate <= today) throw badRequest('ວັນທີ່ມີຜົນຕ້ອງເປັນມື້ອື່ນ ຫຼື ຫຼັງຈາກນັ້ນ');
  if (weekdayOf(requestedDate) !== 1 && requestedDate !== soonest?.effectiveDate) throw badRequest('ວັນພັກໃໝ່ຕ້ອງເລີ່ມວັນຈັນ');
  return { effectiveDate: requestedDate, setup, reason: 'chosen' };
}

// Records "from effectiveDate on, `employeeId` rests on newRestDay" — the
// one place rows are written. A change on a date that already has one
// replaces it (and one that lands back on what was in force before removes
// it); the next later change's "previous" is kept pointing at this one; and
// once in effect (effectiveDate today or earlier — only ever the case for a
// position swap applied by the system) Employee.defaultRestDay is switched
// straight away. Returns the row, or null when nothing changes.
async function recordRestDayChange({ employeeId, newRestDay, effectiveDate, source, changedBy, changedByEmail, now = new Date() }) {
  const today = toDateKey(now);
  const employee = await Employee.findById(employeeId, 'defaultRestDay').lean();
  if (!employee) return null;
  const dayBefore = addDays(effectiveDate, -1);
  const before = await loadRestDaySchedules([employeeId], dayBefore, effectiveDate);
  const sameDate = await RestDayHistory.findOne({ employee: employeeId, effectiveDate }).sort({ createdAt: -1 });
  const previous = sameDate ? sameDate.previousRestDay : restDaysOn(before.get(String(employeeId)), employee.defaultRestDay, dayBefore);

  let row = null;
  if (sameRestDays(previous, newRestDay)) {
    if (sameDate) await RestDayHistory.deleteMany({ employee: employeeId, effectiveDate });
  } else if (sameDate) {
    sameDate.newRestDay = newRestDay;
    sameDate.source = source;
    sameDate.changedBy = changedBy;
    sameDate.changedByEmail = changedByEmail;
    sameDate.appliedAt = effectiveDate <= today ? now : null;
    row = await sameDate.save();
  } else {
    row = await RestDayHistory.create({
      employee: employeeId,
      previousRestDay: previous,
      newRestDay,
      effectiveDate,
      source,
      changedBy,
      changedByEmail,
      appliedAt: effectiveDate <= today ? now : null,
    });
  }

  await relinkNextChange(employeeId, effectiveDate, row ? newRestDay : previous);
  if (effectiveDate <= today) await refreshCurrentRestDay(employeeId, today);
  return row;
}

// A later change still says what it changed FROM — keep that pointing at
// whatever is in force just before it.
async function relinkNextChange(employeeId, afterDate, restDaysBefore) {
  const next = await RestDayHistory.findOne({ employee: employeeId, effectiveDate: { $gt: afterDate } }).sort({ effectiveDate: 1, createdAt: 1 });
  if (next && !sameRestDays(next.previousRestDay, restDaysBefore)) {
    next.previousRestDay = restDaysBefore;
    await next.save();
  }
}

async function refreshCurrentRestDay(employeeId, today) {
  const employee = await Employee.findById(employeeId, 'defaultRestDay').lean();
  const schedules = await loadRestDaySchedules([employeeId], today, today);
  const current = restDaysOn(schedules.get(String(employeeId)), employee?.defaultRestDay, today);
  if (!sameRestDays(current, employee?.defaultRestDay)) await Employee.updateOne({ _id: employeeId }, { defaultRestDay: current });
}

// Cancels a change that hasn't taken effect yet.
async function cancelRestDayChange(row, now = new Date()) {
  if (row.effectiveDate <= toDateKey(now)) {
    const err = new Error('ຍົກເລີກໄດ້ສະເພາະການປ່ຽນທີ່ຍັງບໍ່ທັນມີຜົນ');
    err.status = 400;
    throw err;
  }
  await row.deleteOne();
  await relinkNextChange(row.employee, row.effectiveDate, row.previousRestDay);
}

// Switches Employee.defaultRestDay over for every change whose day has come.
// Run on startup and on the usual 15-minute timer (index.js).
async function applyDueRestDayChanges(now = new Date()) {
  const today = toDateKey(now);
  const due = await RestDayHistory.find({ appliedAt: null, effectiveDate: { $lte: today } }).sort({ effectiveDate: 1, createdAt: 1 });
  const latest = new Map();
  for (const row of due) latest.set(String(row.employee), row);
  for (const row of latest.values()) {
    // eslint-disable-next-line no-await-in-loop
    await Employee.updateOne({ _id: row.employee }, { defaultRestDay: row.newRestDay });
  }
  if (due.length) await RestDayHistory.updateMany({ _id: { $in: due.map((r) => r._id) } }, { appliedAt: now });
  return due.length;
}

// effectiveDate of a row that applies to every earlier day — sorts before any
// real date, so restDaysOn and the range queries need nothing special for it.
const FROM_THE_START = '0000-01-01';

// Rows recorded before effectiveDate existed took effect the moment they
// were saved — date them that way. Except someone's first row when they had
// no rest day before it (and any re-pick saved the same day): that is their
// rest day being set up, not changed, and every page has always read it for
// every date. Dating it would leave the days before it with no rest day at
// all — on the live data, the setup of 243 people on 14/10/2026 would have
// turned 298 of their 1–13/10 rest days into ຂ. One-off; a no-op once done.
async function migrateRestDayHistory() {
  const rows = await RestDayHistory.find(
    { $or: [{ effectiveDate: null }, { effectiveDate: { $exists: false } }] },
    'employee createdAt changedByEmail'
  ).lean();
  if (!rows.length) return 0;
  const firsts = await RestDayHistory.aggregate([
    { $match: { employee: { $in: [...new Set(rows.map((r) => String(r.employee)))].map((id) => new mongoose.Types.ObjectId(id)) } } },
    { $sort: { employee: 1, createdAt: 1 } },
    { $group: { _id: '$employee', previousRestDay: { $first: '$previousRestDay' }, createdAt: { $first: '$createdAt' } } },
  ]);
  const setupDay = new Map(firsts.filter((f) => !f.previousRestDay?.length).map((f) => [String(f._id), toDateKey(f.createdAt)]));
  await RestDayHistory.bulkWrite(
    rows.map((r) => ({
      updateOne: {
        filter: { _id: r._id },
        update: {
          $set: {
            effectiveDate: setupDay.get(String(r.employee)) === toDateKey(r.createdAt) ? FROM_THE_START : toDateKey(r.createdAt),
            appliedAt: r.createdAt,
            source: (r.changedByEmail ?? '').startsWith('ລະບົບ') ? 'position-swap' : 'migration',
          },
        },
      },
    }))
  );
  return rows.length;
}

module.exports = {
  restDaysOn,
  loadRestDaySchedules,
  restDaysOnFor,
  effectiveDateForChange,
  startOfChange,
  firstMondayOfMonthAfter,
  recordRestDayChange,
  cancelRestDayChange,
  applyDueRestDayChanges,
  migrateRestDayHistory,
  sameRestDays,
  addDays,
  weekdayOf,
  isDateKey,
  badRequest,
  FROM_THE_START,
};
