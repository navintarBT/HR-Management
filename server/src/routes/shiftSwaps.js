const express = require('express');
const ShiftSwapRequest = require('../models/ShiftSwapRequest');
const Shift = require('../models/Shift');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const SHIFT_POPULATE = { path: 'fromShift toShift', populate: 'employee position' };

function scopedQuery(req) {
  const { _start = 0, _end = 10, _sort = '_id', _order = 'asc', ...filters } = req.query;
  const query = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    query[key] = value;
  }
  if (req.user.role === 'employee') {
    const selfId = req.user.employeeId ? req.user.employeeId._id : null;
    query.$or = [{ requestedBy: selfId }, { toEmployee: selfId }];
  }
  return { query, _start: Number(_start) || 0, _end: Number(_end) || 10, _sort, _order };
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { query, _start, _end, _sort, _order } = scopedQuery(req);
    const [items, total] = await Promise.all([
      ShiftSwapRequest.find(query)
        .populate('requestedBy toEmployee approver')
        .populate(SHIFT_POPULATE)
        .sort({ [_sort]: _order === 'asc' ? 1 : -1 })
        .skip(_start)
        .limit(_end - _start),
      ShiftSwapRequest.countDocuments(query),
    ]);
    res.set('X-Total-Count', String(total));
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const item = await ShiftSwapRequest.findById(req.params.id)
      .populate('requestedBy toEmployee approver')
      .populate(SHIFT_POPULATE);
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
      payload.requestedBy = req.user.employeeId._id;

      const fromShift = await Shift.findById(payload.fromShift);
      if (!fromShift || fromShift.employee.toString() !== payload.requestedBy.toString()) {
        return res.status(403).json({ message: 'You can only request a swap on your own shift' });
      }
    }
    payload.status = 'pending';
    const item = await ShiftSwapRequest.create(payload);
    const populated = await item.populate([{ path: 'requestedBy toEmployee' }, SHIFT_POPULATE]);
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/approve', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const swap = await ShiftSwapRequest.findById(req.params.id);
    if (!swap) return res.status(404).json({ message: 'Not found' });
    if (swap.status !== 'pending') return res.status(400).json({ message: 'Only pending requests can be approved' });

    const fromShift = await Shift.findById(swap.fromShift);
    if (!fromShift) return res.status(404).json({ message: 'Shift no longer exists' });

    if (swap.toShift) {
      const toShift = await Shift.findById(swap.toShift);
      if (!toShift) return res.status(404).json({ message: 'Target shift no longer exists' });
      const temp = fromShift.employee;
      fromShift.employee = toShift.employee;
      toShift.employee = temp;
      await toShift.save();
    } else if (swap.toEmployee) {
      fromShift.employee = swap.toEmployee;
    } else {
      return res.status(400).json({ message: 'Request has no target employee or shift to assign' });
    }
    await fromShift.save();

    swap.status = 'approved';
    swap.approver = req.user.employeeId ? req.user.employeeId._id : undefined;
    swap.decidedAt = new Date();
    await swap.save();

    const populated = await ShiftSwapRequest.findById(swap._id)
      .populate('requestedBy toEmployee approver')
      .populate(SHIFT_POPULATE);
    res.json(populated);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/reject', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const item = await ShiftSwapRequest.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected', approver: req.user.employeeId ? req.user.employeeId._id : undefined, decidedAt: new Date() },
      { new: true }
    )
      .populate('requestedBy toEmployee approver')
      .populate(SHIFT_POPULATE);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const item = await ShiftSwapRequest.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
