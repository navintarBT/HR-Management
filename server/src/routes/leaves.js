const express = require('express');
const Leave = require('../models/Leave');
const { authenticate, requireRole } = require('../middleware/auth');
const { markLeave, toDateKey } = require('../utils/attendanceProcessor');

const router = express.Router();

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
  if (!payload.employee || !payload.type || !payload.startDate || !payload.endDate) {
    const err = new Error('employee, type, startDate, and endDate are required');
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

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { query, _start, _end, _sort, _order } = scopedQuery(req);
    const [items, total] = await Promise.all([
      Leave.find(query)
        .populate('employee approver')
        .sort({ [_sort]: _order === 'asc' ? 1 : -1 })
        .skip(_start)
        .limit(_end - _start),
      Leave.countDocuments(query),
    ]);
    res.set('X-Total-Count', String(total));
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const item = await Leave.findById(req.params.id).populate('employee approver');
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.post('/', authenticate, async (req, res, next) => {
  try {
    const payload = { ...req.body };
    if (req.user.role === 'employee') {
      if (!req.user.employeeId) return res.status(400).json({ message: 'No employee profile linked to this account' });
      payload.employee = req.user.employeeId._id;
    }
    payload.status = 'pending';
    validateLeavePayload(payload);
    await ensureNoOverlappingLeave(payload);
    const item = await Leave.create(payload);
    res.status(201).json(item);
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

    const { type, startDate, endDate, reason } = req.body;
    const nextPayload = {
      employee: item.employee,
      type: type ?? item.type,
      startDate: startDate ?? item.startDate,
      endDate: endDate ?? item.endDate,
      reason,
    };
    validateLeavePayload(nextPayload);
    await ensureNoOverlappingLeave(nextPayload, item._id);
    Object.assign(item, nextPayload);
    await item.save();
    res.json(item);
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

    const populated = await item.populate('employee approver');
    res.json(populated);
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

    const populated = await item.populate('employee approver');
    res.json(populated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const item = await Leave.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
