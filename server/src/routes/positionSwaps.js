const express = require('express');
const ScheduledPositionSwap = require('../models/ScheduledPositionSwap');
const { authenticate, requireRole } = require('../middleware/auth');
const { toDateKey } = require('../utils/attendanceProcessor');
const { applyPositionSwap, runDueScheduledSwaps, claimPendingSwap, runClaimedSwap } = require('../utils/positionSwap');

const router = express.Router();

const POPULATE = ['positionA', 'positionB', 'createdBy'];

router.get('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    // Cheap safety net so the list is never stale just because the interval
    // hasn't ticked yet — most of the time this finds nothing due.
    await runDueScheduledSwaps();
    const items = await ScheduledPositionSwap.find().populate(POPULATE).sort({ effectiveDate: -1, createdAt: -1 });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { positionA, positionB, effectiveDate } = req.body;
    if (!positionA || !positionB || positionA === positionB || !effectiveDate) {
      return res.status(400).json({ message: 'ກະລຸນາເລືອກ 2 ຕຳແໜ່ງທີ່ບໍ່ຊ້ຳກັນ ແລະ ວັນທີ່ຈະສະຫຼັບ' });
    }

    const todayKey = toDateKey(new Date());
    const isImmediate = effectiveDate <= todayKey;

    const swap = await ScheduledPositionSwap.create({
      positionA,
      positionB,
      effectiveDate,
      createdBy: req.user.employeeId ? req.user.employeeId._id : undefined,
      createdByEmail: req.user.email,
      status: isImmediate ? 'applied' : 'pending',
      appliedAt: isImmediate ? new Date() : undefined,
    });

    if (isImmediate) {
      const { movedFromA, movedFromB } = await applyPositionSwap(positionA, positionB, effectiveDate);
      swap.movedFromA = movedFromA;
      swap.movedFromB = movedFromB;
      await swap.save();
    }

    const populated = await swap.populate(POPULATE);
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
});

// Editing a still-pending swap (wrong date, wrong position picked) — only
// while it hasn't fired yet; once applied/cancelled it's history, not a draft.
router.patch('/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const swap = await ScheduledPositionSwap.findById(req.params.id);
    if (!swap) return res.status(404).json({ message: 'Not found' });
    if (swap.status !== 'pending') return res.status(400).json({ message: 'ແກ້ໄຂໄດ້ສະເພາະລາຍການທີ່ຍັງບໍ່ທັນສະຫຼັບ' });

    const { positionA, positionB, effectiveDate } = req.body;
    if (!positionA || !positionB || positionA === positionB || !effectiveDate) {
      return res.status(400).json({ message: 'ກະລຸນາເລືອກ 2 ຕຳແໜ່ງທີ່ບໍ່ຊ້ຳກັນ ແລະ ວັນທີ່ຈະສະຫຼັບ' });
    }

    const todayKey = toDateKey(new Date());
    const isImmediate = effectiveDate <= todayKey;

    // Same atomic claim as the scheduled run — it may have fired this swap
    // since the page loaded.
    let updated;
    if (isImmediate) {
      updated = await claimPendingSwap(swap._id, { positionA, positionB, effectiveDate });
      if (updated) await runClaimedSwap(updated);
    } else {
      updated = await ScheduledPositionSwap.findOneAndUpdate(
        { _id: swap._id, status: 'pending' },
        { positionA, positionB, effectiveDate },
        { new: true }
      );
    }
    if (!updated) return res.status(400).json({ message: 'ແກ້ໄຂໄດ້ສະເພາະລາຍການທີ່ຍັງບໍ່ທັນສະຫຼັບ' });
    const populated = await updated.populate(POPULATE);
    res.json(populated);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/cancel', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const swap = await ScheduledPositionSwap.findById(req.params.id);
    if (!swap) return res.status(404).json({ message: 'Not found' });
    // Only while still pending, checked in the same step as the change — a
    // scheduled run may be applying it right now.
    const cancelled = await ScheduledPositionSwap.findOneAndUpdate({ _id: swap._id, status: 'pending' }, { status: 'cancelled' }, { new: true });
    if (!cancelled) return res.status(400).json({ message: 'ຍົກເລີກໄດ້ສະເພາະລາຍການທີ່ຍັງບໍ່ທັນສະຫຼັບ' });
    const populated = await cancelled.populate(POPULATE);
    res.json(populated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const item = await ScheduledPositionSwap.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
