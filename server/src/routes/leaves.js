const express = require('express');
const Leave = require('../models/Leave');
const AttendanceDaily = require('../models/AttendanceDaily');
const Shift = require('../models/Shift');
const { authenticate, requireRole } = require('../middleware/auth');
const { markLeave, recomputeDay, toDateKey } = require('../utils/attendanceProcessor');

const router = express.Router();

function hasCompletedOneYear(hireDate) {
  if (!hireDate) return false;
  const oneYearLater = new Date(hireDate);
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
  return new Date() >= oneYearLater;
}

function dateKeysInRange(startDate, endDate) {
  const keys = [];
  for (let d = new Date(startDate); d <= new Date(endDate); d.setDate(d.getDate() + 1)) {
    keys.push(toDateKey(d));
  }
  return keys;
}

// ມື້ທີ່ຕ້ອງຕັດເງີນ x1 / ປ are computed live, never hand-entered — a day that
// lands on the employee's own rest day was never really "taken off work" so
// it doesn't count toward either. Of what's left (billableDays): someone
// under 1 year of service gets no free days at all (x1 = full billableDays,
// ປ stays 0 since the grace rule doesn't apply to them yet); someone who's
// completed the year gets the first 3 days of THIS request free — ປ shows
// the pre-grace count, x1 shows what's left after subtracting those 3.
async function attachComputedDeduction(leaveDocs) {
  const leaves = leaveDocs.map((l) => (typeof l.toObject === 'function' ? l.toObject() : l));

  const employeeIds = [...new Set(leaves.map((l) => String(l.employee?._id ?? l.employee)).filter(Boolean))];
  const dateKeySet = new Set();
  for (const l of leaves) {
    if (!l.startDate || !l.endDate) continue;
    for (const k of dateKeysInRange(l.startDate, l.endDate)) dateKeySet.add(k);
  }

  const overrides = employeeIds.length
    ? await Shift.find({ employee: { $in: employeeIds }, date: { $in: [...dateKeySet] } }, 'employee date status')
    : [];
  const overrideMap = new Map(overrides.map((o) => [`${o.employee}_${o.date}`, o.status]));

  for (const leave of leaves) {
    const employee = leave.employee;
    if (!employee || typeof employee !== 'object' || !leave.startDate || !leave.endDate) continue;

    const dateKeys = dateKeysInRange(leave.startDate, leave.endDate);
    const restDays = dateKeys.filter((k) => {
      const overrideStatus = overrideMap.get(`${employee._id}_${k}`);
      if (overrideStatus) return overrideStatus === 'rest';
      const dow = new Date(`${k}T00:00:00`).getDay();
      return employee.defaultRestDay === dow;
    }).length;
    const billableDays = dateKeys.length - restDays;
    // Unconditional on tenure, unlike deductDaysX2 below — this feeds the
    // annual-balance columns (ລາໄປແລ້ວຈັກມື້/ລວມທັງໝົດ/ຍັງຈັກມື້), which count
    // against the employee's leave quota, not the salary-deduction grace rule.
    // A day that lands on their own rest day was never a real day off work,
    // so it shouldn't eat into that quota either.
    leave.billableDays = billableDays;

    if (!hasCompletedOneYear(employee.hireDate)) {
      leave.deductDaysX1 = billableDays;
      leave.deductDaysX2 = 0;
    } else {
      // First 3 billable days of the request are free; only days beyond
      // that get deducted. Must stay monotonic in billableDays — max(0, …)
      // rather than "= billableDays below the threshold," which used to
      // make x1 drop (e.g. 3 → 1) right as billableDays crossed from 3 to 4.
      leave.deductDaysX2 = billableDays;
      leave.deductDaysX1 = Math.max(0, billableDays - 3);
    }

    // ຕັດເງີນຈັກເທົ່າ works like OT's "pick a category, or set your own time" —
    // suggest an amount from the employee's monthly salary (÷30 days) × the
    // deductible days above, but only when nobody's actually chosen a number
    // yet; once an admin types one in (even 0), that explicit choice always
    // wins and is never overwritten by this suggestion again. Clearing the
    // field back to empty falls back to the suggestion once more.
    if (leave.deductAmount == null && employee.salary != null) {
      leave.deductAmount = Math.round((employee.salary / 30) * leave.deductDaysX1);
    }
  }

  return leaves;
}

