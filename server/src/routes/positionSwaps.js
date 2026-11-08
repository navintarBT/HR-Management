const express = require('express');
const ScheduledPositionSwap = require('../models/ScheduledPositionSwap');
const { authenticate, requireRole } = require('../middleware/auth');
const { toDateKey } = require('../utils/attendanceProcessor');
const Position = require('../models/Position');
const { applyPositionSwap, revertPositionSwap, findUnrecordedSwaps, runDueScheduledSwaps, claimPendingSwap, runClaimedSwap, swapDetails } = require('../utils/positionSwap');

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
      const { movedFromA, movedFromB, movers } = await applyPositionSwap(positionA, positionB, effectiveDate);
      swap.movedFromA = movedFromA;
      swap.movedFromB = movedFromB;
      swap.movers = movers;
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

// Who a swap moves (or moved), from which side, and their shift and rest day
// before and after (utils/positionSwap.js swapDetails).
router.get('/:id/details', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const swap = await ScheduledPositionSwap.findById(req.params.id);
    if (!swap) return res.status(404).json({ message: 'Not found' });
    res.json(await swapDetails(swap));
  } catch (err) {
    next(err);
  }
});

// Swaps deleted from the history whose changes are still in place
// (utils/positionSwap.js findUnrecordedSwaps), with their positions' names.
router.get('/unrecorded', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const found = await findUnrecordedSwaps();
    const positions = await Position.find({ _id: { $in: found.flatMap((f) => [f.positionA, f.positionB, ...f.positions.map((p) => p.id)]) } }, 'name');
    const nameOf = new Map(positions.map((p) => [String(p._id), p.name]));
    res.json(
      found.map((f) => ({
        ...f,
        positionAName: nameOf.get(f.positionA) ?? '-',
        positionBName: nameOf.get(f.positionB) ?? '-',
        positions: f.positions.map((p) => ({ ...p, name: nameOf.get(p.id) ?? '-' })),
      }))
    );
  } catch (err) {
    next(err);
  }
});

// Puts one of those back on the list as applied, so it can be undone. Only what
// findUnrecordedSwaps finds can be put back: a record is never made up.
router.post('/restore', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { effectiveDate, positionA, positionB } = req.body ?? {};
    const pair = [String(positionA), String(positionB)].sort();
    const match = (await findUnrecordedSwaps()).find((f) => f.effectiveDate === effectiveDate && f.positionA === pair[0] && f.positionB === pair[1]);
    if (!match) return res.status(400).json({ message: 'ບໍ່ພົບການສະຫຼັບນີ້ໃນຂໍ້ມູນ ຫຼື ມີໃນປະຫວັດຢູ່ແລ້ວ' });
    if (match.ambiguous) return res.status(400).json({ message: 'ບອກບໍ່ໄດ້ແນ່ນອນວ່າແມ່ນ 2 ຕຳແໜ່ງໃດ — ກູ້ຄືນອັດຕະໂນມັດບໍ່ໄດ້' });
    // Whoever is in B now came from A, and the other way round.
    const nowIn = (id) => match.positions.find((p) => p.id === id)?.count ?? 0;
    const swap = await ScheduledPositionSwap.create({
      positionA: match.positionA,
      positionB: match.positionB,
      effectiveDate: match.effectiveDate,
      status: 'applied',
      appliedAt: match.firstAt ?? new Date(`${match.effectiveDate}T00:00:00`),
      createdByEmail: `${req.user.email} (ກູ້ຄືນລາຍການ)`,
      movedFromA: nowIn(match.positionB),
      movedFromB: nowIn(match.positionA),
    });
    const populated = await swap.populate(POPULATE);
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
});

// ຍ້ອນກັບ: undoes an applied swap as if it never happened (utils/positionSwap.js
// revertPositionSwap). Only the latest applied swap of either position — undoing
// an earlier one under a later one would move people the later one placed. Marked
// reverted in the same step as the check, so two clicks can't both run it.
router.post('/:id/revert', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const swap = await ScheduledPositionSwap.findById(req.params.id);
    if (!swap) return res.status(404).json({ message: 'Not found' });
    if (swap.status !== 'applied') return res.status(400).json({ message: 'ຍ້ອນກັບໄດ້ສະເພາະລາຍການທີ່ສະຫຼັບແລ້ວ' });
    const later = await ScheduledPositionSwap.exists({
      _id: { $ne: swap._id },
      status: 'applied',
      $or: [{ positionA: { $in: [swap.positionA, swap.positionB] } }, { positionB: { $in: [swap.positionA, swap.positionB] } }],
      $and: [{ $or: [{ effectiveDate: { $gt: swap.effectiveDate } }, { effectiveDate: swap.effectiveDate, appliedAt: { $gt: swap.appliedAt } }] }],
    });
    if (later) return res.status(400).json({ message: 'ມີການສະຫຼັບຕຳແໜ່ງນີ້ທີ່ໃໝ່ກວ່າ — ຍ້ອນກັບອັນໃໝ່ກວ່າກ່ອນ' });

    const claimed = await ScheduledPositionSwap.findOneAndUpdate(
      { _id: swap._id, status: 'applied' },
      { status: 'reverted', revertedAt: new Date(), revertedByEmail: req.user.email },
      { new: true }
    );
    if (!claimed) return res.status(400).json({ message: 'ຍ້ອນກັບໄດ້ສະເພາະລາຍການທີ່ສະຫຼັບແລ້ວ' });
    let result;
    try {
      result = await revertPositionSwap(claimed);
    } catch (err) {
      await ScheduledPositionSwap.updateOne({ _id: claimed._id }, { status: 'applied', $unset: { revertedAt: 1, revertedByEmail: 1 } });
      throw err;
    }
    // A record put back without its numbers gets them from who was moved back.
    if (claimed.movedFromA == null && claimed.movedFromB == null) {
      claimed.movedFromA = result.backFrom.A;
      claimed.movedFromB = result.backFrom.B;
      await claimed.save();
    }
    const populated = await claimed.populate(POPULATE);
    res.json({ swap: populated, ...result });
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
