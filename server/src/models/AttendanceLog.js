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

// A device that buffers scans offline re-sends its whole unacknowledged backlog once
// the network returns — this guards against that batch creating duplicate punches if
// it happens to overlap with records we already stored (see routes/adms.js).
attendanceLogSchema.index(
  { deviceId: 1, deviceUserId: 1, timestamp: 1 },
  { unique: true, partialFilterExpression: { deviceUserId: { $type: 'string' } } }
);

module.exports = mongoose.model('AttendanceLog', attendanceLogSchema);
