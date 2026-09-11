const mongoose = require('mongoose');

const attendanceLogSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    deviceUserId: { type: String, trim: true },
    deviceId: { type: String, trim: true, default: 'SIMULATOR' },
    timestamp: { type: Date, required: true },
    type: { type: String, enum: ['in', 'out', 'auto'], default: 'auto' },
    raw: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

attendanceLogSchema.index({ employee: 1, timestamp: 1 });

module.exports = mongoose.model('AttendanceLog', attendanceLogSchema);