function scopedQuery(req) {
  const { _start = 0, _end = 10, _sort = '_id', _order = 'asc', ...filters } = req.query;
  const query = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    query[key] = value;
  }
  if (req.user.role === 'employee') {
    query.employee = req.user.employeeId ? req.user.employeeId._id : null;
  }
  return { query, _start: Number(_start) || 0, _end: Number(_end) || 10, _sort, _order };
}

function validateLeavePayload(payload) {
  if (!payload.employee || !payload.startDate || !payload.endDate) {
    const err = new Error('employee, startDate, and endDate are required');
    err.status = 400;
    throw err;
  }

  if (new Date(payload.endDate) < new Date(payload.startDate)) {
    const err = new Error('End date cannot be before start date');
    err.status = 400;
    throw err;
  }
}

async function ensureNoOverlappingLeave(payload, currentId) {
  const query = {
    employee: payload.employee,
    status: { $in: ['pending', 'approved'] },
    startDate: { $lte: new Date(payload.endDate) },
    endDate: { $gte: new Date(payload.startDate) },
  };
  if (currentId) query._id = { $ne: currentId };

  const existing = await Leave.findOne(query);
  if (!existing) return;

  const err = new Error('Employee already has a pending or approved leave in this date range');
  err.status = 409;
  throw err;
}

async function markApprovedLeaveDays(leave) {
  for (let d = new Date(leave.startDate); d <= leave.endDate; d.setDate(d.getDate() + 1)) {
    // eslint-disable-next-line no-await-in-loop
    await markLeave(leave.employee, toDateKey(d));
  }
}

// Undoes markApprovedLeaveDays for one date — re-derives the day from real scan
// logs if there are any (rare: the employee actually scanned despite being on
// leave that day), otherwise the "leave" marking was the only thing there, so
// it's deleted outright rather than left behind as a stale AttendanceDaily row.
async function revertLeaveMarking(employeeId, dateKey) {
  const recomputed = await recomputeDay(employeeId, dateKey);
  if (!recomputed) {
    await AttendanceDaily.deleteOne({ employee: employeeId, date: dateKey, status: 'leave' });
  }
}

async function revertApprovedLeaveDays(leave) {
  for (let d = new Date(leave.startDate); d <= leave.endDate; d.setDate(d.getDate() + 1)) {
    // eslint-disable-next-line no-await-in-loop
    await revertLeaveMarking(leave.employee, toDateKey(d));
  }
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { query, _start, _end, _sort, _order } = scopedQuery(req);
    const [items, total] = await Promise.all([
      Leave.find(query)
        .populate({ path: 'employee', populate: 'department position' })
        .populate('approver')
        .sort({ [_sort]: _order === 'asc' ? 1 : -1 })
        .skip(_start)
        .limit(_end - _start),
      Leave.countDocuments(query),
    ]);
    res.set('X-Total-Count', String(total));
    res.json(await attachComputedDeduction(items));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const item = await Leave.findById(req.params.id).populate({ path: 'employee', populate: 'department position' }).populate('approver');
    if (!item) return res.status(404).json({ message: 'Not found' });
    const [withDeduction] = await attachComputedDeduction([item]);
    res.json(withDeduction);
  } catch (err) {
    next(err);
  }
});

