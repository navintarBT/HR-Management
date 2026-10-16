const express = require('express');
const ScheduledShiftChange = require('../models/ScheduledShiftChange');
const Employee = require('../models/Employee');
const ShiftCategory = require('../models/ShiftCategory');
const { authenticate, requireRole } = require('../middleware/auth');
const { toDateKey } = require('../utils/attendanceProcessor');
const {
  pinNewScheduleForEffectiveDate,
  unpinScheduleForEffectiveDate,
  applyScheduledShiftChange,
  runDueScheduledShiftChanges,
} = require('../utils/scheduledShiftChange');

const router = express.Router();
const POPULATE = ['newShiftCategory', 'createdBy'];

router.get('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    // Cheap safety net so the list is never stale just because the interval
    // hasn't ticked yet — same pattern as GET /position-swaps.
    await runDueScheduledShiftChanges();
    const { employee, status } = req.query;
    const query = {};
    if (employee) query.employee = employee;
    if (status) query.status = status;
    const items = await ScheduledShiftChange.find(query).populate(POPULATE).sort({ effectiveDate: -1, createdAt: -1 });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { employee: employeeId, newShiftCategory, effectiveDate } = req.body;
    if (!employeeId || !newShiftCategory || !effectiveDate) {
      return res.status(400).json({ message: 'ກະລຸນາເລືອກພະນັກງານ, ກະໃໝ່ ແລະ ວັນທີ່ມີຜົນ' });
    }
    const [employee, category] = await Promise.all([Employee.findById(employeeId), ShiftCategory.findById(newShiftCategory)]);
    if (!employee) return res.status(404).json({ message: 'ບໍ່ພົບພະນັກງານ' });
    if (!category) return res.status(404).json({ message: 'ບໍ່ພົບກະ' });

    await pinNewScheduleForEffectiveDate(employee, category, effectiveDate);

    const todayKey = toDateKey(new Date());
    const isImmediate = effectiveDate <= todayKey;
    const change = await ScheduledShiftChange.create({
      employee: employeeId,
      newShiftCategory,
      effectiveDate,
      createdBy: req.user.employeeId ? req.user.employeeId._id : undefined,
      createdByEmail: req.user.email,
      status: isImmediate ? 'applied' : 'pending',
      appliedAt: isImmediate ? new Date() : undefined,
    });
    if (isImmediate) await applyScheduledShiftChange(change);

    const populated = await change.populate(POPULATE);
    res.status(201).json(populated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
});

// The only supported edit in v1 is cancelling a still-pending change — once
// applied/cancelled it's history, same rule as position swaps.
router.patch('/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    if (req.body.status !== 'cancelled') {
      return res.status(400).json({ message: 'ແກ້ໄຂໄດ້ສະເພາະການຍົກເລີກ' });
    }
    const change = await ScheduledShiftChange.findById(req.params.id);
    if (!change) return res.status(404).json({ message: 'Not found' });
    if (change.status !== 'pending') return res.status(400).json({ message: 'ຍົກເລີກໄດ້ສະເພາະລາຍການທີ່ຍັງບໍ່ທັນມີຜົນ' });
    change.status = 'cancelled';
    await change.save();
    await unpinScheduleForEffectiveDate(change.employee, change.effectiveDate);
    const populated = await change.populate(POPULATE);
    res.json(populated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const item = await ScheduledShiftChange.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
