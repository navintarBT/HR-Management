const express = require('express');
const Overtime = require('../models/Overtime');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
const POPULATE = [{ path: 'employee', populate: 'department position' }, { path: 'proposedBy' }, { path: 'approver' }];

function scopedQuery(req) {
  const { _start = 0, _end = 10, _sort = '_id', _order = 'asc', ...filters } = req.query;
  const query = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    if (key.endsWith('_gte') || key.endsWith('_lte')) {
      const field = key.replace(/_(gte|lte)$/, '');
      const op = key.endsWith('_gte') ? '$gte' : '$lte';
      query[field] = { ...query[field], [op]: value };
    } else {
      query[key] = value;
    }
  }
  if (req.user.role === 'employee') {
    query.employee = req.user.employeeId ? req.user.employeeId._id : null;
  }
  return { query, _start: Number(_start) || 0, _end: Number(_end) || 10, _sort, _order };
}

function validatePayload(payload) {
  if (!payload.employee || !payload.date || !payload.startTime || !payload.endTime) {
    const err = new Error('ກະລຸນາປ້ອນ ພະນັກງານ, ວັນທີ່, ແລະ ເວລາໃຫ້ຄົບ');
    err.status = 400;
    throw err;
  }
  if (payload.approver && String(payload.employee) === String(payload.approver)) {
    const err = new Error('ຜູ້ອະນຸມັດ ຈະເປັນຄົນດຽວກັນກັບຄົນທີ່ເຮັດ OT ບໍ່ໄດ້');
    err.status = 400;
    throw err;
  }
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { query, _start, _end, _sort, _order } = scopedQuery(req);
    const [items, total] = await Promise.all([
      Overtime.find(query)
        .populate(POPULATE)
        .sort({ [_sort]: _order === 'asc' ? 1 : -1 })
        .skip(_start)
        .limit(_end - _start),
      Overtime.countDocuments(query),
    ]);
    res.set('X-Total-Count', String(total));
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const item = await Overtime.findById(req.params.id).populate(POPULATE);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// Overtime is proposed BY a manager/admin FOR an employee — not self-requested
// the way leave is, hence write access is admin/manager only, and `proposedBy`
// always comes from the logged-in user rather than being a pickable field.
// By the time it's entered here it's already been approved in real life (a
// verbal/paper sign-off happened first), so it's created pre-approved instead
// of sitting in a "pending" state waiting for a redundant second approval —
// `approver` defaults to whoever's logged in, but can be picked explicitly
// (the person who actually approved it may not be the one typing it in).
router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const payload = {
      ...req.body,
      status: 'approved',
      proposedBy: req.user.employeeId ? req.user.employeeId._id : undefined,
      approver: req.body.approver || (req.user.employeeId ? req.user.employeeId._id : undefined),
      decidedAt: new Date(),
    };
    validatePayload(payload);
    const item = await Overtime.create(payload);
    const populated = await item.populate(POPULATE);
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const item = await Overtime.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });

    const { employee, date, startTime, endTime, reason, note, approver } = req.body;
    const nextPayload = {
      employee: employee ?? item.employee,
      date: date ?? item.date,
      startTime: startTime ?? item.startTime,
      endTime: endTime ?? item.endTime,
      reason,
      note,
      approver: approver || null,
    };
    validatePayload(nextPayload);
    Object.assign(item, nextPayload);
    await item.save();
    const populated = await item.populate(POPULATE);
    res.json(populated);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/approve', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const item = await Overtime.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    if (item.status !== 'pending') return res.status(400).json({ message: 'Only pending requests can be approved' });

    item.status = 'approved';
    item.approver = req.user.employeeId ? req.user.employeeId._id : undefined;
    item.decidedAt = new Date();
    await item.save();

    const populated = await item.populate(POPULATE);
    res.json(populated);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/reject', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const item = await Overtime.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    if (item.status !== 'pending') return res.status(400).json({ message: 'Only pending requests can be rejected' });

    item.status = 'rejected';
    item.approver = req.user.employeeId ? req.user.employeeId._id : undefined;
    item.decidedAt = new Date();
    await item.save();

    const populated = await item.populate(POPULATE);
    res.json(populated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const item = await Overtime.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
