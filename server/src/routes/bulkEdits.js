const express = require('express');
const mongoose = require('mongoose');
const BulkEditRound = require('../models/BulkEditRound');
const Department = require('../models/Department');
const Position = require('../models/Position');
const ShiftCategory = require('../models/ShiftCategory');
const { authenticate, requireRole } = require('../middleware/auth');
const { sidesOf, markDone } = require('../utils/bulkEditRounds');

// ປະຫວັດການແກ້ໄຂ of ແກ້ໄຂກະແບບກຸ່ມ (models/BulkEditRound.js). The page opens a
// round before moving anyone, passes its id along with each person's move —
// PATCH /employees/:id for a department or position, POST
// /scheduled-shift-changes for a shift — which marks that person done, then
// closes the round with whoever didn't go through and why.
const router = express.Router();
const MAX_PEOPLE = 1000;
const isId = (v) => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v);

// Anyone signed in can read it (agreed 2026-11-13).
router.get('/', authenticate, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const query = {};
    if (['department', 'position', 'shift'].includes(req.query.action)) query.action = req.query.action;
    if (['bulk', 'employee', 'planner'].includes(req.query.source)) query.source = req.query.source;
    if (isId(req.query.employee)) query['items.employee'] = req.query.employee;
    const [data, total] = await Promise.all([
      BulkEditRound.find(query).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      BulkEditRound.countDocuments(query),
    ]);
    res.json({ data, total });
  } catch (err) {
    next(err);
  }
});

router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { action, target, employees, effectiveDate } = req.body ?? {};
    if (!['department', 'position', 'shift'].includes(action)) return res.status(400).json({ message: 'ບໍ່ຮູ້ຈັກປະເພດການແກ້ໄຂ' });
    // Department and position moves save on the employee, which only an admin can.
    if (action !== 'shift' && req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const ids = [...new Set(Array.isArray(employees) ? employees.filter(isId) : [])];
    if (!ids.length) return res.status(400).json({ message: 'ກະລຸນາເລືອກພະນັກງານ' });
    if (ids.length > MAX_PEOPLE) return res.status(400).json({ message: `ເລືອກໄດ້ສູງສຸດ ${MAX_PEOPLE} ຄົນຕໍ່ຮອບ` });
    if (!isId(target)) return res.status(400).json({ message: 'ກະລຸນາເລືອກປາຍທາງ' });
    if (action === 'shift' && !(typeof effectiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate))) {
      return res.status(400).json({ message: 'ກະລຸນາເລືອກວັນທີ່ມີຜົນ' });
    }

    let label = null;
    if (action === 'department') label = (await Department.findById(target, 'name'))?.name;
    if (action === 'position') label = (await Position.findById(target, 'name'))?.name;
    if (action === 'shift') {
      const category = await ShiftCategory.findById(target, 'name startTime endTime');
      label = category ? `${category.startTime}-${category.endTime}` : null;
    }
    if (!label) return res.status(404).json({ message: 'ບໍ່ພົບປາຍທາງ' });

    const sides = await sidesOf(ids);
    const missing = ids.filter((id) => !sides.has(id));
    if (missing.length) return res.status(404).json({ message: `ບໍ່ພົບພະນັກງານ ${missing.length} ຄົນ` });

    const round = await BulkEditRound.create({
      action,
      source: req.body?.source === 'employee' ? 'employee' : 'bulk',
      target: { id: target, label, effectiveDate: action === 'shift' ? effectiveDate : null },
      byEmail: req.user.email,
      by: req.user.employeeId ? req.user.employeeId._id : null,
      items: ids.map((id) => {
        const { employee, side } = sides.get(id);
        return {
          employee: employee._id,
          employeeCode: employee.employeeCode ?? null,
          name: `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() || null,
          before: side,
        };
      }),
    });
    res.status(201).json(round);
  } catch (err) {
    next(err);
  }
});

// Closes a round: whoever is still waiting gets what the page saw — didn't go
// through (and why), or left out on purpose (already on that shift). A move the
// page saw succeed but that wasn't marked (it can't be told apart otherwise) is
// read off the person as they are now.
router.post('/:id/finish', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ message: 'Not found' });
    const round = await BulkEditRound.findById(req.params.id);
    if (!round) return res.status(404).json({ message: 'Not found' });
    if (round.byEmail !== req.user.email && req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    if (round.finishedAt) return res.json(round);

    const results = Array.isArray(req.body?.results) ? req.body.results : [];
    const extra = round.action === 'shift' ? { shift: round.target.label } : {};
    for (const r of results) {
      if (!r || !isId(r.employee)) continue;
      const item = round.items.find((i) => String(i.employee) === r.employee);
      if (!item || item.status !== 'pending') continue;
      if (r.status === 'ok') {
        // eslint-disable-next-line no-await-in-loop
        await markDone(round._id, item.employee, extra);
      } else if (r.status === 'failed' || r.status === 'skipped') {
        // eslint-disable-next-line no-await-in-loop
        await BulkEditRound.updateOne(
          { _id: round._id, 'items.employee': item.employee },
          { $set: { 'items.$.status': r.status, 'items.$.message': typeof r.message === 'string' ? r.message.slice(0, 300) : null } }
        );
      }
    }
    const finished = await BulkEditRound.findByIdAndUpdate(round._id, { finishedAt: new Date() }, { new: true });
    res.json(finished);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
