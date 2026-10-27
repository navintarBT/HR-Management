const express = require('express');
const mongoose = require('mongoose');
const RestDayHistory = require('../models/RestDayHistory');
const Employee = require('../models/Employee');
const Position = require('../models/Position');
const Shift = require('../models/Shift');
const Leave = require('../models/Leave');
const { authenticate, requireRole } = require('../middleware/auth');
const { resolveRestDayForEmployee, resolveRestDayForPosition, mergeRestDayRule } = require('../utils/restDayRules');
const {
  loadRestDaySchedules,
  startOfChange,
  firstMondayOfMonthAfter,
  recordRestDayChange,
  cancelRestDayChange,
  restDaysOn,
  sameRestDays,
  addDays,
  weekdayOf,
  isDateKey,
  badRequest,
} = require('../utils/restDaySchedule');
const { recomputeLeavesAfterRestChange } = require('../utils/leaveDeduction');
const { toDateKey } = require('../utils/attendanceProcessor');

const router = express.Router();
// How far ahead a queued shift on a new rest day is still worth warning about.
const CONFLICT_HORIZON_DAYS = 62;

// The history list (ປະຫວັດປ່ຽນວັນພັກ). Rows are written only through the
// routes below / a position swap — never edited directly.
router.get('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { _start = 0, _end = 10, _sort = 'createdAt', _order = 'desc', ...filters } = req.query;
    const query = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === '') continue;
      query[key] = value;
    }
    const start = Number(_start) || 0;
    const end = Number(_end) || start + 10;
    const [items, total] = await Promise.all([
      RestDayHistory.find(query)
        .populate({ path: 'employee', populate: 'department position' })
        .populate('changedBy')
        .sort({ [_sort]: _order === 'asc' ? 1 : -1 })
        .skip(start)
        .limit(end - start),
      RestDayHistory.countDocuments(query),
    ]);
    res.set('X-Total-Count', String(total));
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// What a page showing [from, to] needs to tell anyone's recurring rest day on
// each of those days (client/src/utils/restDays.ts restDaysOn): per employee,
// the changes bracketing and inside the range. Employees with none rest on
// their Employee.defaultRestDay throughout.
router.get('/schedule', authenticate, requireRole('admin', 'manager', 'employee'), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!isDateKey(from) || !isDateKey(to) || to < from) return res.status(400).json({ message: 'from/to ຕ້ອງເປັນ YYYY-MM-DD' });
    let employeeIds = null;
    if (req.user.role === 'employee') employeeIds = req.user.employeeId ? [req.user.employeeId._id] : [];
    const schedules = await loadRestDaySchedules(employeeIds, from, to);
    res.json([...schedules.values()].flat());
  } catch (err) {
    next(err);
  }
});

async function loadEmployeeForChange(employeeId) {
  if (!employeeId) {
    const err = new Error('ກະລຸນາເລືອກພະນັກງານ');
    err.status = 400;
    throw err;
  }
  const employee = await Employee.findById(employeeId);
  if (!employee) {
    const err = new Error('ບໍ່ພົບພະນັກງານ');
    err.status = 404;
    throw err;
  }
  return employee;
}

const horizonOf = (effectiveDate) => addDays(effectiveDate, CONFLICT_HORIZON_DAYS);
const conflictsOn = (shifts, restDays) =>
  shifts
    .filter((s) => restDays.includes(weekdayOf(s.date)))
    .map((s) => ({ date: s.date, startTime: s.startTime, endTime: s.endTime }))
    .sort((a, b) => a.date.localeCompare(b.date));
const changeSummary = (row) => ({ _id: row._id, effectiveDate: row.effectiveDate, newRestDay: row.newRestDay });

