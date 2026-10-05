const express = require('express');
const Shift = require('../models/Shift');
const Employee = require('../models/Employee');
const Leave = require('../models/Leave');
const { authenticate, requireRole } = require('../middleware/auth');
const { resolveRestDay, nearestDateForWeekday } = require('../utils/restDayRules');

const router = express.Router();

const SHIFT_POPULATE = [
  { path: 'employee', populate: 'department position' },
  { path: 'coveringFor', populate: 'department position' },
  'position',
  'category',
  'holiday',
];

function timesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

// A company-wide holiday closure (see holidays.js's applyRestDayToAll, which
// always tags the rows it creates with `holiday`) rests EVERYONE regardless
// of position — it isn't someone choosing their own day off, so it's exempt
// from a position's restricted-rest-days rule.
// Returns the date this one-off rest day should actually be saved under:
// unchanged unless the employee's position forbids that weekday and has a
// fallback configured, in which case it comes back shifted to the nearest
// date on the fallback weekday instead of being rejected.
async function ensurePersonalRestDayAllowed(employeeId, date, holidayId) {
  if (holidayId) return date;
  // Already on approved leave that day — this isn't a discretionary swap
  // away from a day the position needs staffed, since they're not coming in
  // either way, so the restriction doesn't apply.
  const onLeave = await Leave.exists({
    employee: employeeId,
    status: 'approved',
    startDate: { $lte: new Date(`${date}T23:59:59.999`) },
    endDate: { $gte: new Date(`${date}T00:00:00.000`) },
  });
  if (onLeave) return date;
  const employee = await Employee.findById(employeeId, 'position');
  if (!employee?.position) return date;
  const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
  const resolvedDow = await resolveRestDay(employee.position, dayOfWeek);
  return resolvedDow === dayOfWeek ? date : nearestDateForWeekday(date, resolvedDow);
}

// Shared by the single PATCH and the bulk PATCH below: applies `changes` to
// one shift after checking it won't overlap another scheduled shift for the
// same employee/day. Throws { status, message } on conflict/not-found so both
// callers can turn that into the right HTTP response.
async function applyShiftUpdate(id, changes) {
  const current = await Shift.findById(id);
  if (!current) throw { status: 404, message: 'Not found' };

  const employee = changes.employee ?? current.employee;
  const date = changes.date ?? current.date;
  const startTime = changes.startTime ?? current.startTime;
  const endTime = changes.endTime ?? current.endTime;
  const status = changes.status ?? current.status;

  let effectiveChanges = changes;
  if (status !== 'rest') {
    const existing = await Shift.find({ employee, date, status: 'scheduled', _id: { $ne: current._id } });
    const conflict = existing.some((s) => timesOverlap(startTime, endTime, s.startTime, s.endTime));
    if (conflict) throw { status: 409, message: 'Employee already has an overlapping shift that day' };
  } else {
    const holidayId = changes.holiday ?? current.holiday;
    const effectiveDate = await ensurePersonalRestDayAllowed(employee, date, holidayId);
    if (effectiveDate !== date) effectiveChanges = { ...changes, date: effectiveDate };
  }

  Object.assign(current, effectiveChanges);
  await current.save();
  return current;
}

function buildQuery(query) {
  const { _start = 0, _end = 10, _sort = 'date', _order = 'asc', ...filters } = query;
  const mongoQuery = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    if (key.endsWith('_gte') || key.endsWith('_lte')) {
      const field = key.replace(/_(gte|lte)$/, '');
      const op = key.endsWith('_gte') ? '$gte' : '$lte';
      mongoQuery[field] = { ...mongoQuery[field], [op]: value };
    } else {
      mongoQuery[key] = value;
    }
  }
  return { mongoQuery, _start: Number(_start) || 0, _end: Number(_end) || 10, _sort, _order };
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { mongoQuery, _start, _end, _sort, _order } = buildQuery(req.query);
    if (req.user.role === 'employee') {
      mongoQuery.employee = req.user.employeeId ? req.user.employeeId._id : null;
    }
    const [items, total] = await Promise.all([
      Shift.find(mongoQuery)
        .populate(SHIFT_POPULATE)
        .sort({ [_sort]: _order === 'asc' ? 1 : -1 })
        .skip(_start)
        .limit(_end - _start),
      Shift.countDocuments(mongoQuery),
    ]);
    res.set('X-Total-Count', String(total));
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const query = { _id: req.params.id };
    if (req.user.role === 'employee') {
      query.employee = req.user.employeeId ? req.user.employeeId._id : null;
    }
    const item = await Shift.findOne(query).populate(SHIFT_POPULATE);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { employee, date, startTime, endTime, status, holiday, coveringFor } = req.body;
    if (coveringFor && String(coveringFor) === String(employee)) {
      return res.status(400).json({ message: 'ພະນັກງານທີ່ທຳແທນ ແລະ ຜູ້ຖືກແທນຕ້ອງເປັນຄົນລະຄົນກັນ' });
    }
    let effectiveDate = date;
    if (status !== 'rest') {
      const existing = await Shift.find({ employee, date, status: 'scheduled' });
      const conflict = existing.some((s) => timesOverlap(startTime, endTime, s.startTime, s.endTime));
      if (conflict) {
        return res.status(409).json({ message: 'Employee already has an overlapping shift that day' });
      }
    } else {
      effectiveDate = await ensurePersonalRestDayAllowed(employee, date, holiday);
    }
    const item = await Shift.create({ ...req.body, date: effectiveDate });
    const populated = await item.populate(SHIFT_POPULATE);
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
});

// Registered ahead of PATCH /:id so "bulk" isn't swallowed by the :id param.
router.patch('/bulk', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const updates = Array.isArray(req.body.updates) ? req.body.updates : [];
    const results = [];
    for (const { id, ...changes } of updates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const updated = await applyShiftUpdate(id, changes);
        results.push({ id, success: true, shift: updated });
      } catch (err) {
        results.push({ id, success: false, message: err.message || 'Update failed' });
      }
    }
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const updated = await applyShiftUpdate(req.params.id, req.body);
    const populated = await updated.populate('employee position category holiday');
    res.json(populated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
});

router.delete('/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const item = await Shift.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
