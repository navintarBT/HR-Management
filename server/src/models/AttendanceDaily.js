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
    // The shift category's ນะโยบายมาช้า (graceMinutes) that was in effect
    // when this was last computed — lateMinutes itself is measured from the
    // exact shift start with no grace offset (see recomputeDay), so this is
    // purely for the UI to size its "ຊ້າ" vs "ຊ້າເກີນ X ນາທີ" label tiers
    // against whatever grace actually applies to this employee/day, without
    // re-resolving the category client-side. null when there's no resolvable
    // shift at all that day.
    graceMinutes: { type: Number, default: null },
    // Same idea as graceMinutes, for the top-severity tier boundary
    // (the category's severeLateMinutes) — "ຊ້າເກີນ X" on the UI switches to
    // this once lateMinutes passes it, instead of a hardcoded 1-hour mark.
    severeLateMinutes: { type: Number, default: null },
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
    // Set only when an admin/manager deliberately forced status='absent' as a
    // disciplinary action (see routes/attendanceActions.js mark-absent) even
    // though the employee may have actually scanned in — the reason given is
    // kept here so it reads back as "why", distinguishing this from a plain
    // no-show the absence sweep found on its own. null/unset for every other
    // status, including a real absence.
    disciplinaryNote: { type: String, trim: true, default: null },
    // Set only when an admin bulk-filled this day because the scanning system
    // itself was unavailable (power outage, server down, ...) — see
    // routes/attendanceActions.js bulk-mark-present. Distinct from
    // disciplinaryNote: this is standing in for a scan that should have
    // happened, not overriding one that did.
    autoFilledReason: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

attendanceDailySchema.index({ employee: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceDaily', attendanceDailySchema);