// What saving `restDays` for `employee` from `requestedDate` (a Monday;
// left out: startOfChange's default) would do — the rest days after the
// position's ຂໍ້ຈຳກັດວັນພັກ (redirected to its fallback, or refused), the
// day it takes effect, what they rest on just before it, the waiting change
// on that same day it replaces and the other waiting ones it leaves in
// place, queued shifts that would still bring them in on a new rest day, and
// how many leaves would be worked out again.
async function planChange(employee, requestedRestDays, requestedDate, now = new Date()) {
  const today = toDateKey(now);
  const restDays = await resolveRestDayForEmployee(employee, employee.position, requestedRestDays ?? []);
  const { effectiveDate, setup, reason } = await startOfChange(employee, restDays, requestedDate, now);
  const dayBefore = addDays(effectiveDate, -1);
  const [schedules, sameDate, pending, queuedShifts, leavesAffected] = await Promise.all([
    loadRestDaySchedules([employee._id], dayBefore, dayBefore),
    RestDayHistory.findOne({ employee: employee._id, effectiveDate }).sort({ createdAt: -1 }).lean(),
    RestDayHistory.find({ employee: employee._id, effectiveDate: { $gt: today, $ne: effectiveDate } }).sort({ effectiveDate: 1 }).lean(),
    Shift.find({ employee: employee._id, date: { $gte: effectiveDate, $lte: horizonOf(effectiveDate) }, status: 'scheduled' }, 'date startTime endTime').lean(),
    Leave.countDocuments({ employee: employee._id, status: { $in: ['pending', 'approved'] }, endDate: { $gte: new Date(`${effectiveDate}T00:00:00`) } }),
  ]);
  const before = restDaysOn(schedules.get(String(employee._id)), employee.defaultRestDay, dayBefore);
  return {
    restDays,
    redirected: !sameRestDays(restDays, requestedRestDays ?? []),
    effectiveDate,
    reason,
    setup,
    defaultStart: firstMondayOfMonthAfter(today),
    before,
    unchanged: sameRestDays(before, restDays),
    replaces: sameDate ? [changeSummary(sameDate)] : [],
    pending: pending.map(changeSummary),
    conflicts: conflictsOn(queuedShifts, restDays),
    leavesAffected,
    recalcFrom: effectiveDate,
  };
}

router.post('/preview', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const employee = await loadEmployeeForChange(req.body.employee);
    res.json(await planChange(employee, req.body.restDays, req.body.effectiveDate));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
});

// Changes someone's recurring rest day from the Monday asked for (or
// startOfChange's default) — never earlier than tomorrow, so the past is
// never rewritten (restDaySchedule.js). A waiting change on that same day is
// replaced; waiting ones on other days stay. Their leaves from that day on
// are worked out again.
router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const employee = await loadEmployeeForChange(req.body.employee);
    const plan = await planChange(employee, req.body.restDays, req.body.effectiveDate);
    const row = await recordRestDayChange({
      employeeId: employee._id,
      newRestDay: plan.restDays,
      effectiveDate: plan.effectiveDate,
      source: 'manual',
      changedBy: req.user.employeeId ? req.user.employeeId._id : undefined,
      changedByEmail: req.user.email,
    });
    const leavesRecalculated = await recomputeLeavesAfterRestChange(employee._id, plan.recalcFrom);
    res.status(201).json({ ...plan, change: row, leavesRecalculated });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
});

