const mongoose = require('mongoose');

// A comment thread attached to one cell of ສະຫຼຸບເງິນເດືອນ — a reviewer leaves a
// note on a specific number (or a specific day in the 1-31 grid) for whoever
// maintains payroll to see and address. `column` is a flat string key
// identifying which cell, so one field covers both cell kinds the page has:
//   - a day-grid cell: `day:YYYY-MM-DD`
//   - a summary column: `<columnName>:<rangeStartKey>_<rangeEndKey>`, e.g.
//     `workDays:2026-10-01_2026-10-31` — the range is part of the key because
//     the same column means a different number for a different month.
const payrollCommentSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    column: { type: String, required: true, trim: true },
    text: { type: String, required: true, trim: true },
    // Whoever was logged in when it was posted. author only resolves to a
    // name when that account is linked to an Employee profile — authorEmail
    // is always set from the account's login email, same fallback pattern as
    // RestDayHistory.changedByEmail.
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    authorEmail: { type: String, trim: true },
  },
  { timestamps: true }
);

payrollCommentSchema.index({ employee: 1, column: 1 });

module.exports = mongoose.model('PayrollComment', payrollCommentSchema);
