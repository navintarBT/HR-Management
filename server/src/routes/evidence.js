const express = require('express');
const mongoose = require('mongoose');
const ScanEvidence = require('../models/ScanEvidence');
const { authenticate, requireRole } = require('../middleware/auth');
const { storageState, serializeEvidence } = require('../utils/evidence');

const isDateKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// HR's side of the employees' photo evidence — ປະຫວັດການສະແກນ shows it on
// each day's cell.
const router = express.Router();

// Everyone's evidence in a date range (ປະຫວັດການສະແກນ's range), optionally
// one employee's.
router.get('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { from, to, employee } = req.query;
    if (!isDateKey(from) || !isDateKey(to) || to < from) return res.status(400).json({ message: 'from/to ຕ້ອງເປັນ YYYY-MM-DD' });
    const query = { date: { $gte: from, $lte: to } };
    if (typeof employee === 'string' && mongoose.isValidObjectId(employee)) query.employee = employee;
    const rows = await ScanEvidence.find(query).sort({ date: 1, kind: 1 });
    res.json(rows.map(serializeEvidence));
  } catch (err) {
    next(err);
  }
});

// How full the database is with photos (EVIDENCE_DB_LIMIT_MB).
router.get('/storage', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    res.json(await storageState({ fresh: true }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
