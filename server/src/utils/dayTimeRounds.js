const mongoose = require('mongoose');
const BulkEditRound = require('../models/BulkEditRound');
const Employee = require('../models/Employee');
const Shift = require('../models/Shift');
const Leave = require('../models/Leave');
const AttendanceDaily = require('../models/AttendanceDaily');
const ShiftCategory = require('../models/ShiftCategory');
const ShiftChangeLog = require('../models/ShiftChangeLog');
const ScheduledShiftChange = require('../models/ScheduledShiftChange');
const { toDateKey, dayRange, rejudgeDayList } = require('./attendanceProcessor');
const { loadRestDaySchedules, restDaysOn, addDays, weekdayOf, isDateKey, badRequest } = require('./restDaySchedule');
const { shiftOnDate } = require('./shiftHistory');
const { sideOf, shiftLabel, POPULATE } = require('./bulkEditRounds');

// ປັບເວລາສະເພາະມື້ on ແກ້ໄຂກະແບບກຸ່ມ (asked for 2026-11-16): the working time
// for one day or a few days only, for many people at once — e.g. a position on
// 21:00-04:00 that came in 20:00-03:00 that night. Each person-day becomes the
// same day-specific Shift row as "ກຳນົດເວລາພິເສດໃຫ້ຕົວເອງ" on ຕັ້ງຄ່າແຜນວຽກ
// (which then shows it as ແກ້ໄຂພິເສດ, with ຄືນຄ່າປົກກະຕິ), so scans that day
// are judged by it; their regular shift doesn't change. A day already past is
// judged again straight away — the point of the change. A day that isn't a
// plain working day of theirs is left out, with why (planDayTime). The round
// goes in ປະຫວັດການແກ້ໄຂ and can be called off there as a whole.

const MAX_DAYS = 31;
const MAX_PEOPLE = 1000;
const MAX_CELLS = 3000; // people × days per round
const DAY_TIME_NOTE = 'ປັບເວລາສະເພາະມື້ (ແກ້ໄຂກະແບບກຸ່ມ)';
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const REJUDGE_AT_ONCE = 8;
const isId = (v) => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v);

function datesBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// The request as sent from the page: who, which days, and the time — typed, or
// a shift category's (kept as the row's category only while the time is still
// the category's own).
async function readDayTimeRequest(body) {
  const { employees, from, to: toRaw, startTime, endTime, category } = body ?? {};
  const ids = [...new Set(Array.isArray(employees) ? employees.filter(isId) : [])];
  if (!ids.length) throw badRequest('ກະລຸນາເລືອກພະນັກງານ');
  if (ids.length > MAX_PEOPLE) throw badRequest(`ເລືອກໄດ້ສູງສຸດ ${MAX_PEOPLE} ຄົນຕໍ່ຮອບ`);
  const to = toRaw || from;
  if (!isDateKey(from) || !isDateKey(to) || to < from) throw badRequest('ກະລຸນາເລືອກວັນທີ');
  const dates = datesBetween(from, to);
  if (dates.length > MAX_DAYS) throw badRequest(`ເລືອກໄດ້ສູງສຸດ ${MAX_DAYS} ມື້ຕໍ່ຮອບ`);
  if (ids.length * dates.length > MAX_CELLS) {
    throw badRequest(`ຫຼາຍເກີນໄປ (${ids.length} ຄົນ × ${dates.length} ມື້) — ສູງສຸດ ${MAX_CELLS} ຕໍ່ຮອບ`);
  }
  let categoryDoc = null;
  if (category) {
    if (!isId(category)) throw badRequest('ບໍ່ພົບກະທີ່ເລືອກ');
    categoryDoc = await ShiftCategory.findById(category, 'name startTime endTime').lean();
    if (!categoryDoc) throw badRequest('ບໍ່ພົບກະທີ່ເລືອກ');
  }
  const start = startTime || categoryDoc?.startTime;
  const end = endTime || categoryDoc?.endTime;
  if (!TIME_RE.test(start ?? '') || !TIME_RE.test(end ?? '')) throw badRequest('ກະລຸນາໃສ່ເວລາເຂົ້າ-ອອກ');
  if (start === end) throw badRequest('ເວລາເຂົ້າ ແລະ ເວລາອອກ ຕ້ອງບໍ່ຄືກັນ');
  const sameAsCategory = categoryDoc && categoryDoc.startTime === start && categoryDoc.endTime === end;
  return { ids, from, to, dates, startTime: start, endTime: end, category: sameAsCategory ? categoryDoc : null };
}

