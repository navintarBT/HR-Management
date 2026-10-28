const mongoose = require('mongoose');
const express = require('express');
const Leave = require('../models/Leave');
const Employee = require('../models/Employee');
const { authenticate, requireRole } = require('../middleware/auth');
const { refreshLeaveDay, toDateKey } = require('../utils/attendanceProcessor');
const { getAnniversary, computeDeductionFields } = require('../utils/leaveDeduction');

const router = express.Router();

// A leave whose range crosses the employee's own 1-year-tenure anniversary
// gets split into two linked documents (Leave.splitGroupId/splitPart) — one
// covering the days before the anniversary, one covering the anniversary day
// onward — so each side is judged by the tenure status that actually applied
// to ITS OWN days, instead of one all-or-nothing check for the whole range.
// This only matters once per employee: after their first anniversary,
// hasCompletedOneYear is true for every day from then on, so no later
// request can ever straddle anything again. Returns null when the range
// doesn't straddle (the normal, single-record path applies).
function splitIfStraddling(employee, startDate, endDate) {
  const anniversary = getAnniversary(employee.hireDate);
  if (!anniversary) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (start >= anniversary || end < anniversary) return null;

  const beforeEnd = new Date(anniversary);
  beforeEnd.setDate(beforeEnd.getDate() - 1);
  return {
    before: { startDate: toDateKey(start), endDate: toDateKey(beforeEnd) },
    after: { startDate: toDateKey(anniversary), endDate: toDateKey(end) },
  };
}

const DEDUCT_MULTIPLIER = { X0: 0, X1: 1, X2: 2, X3: 3 };

// The actual money figure is NOT frozen like billableDays/x1/ป — it's a
// straightforward multiplication of the frozen x1 day-count by whichever
// tier (X0/X1/X2/X3) is currently selected, times the employee's CURRENT
// daily rate (monthly salary ÷ 30). Recomputed fresh on every read so it
// always reflects the tier actually chosen right now and the employee's
// current pay — there's nothing here that should silently drift with the
// passage of time the way tenure status does, so there's no freezing
// concern to begin with. X0 is always exactly 0, salary or not.
function attachDeductionAmount(leaveDoc) {
  const leave = typeof leaveDoc.toObject === 'function' ? leaveDoc.toObject() : leaveDoc;
  const employee = leave.employee;
  const multiplier = DEDUCT_MULTIPLIER[leave.deductAmount];
  const salary = employee && typeof employee === 'object' ? employee.salary : null;
  if (multiplier === 0) {
    leave.deductAmountTotal = 0;
  } else if (multiplier != null && salary != null && leave.deductDaysX1 != null) {
    leave.deductAmountTotal = Math.round((salary / 30) * leave.deductDaysX1 * multiplier);
  } else {
    leave.deductAmountTotal = null;
  }
  return leave;
}

// `from`/`to` (YYYY-MM-DD) keep only leaves overlapping that range — the
// pages that used to fetch every leave ever filed (and silently lost the
// newest ones once there were more than their page size) ask for just the
// span they show. Bounds are built as local days, the same way leave dates
// are stored (local midnight), so a leave ending exactly on `from` still
// counts.
function scopedQuery(req) {
  const { _start = 0, _end = 10, _sort = '_id', _order = 'asc', from, to, ...filters } = req.query;
  const query = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    query[key] = value;
  }
  const isDateKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (isDateKey(from)) query.endDate = { $gte: new Date(`${from}T00:00:00`) };
  if (isDateKey(to)) query.startDate = { $lte: new Date(`${to}T23:59:59.999`) };
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

async function ensureNoOverlappingLeave(payload, excludeIds) {
  const query = {
    employee: payload.employee,
    status: { $in: ['pending', 'approved'] },
    startDate: { $lte: new Date(payload.endDate) },
    endDate: { $gte: new Date(payload.startDate) },
  };
  // A split pair's own two halves are contiguous (no gap) and belong to the
  // same logical request, so both of their ids must be excluded together —
  // not just the one currently being edited — or a request would spuriously
  // conflict with its own other half.
  const ids = excludeIds == null ? [] : Array.isArray(excludeIds) ? excludeIds : [excludeIds];
  if (ids.length) query._id = { $nin: ids };

  const existing = await Leave.findOne(query);
  if (!existing) return;

  const err = new Error('Employee already has a pending or approved leave in this date range');
  err.status = 409;
  throw err;
}

