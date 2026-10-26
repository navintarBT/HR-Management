const express = require('express');
const PayrollComment = require('../models/PayrollComment');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const POPULATE = [
  { path: 'author', select: 'firstName lastName employeeCode' },
  { path: 'replies.author', select: 'firstName lastName employeeCode' },
  { path: 'resolvedBy', select: 'firstName lastName employeeCode' },
  // The bell lists open threads from every month, not just the cells on
  // screen, so it needs the employee's name without a matching table row.
  { path: 'employee', select: 'firstName lastName employeeCode' },
];

const currentAuthor = (req) => ({
  author: req.user.employeeId ? req.user.employeeId._id : undefined,
  authorEmail: req.user.email,
});

// Applied to every document on the cell, not just one: cells commented before
// threads existed can hold several documents, and they share one status.
function statusUpdate(req, status) {
  if (status === 'open') return { $set: { status }, $unset: { resolvedAt: 1, resolvedBy: 1, resolvedByEmail: 1 } };
  const update = { $set: { status, resolvedAt: new Date(), resolvedByEmail: req.user.email } };
  if (req.user.employeeId) update.$set.resolvedBy = req.user.employeeId._id;
  else update.$unset = { resolvedBy: 1 };
  return update;
}

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
        .populate(POPULATE)
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

// Posting on a cell that already has a thread adds a reply to it instead of
// starting a second one. Any new message reopens the thread for review unless
// it's sent with `resolve: true` (ສົ່ງ ແລະ ຢືນຢັນ).
router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { employee, column, resolve } = req.body;
    const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    if (!employee || !column || !text) {
      return res.status(400).json({ message: 'ກະລຸນາປ້ອນຂໍ້ຄວາມ' });
    }
    let thread = await PayrollComment.findOne({ employee, column }).sort({ createdAt: 1 });
    if (thread) {
      await PayrollComment.updateOne({ _id: thread._id }, { $push: { replies: { text, ...currentAuthor(req), createdAt: new Date() } } });
    } else {
      thread = await PayrollComment.create({ employee, column, text, ...currentAuthor(req) });
    }
    await PayrollComment.updateMany({ employee, column }, statusUpdate(req, resolve === true ? 'resolved' : 'open'));
    const populated = await PayrollComment.findById(thread._id).populate(POPULATE);
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
});

// ຢືນຢັນ (status 'resolved') or reopen a cell's thread without posting.
router.patch('/status', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { employee, column, status } = req.body;
    if (!employee || !column || !['open', 'resolved'].includes(status)) {
      return res.status(400).json({ message: 'ຂໍ້ມູນບໍ່ຖືກຕ້ອງ' });
    }
    const result = await PayrollComment.updateMany({ employee, column }, statusUpdate(req, status));
    if (!result.matchedCount) return res.status(404).json({ message: 'Not found' });
    res.json({ matched: result.matchedCount });
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
