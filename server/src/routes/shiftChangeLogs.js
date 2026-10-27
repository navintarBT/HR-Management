const express = require('express');
const ShiftChangeLog = require('../models/ShiftChangeLog');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// What a page showing days from `after` (YYYY-MM-DD) onward needs to tell
// which regular shift each of those days was really under (shiftOnDate in
// utils/shiftHistory.js, mirrored in client/src/utils/shiftHistory.ts): every
// change that took effect after it, plus each employee's latest change at or
// before it. Those give the same answer as the full history for any day from
// `after` on, without fetching every change ever made.
router.get('/', authenticate, requireRole('admin', 'manager', 'employee'), async (req, res, next) => {
  try {
    const { after } = req.query;
    if (typeof after !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(after)) {
      return res.status(400).json({ message: 'after ຕ້ອງເປັນ YYYY-MM-DD' });
    }
    const scope = req.user.role === 'employee' ? { employee: req.user.employeeId ? req.user.employeeId._id : null } : {};
    const fields = 'employee effectiveDate previous next';
    const [later, latestBefore] = await Promise.all([
      ShiftChangeLog.find({ ...scope, effectiveDate: { $gt: after } }, fields).lean(),
      ShiftChangeLog.aggregate([
        { $match: { ...scope, effectiveDate: { $lte: after } } },
        { $sort: { employee: 1, effectiveDate: -1 } },
        { $group: { _id: '$employee', doc: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$doc' } },
        { $project: { employee: 1, effectiveDate: 1, previous: 1, next: 1 } },
      ]),
    ]);
    res.json([...latestBefore, ...later]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
