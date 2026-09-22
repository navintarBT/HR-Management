const mongoose = require('mongoose');

const overtimeSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    date: { type: Date, required: true },
    startTime: { type: String, required: true }, // HH:mm
    endTime: { type: String, required: true }, // HH:mm
    proposedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, // whoever filed this OT — set from the logged-in user, not hand-picked
    reason: { type: String, trim: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    approver: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    decidedAt: { type: Date },
    note: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Overtime', overtimeSchema);
