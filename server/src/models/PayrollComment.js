const mongoose = require('mongoose');

// A comment thread attached to one cell of ສະຫຼຸບເງິນເດືອນ — a reviewer leaves a
// note on a specific number (or a specific day in the 1-31 grid) for whoever
// maintains payroll to see and address. `column` is a flat string key
// identifying which cell, so one field covers both cell kinds the page has:
//   - a day-grid cell: `day:YYYY-MM-DD`
//   - a summary column: `<columnName>:<rangeStartKey>_<rangeEndKey>`, e.g.
//     `workDays:2026-10-01_2026-10-31` — the range is part of the key because
//     the same column means a different number for a different month.
//
// One thread per cell: the first message is the document itself (text/author)
// and every later message on that cell is pushed onto `replies`, so the bell
// shows one entry per cell instead of one per message. Cells commented before
// threads existed may still have several documents — the client merges them.
//
// `status` is the review step: a thread stays 'open' (ລໍຖ້າຢືນຢັນ, counted on
// the bell) until someone confirms it. Anyone with page access may confirm,
// the author included — staff sometimes share one login.

// author only resolves to a name when that account is linked to an Employee
// profile — authorEmail is always set from the account's login email, same
// fallback pattern as RestDayHistory.changedByEmail.
const replySchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    authorEmail: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const payrollCommentSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    column: { type: String, required: true, trim: true },
    text: { type: String, required: true, trim: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    authorEmail: { type: String, trim: true },
    replies: { type: [replySchema], default: [] },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    resolvedByEmail: { type: String, trim: true },
  },
  { timestamps: true }
);

payrollCommentSchema.index({ employee: 1, column: 1 });

module.exports = mongoose.model('PayrollComment', payrollCommentSchema);
