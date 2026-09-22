const express = require('express');
const MedicineExpense = require('../models/MedicineExpense');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
const POPULATE = [{ path: 'employee', populate: 'department position' }];

function scopedQuery(req) {
  const { _start = 0, _end = 10, _sort = '_id', _order = 'asc', q, ...filters } = req.query;
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
  return { query, _start: Number(_start) || 0, _end: Number(_end) || 10, _sort, _order };
}

function validatePayload(payload) {
  if (!payload.employee || !payload.date) {
    const err = new Error('ກະລຸນາປ້ອນ ພະນັກງານ ແລະ ວັນທີ່ໃຫ້ຄົບ');
    err.status = 400;
    throw err;
  }
}

router.get('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { query, _start, _end, _sort, _order } = scopedQuery(req);
    const [items, total] = await Promise.all([
      MedicineExpense.find(query)
        .populate(POPULATE)
        .sort({ [_sort]: _order === 'asc' ? 1 : -1 })
        .skip(_start)
        .limit(_end - _start),
      MedicineExpense.countDocuments(query),
    ]);
    res.set('X-Total-Count', String(total));
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const item = await MedicineExpense.findById(req.params.id).populate(POPULATE);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// `date` is no longer entered by hand on the create form — it just stamps
// the day the claim was recorded, so it defaults to today when omitted.
router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const payload = { ...req.body, date: req.body.date || new Date() };
    validatePayload(payload);
    const item = await MedicineExpense.create(payload);
    const populated = await item.populate(POPULATE);
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const item = await MedicineExpense.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });

    const { employee, date, billDate, items: itemsDesc, billAmount, shopPayAmount, note } = req.body;
    const nextPayload = {
      employee: employee ?? item.employee,
      date: date ?? item.date,
      billDate,
      items: itemsDesc,
      billAmount,
      shopPayAmount,
      note,
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

router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const item = await MedicineExpense.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