// Brings every day the given leave ranges touch in line with the leaves on
// file now (attendanceProcessor's refreshLeaveDay: ລາ where an approved leave
// covers the day, otherwise what the scans say, or nothing). Always run AFTER
// the leave changes are saved: working from the saved state is what keeps
// ranges that share days — a split pair's halves, an edit's old and new
// dates — from undoing each other's marks, which marking the new days and
// then clearing the old ones (or the other way round) did.
async function refreshLeaveDays(employeeId, ranges) {
  const days = new Set();
  for (const { startDate, endDate } of ranges) {
    for (let d = new Date(startDate); d <= new Date(endDate); d.setDate(d.getDate() + 1)) days.add(toDateKey(d));
  }
  for (const day of days) {
    // eslint-disable-next-line no-await-in-loop
    await refreshLeaveDay(employeeId, day);
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
    res.json(items.map(attachDeductionAmount));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const item = await Leave.findById(req.params.id).populate({ path: 'employee', populate: 'department position' }).populate('approver');
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(attachDeductionAmount(item));
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

    const employee = await Employee.findById(payload.employee);
    const split = splitIfStraddling(employee, payload.startDate, payload.endDate);

    if (split) {
      const groupId = new mongoose.Types.ObjectId();
      const beforePayload = { ...payload, ...split.before, splitGroupId: groupId, splitPart: 'before' };
      const afterPayload = { ...payload, ...split.after, splitGroupId: groupId, splitPart: 'after' };
      Object.assign(beforePayload, await computeDeductionFields(employee, beforePayload.startDate, beforePayload.endDate, false, beforePayload.deductAmount));
      Object.assign(afterPayload, await computeDeductionFields(employee, afterPayload.startDate, afterPayload.endDate, true, afterPayload.deductAmount));

      const [beforeItem, afterItem] = await Leave.create([beforePayload, afterPayload]);
      await refreshLeaveDays(beforeItem.employee, [beforeItem, afterItem]);
      const populated = await beforeItem.populate([{ path: 'employee', populate: 'department position' }, { path: 'approver' }]);
      return res.status(201).json(attachDeductionAmount(populated));
    }

    Object.assign(payload, await computeDeductionFields(employee, payload.startDate, payload.endDate, undefined, payload.deductAmount));

    const item = await Leave.create(payload);
    await refreshLeaveDays(item.employee, [item]);
    const populated = await item.populate([{ path: 'employee', populate: 'department position' }, { path: 'approver' }]);
    res.status(201).json(attachDeductionAmount(populated));
  } catch (err) {
    next(err);
  }
});

