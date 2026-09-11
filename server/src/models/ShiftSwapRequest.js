const mongoose = require('mongoose');

const shiftSwapRequestSchema = new mongoose.Schema(
  {
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    fromShift: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', required: true },
    toEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    toShift: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift' },
    reason: { type: String, trim: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    approver: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    decidedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ShiftSwapRequest', shiftSwapRequestSchema);
