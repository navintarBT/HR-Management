const express = require('express');
const PayrollComment = require('../models/PayrollComment');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// Same access as the page itself (ສະຫຼຸບເງິນເດືອນ) — admin/manager only.
// Fetched in bulk once per page load, same as every other payroll-summary
// data source (shifts, leaves, overtime, attendance-daily) — comment volume
// is low enough that grouping client-side by employee+column is simpler and
// faster than a request per cell.
router.get('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { _start = 0, _end = 5000, _sort = 'createdAt', _order = 'asc', ...filters } = req.query;
    const query = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === '') continue;
      query[key] = value;
    }
    const start = Number(_start) || 0;
    const end = Number(_end) || start + 5000;
    const [items, total] = await Promise.all([
      PayrollComment.find(query)
        .populate('author', 'firstName lastName employeeCode')
        .sort({ [_sort]: _order === 'asc' ? 1 : -1 })
        .skip(start)
        .limit(end - start),
      PayrollComment.countDocuments(query),
    ]);
    res.set('X-Total-Count', String(total));
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { employee, column, text } = req.body;
    if (!employee || !column || !text || !String(text).trim()) {
      return res.status(400).json({ message: 'ກະລຸນາປ້ອນຂໍ້ຄວາມ' });
    }
    const comment = await PayrollComment.create({
      employee,
      column,
      text: String(text).trim(),
      author: req.user.employeeId ? req.user.employeeId._id : undefined,
      authorEmail: req.user.email,
    });
    const populated = await comment.populate('author', 'firstName lastName employeeCode');
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const item = await PayrollComment.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
