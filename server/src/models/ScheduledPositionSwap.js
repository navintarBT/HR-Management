const mongoose = require('mongoose');

const scheduledPositionSwapSchema = new mongoose.Schema(
  {
    positionA: { type: mongoose.Schema.Types.ObjectId, ref: 'Position', required: true },
    positionB: { type: mongoose.Schema.Types.ObjectId, ref: 'Position', required: true },
    effectiveDate: { type: String, required: true }, // YYYY-MM-DD — who's actually in each position is resolved on this day, not frozen at creation time
    status: { type: String, enum: ['pending', 'applied', 'cancelled'], default: 'pending' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    // Fallback identity when the creating account has no linked Employee
    // (e.g. a pure admin login) — otherwise createdBy is left empty.
    createdByEmail: { type: String, trim: true },
    appliedAt: { type: Date },
    movedFromA: { type: Number },
    movedFromB: { type: Number },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ScheduledPositionSwap', scheduledPositionSwapSchema);
