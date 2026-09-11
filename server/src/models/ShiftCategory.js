const mongoose = require('mongoose');

const shiftCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true }, // e.g. "ກະທ່ຽງ", "ກະແລງ"
    startTime: { type: String, required: true }, // HH:mm, used to prefill a new shift's time
    endTime: { type: String, required: true }, // HH:mm
    color: { type: String, trim: true }, // optional hex, for chip coloring
    // Late-arrival policy for shifts created from this category — checked by
    // attendanceProcessor.recomputeDay against the employee's actual first scan.
    graceMinutes: { type: Number, default: 15, min: 0 }, // late by up to this many minutes still counts as "present"
    autoAbsentMinutes: { type: Number, min: 0 }, // late beyond this many minutes is recorded as "absent" instead of "late"; unset = never auto-absent
  },
  { timestamps: true }
);

module.exports = mongoose.model('ShiftCategory', shiftCategorySchema);
