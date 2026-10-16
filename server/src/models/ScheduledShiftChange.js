const mongoose = require('mongoose');

// A standing change to an employee's own default shift (ย้ายกะล่วงหน้า) —
// distinct from ShiftSwapRequest/covering (another person standing in for one
// day) and from ScheduledPositionSwap (everyone in position A/B trading
// places) — this is just "this one employee's regular shift becomes X,
// starting this date." See utils/scheduledShiftChange.js for how it's applied.
const scheduledShiftChangeSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    newShiftCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'ShiftCategory', required: true },
    effectiveDate: { type: String, required: true }, // YYYY-MM-DD — the first day the new shift applies
    status: { type: String, enum: ['pending', 'applied', 'cancelled'], default: 'pending' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    createdByEmail: { type: String, trim: true },
    appliedAt: { type: Date },
  },
  { timestamps: true }
);

scheduledShiftChangeSchema.index({ employee: 1, effectiveDate: 1 });

module.exports = mongoose.model('ScheduledShiftChange', scheduledShiftChangeSchema);
