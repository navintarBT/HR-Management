const mongoose = require('mongoose');

const attendanceDailySchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD (local calendar day)
    firstIn: { type: Date },
    lastOut: { type: Date },
    workedHours: { type: Number, default: 0 },
    lateMinutes: { type: Number, default: 0 },
    otHours: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['present', 'late', 'absent', 'leave', 'incomplete'],
      default: 'absent',
    },
  },
  { timestamps: true }
);

attendanceDailySchema.index({ employee: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceDaily', attendanceDailySchema);