// By the time a leave is entered here it's already been agreed in real life
// (a verbal/paper sign-off happened first, same reasoning as OT) — so it's
// created pre-approved instead of sitting in a "pending" state waiting for a
// redundant second approval. `approver` is whoever's logged in when it's an
// admin/manager filing it; a plain employee self-filing their own leave has
// no one to attribute the approval to, so it's left unset.
router.post('/', authenticate, async (req, res, next) => {
  try {
    const payload = { ...req.body };
    if (req.user.role === 'employee') {
      if (!req.user.employeeId) return res.status(400).json({ message: 'No employee profile linked to this account' });
      payload.employee = req.user.employeeId._id;
    }
    payload.status = 'approved';
    payload.approver = ['admin', 'manager'].includes(req.user.role) && req.user.employeeId ? req.user.employeeId._id : undefined;
    payload.decidedAt = new Date();
    validateLeavePayload(payload);
    await ensureNoOverlappingLeave(payload);
    const item = await Leave.create(payload);
    await markApprovedLeaveDays(item);
    const populated = await item.populate([{ path: 'employee', populate: 'department position' }, { path: 'approver' }]);
    const [withDeduction] = await attachComputedDeduction([populated]);
    res.status(201).json(withDeduction);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const item = await Leave.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });

    const isOwner = req.user.employeeId && item.employee.toString() === req.user.employeeId._id.toString();
    const isApprover = ['admin', 'manager'].includes(req.user.role);
    if (!isOwner && !isApprover) return res.status(403).json({ message: 'Forbidden' });
    if (isOwner && item.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be edited' });
    }

    const wasApproved = item.status === 'approved';
    const oldStartDate = item.startDate;
    const oldEndDate = item.endDate;

    const { type, startDate, endDate, reason } = req.body;
    // deductDaysX1/X2 are computed live (see attachComputedDeduction), never
    // taken from the request — only deductAmount/deductNote are still
    // hand-entered, so "present in the body" (even as an explicit null, e.g.
    // a cleared InputNumber) means "use this," not "??" — which would
    // wrongly keep the old value instead of letting a field clear to unset.
    const deductFields = {};
    for (const field of ['deductAmount', 'deductNote']) {
      deductFields[field] = field in req.body ? req.body[field] : item[field];
    }
    const nextPayload = {
      employee: item.employee,
      type: type ?? item.type,
      startDate: startDate ?? item.startDate,
      endDate: endDate ?? item.endDate,
      reason,
      ...deductFields,
    };
    validateLeavePayload(nextPayload);
    await ensureNoOverlappingLeave(nextPayload, item._id);
    Object.assign(item, nextPayload);
    await item.save();

    // An already-approved leave had its dates marked into AttendanceDaily —
    // if the dates just changed, that marking is now on the wrong days and
    // needs moving, the same way /approve marks them the first time.
    if (wasApproved && (toDateKey(oldStartDate) !== toDateKey(item.startDate) || toDateKey(oldEndDate) !== toDateKey(item.endDate))) {
      await revertApprovedLeaveDays({ employee: item.employee, startDate: oldStartDate, endDate: oldEndDate });
      await markApprovedLeaveDays(item);
    }

    const populated = await item.populate([{ path: 'employee', populate: 'department position' }, { path: 'approver' }]);
    const [withDeduction] = await attachComputedDeduction([populated]);
    res.json(withDeduction);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/approve', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const item = await Leave.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    if (item.status !== 'pending') return res.status(400).json({ message: 'Only pending requests can be approved' });

    item.status = 'approved';
    item.approver = req.user.employeeId ? req.user.employeeId._id : undefined;
    item.decidedAt = new Date();
    await item.save();
    await markApprovedLeaveDays(item);

    const populated = await item.populate([{ path: 'employee', populate: 'department position' }, { path: 'approver' }]);
    const [withDeduction] = await attachComputedDeduction([populated]);
    res.json(withDeduction);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/reject', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const item = await Leave.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    if (item.status !== 'pending') return res.status(400).json({ message: 'Only pending requests can be rejected' });

    item.status = 'rejected';
    item.approver = req.user.employeeId ? req.user.employeeId._id : undefined;
    item.decidedAt = new Date();
    await item.save();

    const populated = await item.populate([{ path: 'employee', populate: 'department position' }, { path: 'approver' }]);
    const [withDeduction] = await attachComputedDeduction([populated]);
    res.json(withDeduction);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const item = await Leave.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    // Deleting an approved leave shouldn't leave its days stuck showing "leave".
    if (item.status === 'approved') await revertApprovedLeaveDays(item);
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
