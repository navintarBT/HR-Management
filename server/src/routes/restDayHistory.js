const express = require('express');
const RestDayHistory = require('../models/RestDayHistory');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// Read-only — rows are written internally only, from routes/employees.js
// whenever Employee.defaultRestDay actually changes to a different value.
// There's deliberately no POST/PATCH/DELETE: this is an audit trail, not a
// resource anyone edits directly.
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

module.exports = router;
