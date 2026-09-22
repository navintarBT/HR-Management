const mongoose = require('mongoose');

const leaveSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    type: { type: String, enum: ['vacation', 'sick', 'personal'], default: 'vacation' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    reason: { type: String, trim: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    approver: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    decidedAt: { type: Date },
    // Payroll deduction bookkeeping for this leave — entered by hand by an
    // admin (this app has no salary/payroll rate policy encoded anywhere, so
    // it can't compute these itself), not derived from the leave's own dates.
    deductDaysX1: { type: Number, min: 0 }, // days deducted at the x1 rate
    deductDaysX2: { type: Number, min: 0 }, // days deducted at the x2 rate
    deductAmount: { type: Number, min: 0 }, // total money deducted
    deductNote: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Leave', leaveSchema);
