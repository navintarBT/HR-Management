const express = require('express');
const RestDayHistory = require('../models/RestDayHistory');
const Employee = require('../models/Employee');
const Shift = require('../models/Shift');
const Leave = require('../models/Leave');
const { authenticate, requireRole } = require('../middleware/auth');
const { resolveRestDayForEmployee } = require('../utils/restDayRules');
const {
  loadRestDaySchedules,
  effectiveDateForChange,
  supersededChanges,
  recordRestDayChange,
  cancelRestDayChange,
  restDaysOn,
  sameRestDays,
} = require('../utils/restDaySchedule');
const { recomputeLeavesAfterRestChange } = require('../utils/leaveDeduction');
const { toDateKey } = require('../utils/attendanceProcessor');

const router = express.Router();
const isDateKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

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

// What saving `restDays` for `employee` would do — the rest days after the
// position's ຂໍ້ຈຳກັດວັນພັກ (redirected to its fallback, or refused), the
// day it would take effect and why, the waiting change(s) it replaces and
// those it leaves in place, queued shifts that would still bring them in on
// a new rest day, and how many leaves would be worked out again.
async function planChange(employee, requestedRestDays, now = new Date()) {
  const replaced = await supersededChanges(employee._id, now);
  const ignore = new Set(replaced.map((r) => String(r._id)));
  const restDays = await resolveRestDayForEmployee(employee, employee.position, requestedRestDays ?? []);
  const { effectiveDate, reason } = await effectiveDateForChange(employee, restDays, now, ignore);
  const today = toDateKey(now);
  const schedules = await loadRestDaySchedules([employee._id], effectiveDate, effectiveDate);
  const rows = (schedules.get(String(employee._id)) ?? []).filter((row) => !ignore.has(String(row._id)));
  const inForceThen = restDaysOn(rows, employee.defaultRestDay, effectiveDate);
  const horizon = toDateKey(new Date(new Date(`${effectiveDate}T00:00:00`).getTime() + 62 * 86400000));
  // Leaves are worked out again from the earliest day anything moves — a
  // replaced change may have started before this one does.
  const recalcFrom = [effectiveDate, ...replaced.map((r) => r.effectiveDate)].sort()[0];
  const [pending, queuedShifts, leavesAffected] = await Promise.all([
    RestDayHistory.find({ employee: employee._id, effectiveDate: { $gt: today }, _id: { $nin: [...ignore] } }).sort({ effectiveDate: 1 }).lean(),
    Shift.find({ employee: employee._id, date: { $gte: effectiveDate, $lte: horizon }, status: 'scheduled' }, 'date startTime endTime').lean(),
    Leave.countDocuments({ employee: employee._id, status: { $in: ['pending', 'approved'] }, endDate: { $gte: new Date(`${recalcFrom}T00:00:00`) } }),
  ]);
  const conflicts = queuedShifts
    .filter((s) => restDays.includes(new Date(`${s.date}T00:00:00`).getDay()))
    .map((s) => ({ date: s.date, startTime: s.startTime, endTime: s.endTime }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    restDays,
    redirected: !sameRestDays(restDays, requestedRestDays ?? []),
    effectiveDate,
    reason,
    unchanged: sameRestDays(inForceThen, restDays),
    replaces: replaced.map((p) => ({ _id: p._id, effectiveDate: p.effectiveDate, newRestDay: p.newRestDay })),
    pending: pending.map((p) => ({ _id: p._id, effectiveDate: p.effectiveDate, newRestDay: p.newRestDay })),
    conflicts,
    leavesAffected,
    recalcFrom,
  };
}

router.post('/preview', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const employee = await loadEmployeeForChange(req.body.employee);
    res.json(await planChange(employee, req.body.restDays));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
});

// Changes someone's recurring rest day. The day it takes effect is worked
// out here, never taken from the request: from tomorrow if that still leaves
// exactly one rest day this week, else from next Monday — the past is never
// rewritten (restDaySchedule.js). Their leaves from that day on are worked
// out again.
router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const employee = await loadEmployeeForChange(req.body.employee);
    const plan = await planChange(employee, req.body.restDays);
    for (const waiting of await supersededChanges(employee._id)) {
      // eslint-disable-next-line no-await-in-loop
      await cancelRestDayChange(waiting);
    }
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
