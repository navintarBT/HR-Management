const express = require('express');
const Leave = require('../models/Leave');
const { authenticate, requireRole } = require('../middleware/auth');

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
    Object.assign(item, { type, startDate, endDate, reason });
    await item.save();
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/approve', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const item = await Leave.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', approver: req.user.employeeId ? req.user.employeeId._id : undefined, decidedAt: new Date() },
      { new: true }
    ).populate('employee approver');
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/reject', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const item = await Leave.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected', approver: req.user.employeeId ? req.user.employeeId._id : undefined, decidedAt: new Date() },
      { new: true }
    ).populate('employee approver');
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
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
