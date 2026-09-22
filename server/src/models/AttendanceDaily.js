const mongoose = require('mongoose');

const attendanceDailySchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD (local calendar day)
    firstIn: { type: Date },
    lastOut: { type: Date },
    workedHours: { type: Number, default: 0 },
    // Length of the shift the employee was expected to work this day (0 when
    // there's no resolvable schedule, e.g. DJ/no-fixed-schedule positions) —
    // "ຊົ່ວໂມງທີ່ຕ້ອງເຮັດ" on ລາຍງານການສະແກນ, shown next to workedHours
    // ("ຊົ່ວໂມງທີ່ເຮັດແທ້") so a shortfall is visible at a glance.
    expectedHours: { type: Number, default: 0 },
    lateMinutes: { type: Number, default: 0 },
    // Minutes the last scan-out happened before the expected shift end (an
    // overnight shift's end time is understood to fall the next calendar
    // day) — "ກັບກ່ອນ" on ລາຍງານການສະແກນ. Purely informational; doesn't
    // affect `status` the way lateMinutes does.
    earlyLeaveMinutes: { type: Number, default: 0 },
    otHours: { type: Number, default: 0 },
    status: {
      type: String,
      // 'substituted' = someone else covered this shift for this employee, so
      // they never scan themselves — only settable on positions flagged
      // Position.allowsSubstituteStatus (e.g. DJ), see routes/attendanceActions.js.
      enum: ['present', 'late', 'absent', 'leave', 'incomplete', 'substituted'],
      default: 'absent',
    },
  },
  { timestamps: true }
);

attendanceDailySchema.index({ employee: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceDaily', attendanceDailySchema);
