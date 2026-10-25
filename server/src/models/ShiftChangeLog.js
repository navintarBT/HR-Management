const mongoose = require('mongoose');

const shiftSnapshotSchema = new mongoose.Schema(
  {
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'ShiftCategory', default: null },
    startTime: { type: String, default: null }, // HH:mm
    endTime: { type: String, default: null }, // HH:mm
  },
  { _id: false }
);

// One change to an employee's regular shift (defaultShiftCategory /
// defaultShiftStart/End) and the day it took effect. Attendance falls back to
// an employee's regular shift for any day without its own Shift row, and on
// its own that only knows the CURRENT setting — so the moment it changes,
// every earlier day is re-read as the new shift (the last night of a
// night→day move suddenly looks like a day shift, and its morning scan-out
// lands on the wrong day). utils/shiftHistory.js uses these rows to answer
// "what was their regular shift on date X" instead.
const shiftChangeLogSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    effectiveDate: { type: String, required: true }, // YYYY-MM-DD — first day of `next`
    previous: { type: shiftSnapshotSchema, default: () => ({}) },
    next: { type: shiftSnapshotSchema, default: () => ({}) },
    // What made the change: 'scheduled-change', 'position-swap', 'employee-edit', 'substitute-rule'.
    source: { type: String, trim: true },
  },
  { timestamps: true }
);

shiftChangeLogSchema.index({ employee: 1, effectiveDate: 1 }, { unique: true });

module.exports = mongoose.model('ShiftChangeLog', shiftChangeLogSchema);