const keyOf = (employeeId, date) => `${employeeId}_${date}`;

// The regular time someone had on a day: a ຍ້າຍກະລ່ວງໜ້າ still waiting from
// its start date on, else the shift history, else their shift now — the same
// order the scans are judged by (attendanceProcessor.js resolveExpectedShift).
function regularTimeOn(employee, logs, waitingMoves, date) {
  const move = waitingMoves.filter((m) => m.effectiveDate <= date).at(-1);
  if (move?.newShiftCategory?.startTime) return `${move.newShiftCategory.startTime}-${move.newShiftCategory.endTime}`;
  const historical = shiftOnDate(logs, date);
  if (historical) return historical.startTime && historical.endTime ? `${historical.startTime}-${historical.endTime}` : null;
  return shiftLabel(employee);
}

// What saving the request would do, person by person and day by day: set, or
// left out and why. Only a plain working day of their own gets the new time —
// not a day off (their rest day, a ພັກ or ຮ້ານປິດ set for it, leave), not a day
// already arranged otherwise (a cover either way, a time already set for that
// day, a swap's blank day), and not someone with no regular shift (their days
// are set one by one on ຕັ້ງຄ່າແຜນວຽກ).
async function planDayTime(request, now = new Date()) {
  const { ids, from, to, dates, startTime, endTime, category } = request;
  const time = `${startTime}-${endTime}`;
  const [employees, ownRows, coveredRows, leaves, substituted, logs, waiting, restSchedules] = await Promise.all([
    Employee.find({ _id: { $in: ids } }).populate(POPULATE).lean(),
    Shift.find(
      { employee: { $in: ids }, date: { $gte: from, $lte: to }, status: { $in: ['scheduled', 'swapped', 'rest'] } },
      'employee date status startTime endTime coveringFor holiday'
    ).lean(),
    Shift.find({ coveringFor: { $in: ids }, date: { $gte: from, $lte: to }, status: 'scheduled' }, 'coveringFor date').lean(),
    Leave.find(
      { employee: { $in: ids }, status: 'approved', startDate: { $lte: dayRange(to).end }, endDate: { $gte: dayRange(from).start } },
      'employee startDate endDate'
    ).lean(),
    AttendanceDaily.find({ employee: { $in: ids }, date: { $gte: from, $lte: to }, status: 'substituted' }, 'employee date').lean(),
    ShiftChangeLog.find({ employee: { $in: ids } }, 'employee effectiveDate previous next').lean(),
    ScheduledShiftChange.find({ employee: { $in: ids }, status: 'pending', effectiveDate: { $lte: to } }, 'employee effectiveDate newShiftCategory')
      .populate('newShiftCategory', 'startTime endTime')
      .sort({ effectiveDate: 1 })
      .lean(),
    loadRestDaySchedules(ids, from, to),
  ]);
  if (employees.length !== ids.length) throw badRequest(`ບໍ່ພົບພະນັກງານ ${ids.length - employees.length} ຄົນ`);

  const rowsByDay = new Map();
  for (const row of ownRows) {
    const key = keyOf(row.employee, row.date);
    if (!rowsByDay.has(key)) rowsByDay.set(key, []);
    rowsByDay.get(key).push(row);
  }
  const coveredDays = new Set([...coveredRows.map((r) => keyOf(r.coveringFor, r.date)), ...substituted.map((d) => keyOf(d.employee, d.date))]);
  const group = (rows) => {
    const map = new Map();
    for (const r of rows) {
      const id = String(r.employee);
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(r);
    }
    return map;
  };
  const leavesBy = group(leaves);
  const logsBy = group(logs);
  const waitingBy = group(waiting);

  const dayFor = (employee, date) => {
    const id = String(employee._id);
    if (employee.status !== 'active') return { reason: 'ບໍ່ແມ່ນພະນັກງານທີ່ເຮັດວຽກຢູ່' };
    if (employee.hireDate && date < toDateKey(employee.hireDate)) return { reason: 'ຍັງບໍ່ທັນເລີ່ມວຽກ' };
    const own = rowsByDay.get(keyOf(id, date)) ?? [];
    const cover = own.find((r) => r.status === 'scheduled' && r.coveringFor);
    if (cover) return { reason: `ໄປເຮັດແທນຄົນອື່ນ (${cover.startTime}-${cover.endTime})` };
    const special = own.find((r) => r.status === 'scheduled');
    if (special) return { reason: `ມີເວລາສະເພາະມື້ນີ້ຢູ່ແລ້ວ (${special.startTime}-${special.endTime})` };
    if (own.some((r) => r.status === 'swapped')) return { reason: 'ບໍ່ມີກະມື້ນີ້ (ສະຫຼັບຕຳແໜ່ງ)' };
    const rest = own.find((r) => r.status === 'rest');
    if (rest) return { reason: rest.holiday ? 'ຮ້ານປິດ' : 'ວັນພັກ' };
    if (coveredDays.has(keyOf(id, date))) return { reason: 'ມີຄົນມາເຮັດແທນ' };
    const { start, end } = dayRange(date);
    if ((leavesBy.get(id) ?? []).some((l) => new Date(l.startDate) <= end && new Date(l.endDate) >= start)) return { reason: 'ລາ' };
    if (restDaysOn(restSchedules.get(id), employee.defaultRestDay, date).includes(weekdayOf(date))) return { reason: 'ວັນພັກ' };
    const before = regularTimeOn(employee, logsBy.get(id) ?? [], waitingBy.get(id) ?? [], date);
    if (!before) return { reason: 'ບໍ່ມີກະປະຈຳ — ຕັ້ງທີລະຄົນທີ່ ຕັ້ງຄ່າແຜນວຽກ' };
    if (before === time) return { before, reason: 'ເວລາຄືກະປົກກະຕິຢູ່ແລ້ວ' };
    if (!employee.position) return { before, reason: 'ຍັງບໍ່ມີຕຳແໜ່ງ' };
    return { before, set: true };
  };

  const today = toDateKey(now);
  const people = employees
    .map((employee) => ({
      employee: String(employee._id),
      employeeCode: employee.employeeCode ?? null,
      name: `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() || null,
      position: employee.position?._id ?? employee.position ?? null,
      side: sideOf(employee),
      days: dates.map((date) => {
        const d = dayFor(employee, date);
        return { date, set: !!d.set, before: d.before ?? null, reason: d.reason ?? null };
      }),
    }))
    .sort((a, b) => String(a.employeeCode ?? '').localeCompare(String(b.employeeCode ?? ''), undefined, { numeric: true }));
  const setDays = people.flatMap((p) => p.days.filter((d) => d.set));
  return {
    from,
    to,
    dates,
    startTime,
    endTime,
    time,
    category: category ? { _id: category._id, name: category.name ?? null } : null,
    people,
    setCount: setDays.length,
    skipCount: people.reduce((n, p) => n + p.days.filter((d) => !d.set).length, 0),
    pastCount: setDays.filter((d) => d.date <= today).length,
  };
}

// Judges again every day these changes touch that has happened (each day and
// the ones either side, as rejudgeAroundDay does) — a few people at a time.
async function rejudgeTouched(touched, now = new Date()) {
  const today = toDateKey(now);
  const jobs = [...touched].map(([employeeId, dates]) => {
    const days = new Set();
    for (const d of dates) for (const day of [addDays(d, -1), d, addDays(d, 1)]) if (day <= today) days.add(day);
    return { employeeId, days: [...days].sort() };
  });
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next];
      next += 1;
      // eslint-disable-next-line no-await-in-loop
      await rejudgeDayList(job.employeeId, job.days).catch((err) => console.error('[day-time] rejudge failed', job.employeeId, err.message));
    }
  };
  await Promise.all(Array.from({ length: Math.min(REJUDGE_AT_ONCE, jobs.length) }, worker));
}

const addTouched = (touched, employeeId, date) => {
  const id = String(employeeId);
  if (!touched.has(id)) touched.set(id, new Set());
  touched.get(id).add(date);
};

function skippedSummary(days) {
  const counts = new Map();
  for (const d of days) if (!d.set && d.reason) counts.set(d.reason, (counts.get(d.reason) ?? 0) + 1);
  return [...counts].map(([reason, n]) => (n > 1 ? `${reason} ×${n}` : reason)).join('; ') || null;
}

// Saves the request (planned again here, so nothing changed since the preview
// slips through): the day rows, then the round, then the days already past
// judged again.
async function applyDayTime(request, user, now = new Date()) {
  const plan = await planDayTime(request, now);
  if (!plan.setCount) throw badRequest('ບໍ່ມີມື້ໃດໃຫ້ປັບ — ທຸກມື້ທີ່ເລືອກຖືກຂ້າມ');
  const toSet = plan.people.flatMap((p) => p.days.filter((d) => d.set).map((d) => ({ p, d })));
  const rows = await Shift.insertMany(
    toSet.map(({ p, d }) => ({
      employee: p.employee,
      position: p.position,
      category: plan.category?._id ?? undefined,
      date: d.date,
      startTime: plan.startTime,
      endTime: plan.endTime,
      status: 'scheduled',
      note: DAY_TIME_NOTE,
    }))
  );
  const rowFor = new Map(rows.map((r) => [keyOf(r.employee, r.date), r._id]));
  const round = await BulkEditRound.create({
    action: 'dayTime',
    source: 'bulk',
    target: { id: plan.category?._id ?? null, label: plan.time, effectiveDate: plan.from, toDate: plan.to },
    byEmail: user?.email,
    by: user?.employeeId ? user.employeeId._id : null,
    items: plan.people.map((p) => {
      const setHere = p.days.filter((d) => d.set);
      const skippedHere = p.days.length - setHere.length;
      return {
        employee: p.employee,
        employeeCode: p.employeeCode,
        name: p.name,
        before: { ...p.side, shift: setHere[0]?.before ?? p.days.find((d) => d.before)?.before ?? p.side.shift },
        after: setHere.length ? { ...p.side, shift: plan.time } : undefined,
        status: setHere.length ? 'ok' : 'skipped',
        message: setHere.length ? (skippedHere ? `ຂ້າມ ${skippedHere} ມື້: ${skippedSummary(p.days)}` : null) : skippedSummary(p.days),
        days: p.days.map((d) => ({
          date: d.date,
          status: d.set ? 'ok' : 'skipped',
          before: d.before,
          message: d.set ? null : d.reason,
          shift: d.set ? rowFor.get(keyOf(p.employee, d.date)) ?? null : null,
        })),
      };
    }),
    finishedAt: new Date(),
  });
  const touched = new Map();
  for (const { p, d } of toSet) addTouched(touched, p.employee, d.date);
  await rejudgeTouched(touched, now);
  return { round, setCount: plan.setCount, skipCount: plan.skipCount, pastCount: plan.pastCount };
}

// ຍົກເລີກທັງຮອບ: each day the round set goes back to normal — its row is
// removed — unless that day was changed again since (then it's left as it is,
// and said so); a day already put back on ຕັ້ງຄ່າແຜນວຽກ simply counts as done.
// The days already past are judged again.
async function cancelDayTimeRound(round, user, now = new Date()) {
  if (round.action !== 'dayTime') throw badRequest('ຍົກເລີກທັງຮອບໄດ້ສະເພາະ ປັບເວລາສະເພາະມື້');
  if (round.cancelledAt) throw badRequest('ຮອບນີ້ຍົກເລີກແລ້ວ');
  const [startTime, endTime] = String(round.target?.label ?? '').split('-');
  const shiftIds = round.items.flatMap((i) => (i.days ?? []).filter((d) => d.status === 'ok' && d.shift).map((d) => d.shift));
  const rows = new Map((await Shift.find({ _id: { $in: shiftIds } }).lean()).map((r) => [String(r._id), r]));
  const remove = [];
  const touched = new Map();
  let kept = 0;
  for (const item of round.items) {
    for (const day of item.days ?? []) {
      if (day.status !== 'ok') continue;
      const row = day.shift ? rows.get(String(day.shift)) : null;
      if (!row) {
        day.status = 'cancelled';
        day.message = 'ຄືນຄ່າປົກກະຕິແລ້ວກ່ອນໜ້ານີ້';
        continue;
      }
      if (row.status !== 'scheduled' || row.coveringFor || row.startTime !== startTime || row.endTime !== endTime) {
        day.message = 'ຖືກແກ້ໄຂອີກຫຼັງຈາກນັ້ນ — ບໍ່ໄດ້ຍົກເລີກ (ແກ້ທີ່ ຕັ້ງຄ່າແຜນວຽກ)';
        kept += 1;
        continue;
      }
      remove.push(row._id);
      day.status = 'cancelled';
      day.message = null;
      addTouched(touched, row.employee, row.date);
    }
    if (item.status === 'ok' && !(item.days ?? []).some((d) => d.status === 'ok')) {
      item.status = 'cancelled';
      item.message = 'ຍົກເລີກທັງຮອບ';
    }
  }
  if (remove.length) await Shift.deleteMany({ _id: { $in: remove } });
  round.cancelledAt = now;
  round.cancelledByEmail = user?.email ?? null;
  round.markModified('items');
  await round.save();
  await rejudgeTouched(touched, now);
  return { round, cancelled: remove.length, kept };
}

module.exports = { readDayTimeRequest, planDayTime, applyDayTime, cancelDayTimeRound, DAY_TIME_NOTE, MAX_DAYS };