// ວາງແຜນວັນພັກ: many people's rest days from one Monday, worked out in a
// handful of queries rather than a planChange per person. Each row says what
// saving it would do — 'change'; 'replace' (the change already waiting on
// that Monday); 'cancel' (back to what they rest on just before it, so the
// waiting change goes); 'none' — or, in `error`, why it can't be saved.
const MAX_PLAN_ROWS = 1000;
async function planMany(effectiveDate, changes, now = new Date()) {
  const today = toDateKey(now);
  if (!isDateKey(effectiveDate) || effectiveDate <= today) throw badRequest('ວັນທີ່ມີຜົນຕ້ອງເປັນມື້ອື່ນ ຫຼື ຫຼັງຈາກນັ້ນ');
  if (weekdayOf(effectiveDate) !== 1) throw badRequest('ວັນພັກໃໝ່ຕ້ອງເລີ່ມວັນຈັນ');
  if (!Array.isArray(changes) || !changes.length) throw badRequest('ບໍ່ມີການປ່ຽນໃຫ້ບັນທຶກ');
  if (changes.length > MAX_PLAN_ROWS) throw badRequest(`ບັນທຶກໄດ້ສູງສຸດ ${MAX_PLAN_ROWS} ຄົນຕໍ່ຄັ້ງ`);
  const requested = new Map();
  for (const c of changes) {
    const days = c?.restDays;
    if (!mongoose.isObjectIdOrHexString(c?.employee) || !Array.isArray(days) || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
      throw badRequest('ຂໍ້ມູນວັນພັກບໍ່ຖືກຕ້ອງ');
    }
    requested.set(String(c.employee), [...new Set(days)]);
  }
  const ids = [...requested.keys()];
  const dayBefore = addDays(effectiveDate, -1);
  const [employees, schedules, waitingRows, queuedShifts, leaves] = await Promise.all([
    Employee.find({ _id: { $in: ids } }, 'employeeCode firstName lastName position defaultRestDay restrictedRestDays restDayFallback').lean(),
    loadRestDaySchedules(ids, dayBefore, dayBefore),
    RestDayHistory.find({ employee: { $in: ids }, effectiveDate }).sort({ createdAt: 1 }).lean(),
    Shift.find({ employee: { $in: ids }, date: { $gte: effectiveDate, $lte: horizonOf(effectiveDate) }, status: 'scheduled' }, 'employee date startTime endTime').lean(),
    Leave.find({ employee: { $in: ids }, status: { $in: ['pending', 'approved'] }, endDate: { $gte: new Date(`${effectiveDate}T00:00:00`) } }, 'employee').lean(),
  ]);
  const positionIds = employees.map((e) => e.position).filter(Boolean);
  const positions = new Map((await Position.find({ _id: { $in: positionIds } }, 'restrictedRestDays restDayFallback').lean()).map((p) => [String(p._id), p]));
  const byId = new Map(employees.map((e) => [String(e._id), e]));
  const waiting = new Map(waitingRows.map((r) => [String(r.employee), r]));
  const shiftsOf = new Map();
  for (const s of queuedShifts) shiftsOf.set(String(s.employee), [...(shiftsOf.get(String(s.employee)) ?? []), s]);
  const leavesOf = new Map();
  for (const l of leaves) leavesOf.set(String(l.employee), (leavesOf.get(String(l.employee)) ?? 0) + 1);

  const rows = ids.map((id) => {
    const employee = byId.get(id);
    if (!employee) return { employee: id, action: 'none', error: 'ບໍ່ພົບພະນັກງານ' };
    const base = { employee: id, employeeCode: employee.employeeCode ?? '', name: `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() };
    let restDays;
    try {
      restDays = resolveRestDayForPosition(mergeRestDayRule(employee, positions.get(String(employee.position))), requested.get(id));
    } catch (err) {
      return { ...base, action: 'none', error: err.message };
    }
    const before = restDaysOn(schedules.get(id), employee.defaultRestDay, dayBefore);
    const planned = waiting.get(id)?.newRestDay ?? before;
    let action = 'none';
    if (!sameRestDays(planned, restDays)) action = sameRestDays(before, restDays) ? 'cancel' : waiting.has(id) ? 'replace' : 'change';
    return {
      ...base,
      restDays,
      redirected: !sameRestDays(restDays, requested.get(id)),
      before,
      planned,
      action,
      conflicts: action === 'change' || action === 'replace' ? conflictsOn(shiftsOf.get(id) ?? [], restDays) : [],
      leavesAffected: action === 'none' ? 0 : leavesOf.get(id) ?? 0,
    };
  });
  return { effectiveDate, rows, errors: rows.filter((r) => r.error) };
}

router.post('/bulk/preview', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    res.json(await planMany(req.body.effectiveDate, req.body.changes));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
});

// Saves a plan — all of it or, when any row can't be saved, none of it.
router.post('/bulk', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const plan = await planMany(req.body.effectiveDate, req.body.changes);
    if (plan.errors.length) {
      return res.status(400).json({ message: `ບັນທຶກບໍ່ໄດ້ ${plan.errors.length} ຄົນ — ຍັງບໍ່ໄດ້ບັນທຶກຫຍັງ`, errors: plan.errors });
    }
    const todo = plan.rows.filter((r) => r.action !== 'none');
    const who = { changedBy: req.user.employeeId ? req.user.employeeId._id : undefined, changedByEmail: req.user.email };
    let leavesRecalculated = 0;
    // A few people at a time — each is independent of the others.
    for (let i = 0; i < todo.length; i += 10) {
      // eslint-disable-next-line no-await-in-loop
      const counts = await Promise.all(
        todo.slice(i, i + 10).map(async (r) => {
          await recordRestDayChange({ employeeId: r.employee, newRestDay: r.restDays, effectiveDate: plan.effectiveDate, source: 'plan', ...who });
          return r.leavesAffected ? recomputeLeavesAfterRestChange(r.employee, plan.effectiveDate) : 0;
        })
      );
      leavesRecalculated += counts.reduce((sum, n) => sum + n, 0);
    }
    res.json({
      effectiveDate: plan.effectiveDate,
      changed: todo.filter((r) => r.action !== 'cancel').length,
      cancelled: todo.filter((r) => r.action === 'cancel').length,
      leavesRecalculated,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
});

// Cancels a change that hasn't taken effect yet.
router.delete('/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const row = await RestDayHistory.findById(req.params.id);
    if (!row) return res.status(404).json({ message: 'Not found' });
    await cancelRestDayChange(row);
    const leavesRecalculated = await recomputeLeavesAfterRestChange(row.employee, row.effectiveDate);
    res.json({ id: req.params.id, leavesRecalculated });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
});

module.exports = router;
