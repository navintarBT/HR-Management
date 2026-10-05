const mongoose = require('mongoose');

const shiftCategorySchema = new mongoose.Schema(
  {
    name: { type: String, trim: true }, // optional label, e.g. "ກະທ່ຽງ" — the time range is what must be unique, not the name
    startTime: { type: String, required: true }, // HH:mm, used to prefill a new shift's time
    endTime: { type: String, required: true }, // HH:mm
    color: { type: String, trim: true }, // optional hex, for chip coloring
    // Late-arrival policy for shifts created from this category — checked by
    // attendanceProcessor.recomputeDay against the employee's actual first scan.
    // Late by up to this many minutes shows the plain "ຊ້າ" label; beyond it
    // shows "ຊ້າເກີນ X ນາທີ" — no longer keeps someone classified as "present"
    // (see attendanceProcessor.recomputeDay: lateMinutes is measured from the
    // exact shift start with no grace offset).
    graceMinutes: { type: Number, default: 15, min: 0 },
    autoAbsentMinutes: { type: Number, min: 0 }, // late beyond this many minutes is recorded as "absent" instead of "late"; unset = never auto-absent
    severeLateMinutes: { type: Number, default: 60, min: 0 }, // late beyond this many minutes shows the most severe "ຊ້າເກີນ..." label
  },
  { timestamps: true }
);

module.exports = mongoose.model('ShiftCategory', shiftCategorySchema);
