const mongoose = require('mongoose');

const attendanceLogSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    deviceUserId: { type: String, trim: true },
    deviceId: { type: String, trim: true, default: 'SIMULATOR' },
    timestamp: { type: Date, required: true },
    type: { type: String, enum: ['in', 'out', 'auto'], default: 'auto' },
    raw: { type: mongoose.Schema.Types.Mixed },
    // A punch HR replaced — ແກ້ໄຂເວລາ, a disciplinary ຂາດ, ມາແທນ. Kept rather
    // than deleted, set aside from every calculation: when the terminal sends
    // the same punch again (ດຶງການສະແກນຍ້ອນຫຼັງ, a re-sent backlog) it's
    // recognized as already stored and stays out, instead of coming back as
    // new and mixing with what HR entered.
    voided: { type: Boolean, default: false },
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