// Handles a date-changing edit on `item`, covering every combination of
// split-pair membership before/after the edit:
//  - a plain leave edited to now straddle the anniversary gets split into a
//    new linked pair (`item` becomes the 'before' half, a new sibling
//    document is created for the 'after' half);
//  - a split half whose newly-submitted range still straddles gets
//    re-split fresh (the old sibling is dropped and recreated — nothing
//    else references a Leave by id, so there's no identity to preserve);
//  - a split half whose newly-submitted range no longer straddles collapses
//    back into one plain leave (the sibling is deleted).
// The submitted startDate/endDate on `item` are treated as the new COMBINED
// range for the whole pair, not just item's own half — the edit form warns
// the admin of this when editing a split half. Returns the new 'after' half
// it created, if any; the caller brings the days in line afterwards.
async function applyDateChange(item, sibling, nextPayload, employee) {
  if (sibling) {
    await Leave.deleteOne({ _id: sibling._id });
    nextPayload.splitGroupId = null;
    nextPayload.splitPart = null;
  }
  // Worked out afresh below, so a note about an earlier rest-day
  // recalculation (leaveDeduction.js) no longer describes it.
  nextPayload.recalcNote = null;

  const split = splitIfStraddling(employee, nextPayload.startDate, nextPayload.endDate);
  if (!split) {
    Object.assign(nextPayload, await computeDeductionFields(employee, nextPayload.startDate, nextPayload.endDate, undefined, nextPayload.deductAmount));
    return null;
  }

  const groupId = new mongoose.Types.ObjectId();
  nextPayload.splitGroupId = groupId;
  nextPayload.splitPart = 'before';
  Object.assign(
    nextPayload,
    split.before,
    await computeDeductionFields(employee, split.before.startDate, split.before.endDate, false, nextPayload.deductAmount)
  );

  const afterPayload = {
    employee: item.employee,
    type: nextPayload.type,
    reason: nextPayload.reason,
    status: item.status,
    approver: item.approver,
    decidedAt: item.decidedAt,
    splitGroupId: groupId,
    splitPart: 'after',
    ...split.after,
  };
  Object.assign(afterPayload, await computeDeductionFields(employee, split.after.startDate, split.after.endDate, true, nextPayload.deductAmount));
  return Leave.create(afterPayload);
}

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

    const sibling = item.splitGroupId ? await Leave.findOne({ splitGroupId: item.splitGroupId, _id: { $ne: item._id } }) : null;

    // Every day this edit can change: the old dates of this leave and of its
    // split sibling, plus (below) the new ones.
    const touched = [{ startDate: item.startDate, endDate: item.endDate }];
    if (sibling) touched.push({ startDate: sibling.startDate, endDate: sibling.endDate });
    const oldStartDate = item.startDate;
    const oldEndDate = item.endDate;

    const { type, startDate, endDate, reason } = req.body;
    // deductAmount/deductNote are still hand-entered, so "present in the
    // body" (even as an explicit null) means "use this," not "??" — which
    // would wrongly keep the old value instead of letting the field clear
    // back to unset.
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
    await ensureNoOverlappingLeave(nextPayload, sibling ? [item._id, sibling._id] : item._id);

    const datesChanged = toDateKey(nextPayload.startDate) !== toDateKey(oldStartDate) || toDateKey(nextPayload.endDate) !== toDateKey(oldEndDate);
    if (datesChanged) {
      // Dates actually moved, so the day-count-dependent fields need
      // recomputing — using tenure status as of THIS edit (freezing again
      // from this point forward), not whatever it was at original creation.
      const employee = await Employee.findById(item.employee);
      const createdAfter = await applyDateChange(item, sibling, nextPayload, employee);
      if (createdAfter) touched.push(createdAfter);
    } else if (sibling && (sibling.reason !== nextPayload.reason || sibling.type !== nextPayload.type)) {
      // No date change, but a split pair's reason/type stay mirrored — it's
      // one real-life request split only for calculation purposes.
      sibling.reason = nextPayload.reason;
      sibling.type = nextPayload.type;
      await sibling.save();
    }

    Object.assign(item, nextPayload);
    await item.save();

    // ລາ marks moved to the new dates — from the saved state (refreshLeaveDays).
    if (datesChanged) await refreshLeaveDays(item.employee, [...touched, item]);

    const populated = await item.populate([{ path: 'employee', populate: 'department position' }, { path: 'approver' }]);
    res.json(attachDeductionAmount(populated));
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
    await refreshLeaveDays(item.employee, [item]);

    const populated = await item.populate([{ path: 'employee', populate: 'department position' }, { path: 'approver' }]);
    res.json(attachDeductionAmount(populated));
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
    res.json(attachDeductionAmount(populated));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const item = await Leave.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    // A split pair is one logical request — deleting one half without the
    // other would leave a dangling, incomplete record behind.
    const removed = [item];
    if (item.splitGroupId) {
      const sibling = await Leave.findOneAndDelete({ splitGroupId: item.splitGroupId, _id: { $ne: item._id } });
      if (sibling) removed.push(sibling);
    }
    // Their days shouldn't stay stuck showing ລາ.
    await refreshLeaveDays(item.employee, removed);
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
