const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    // Not required for a 'rest'/'swapped' entry — neither has a position/time to assign.
    position: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Position',
      required: function () { return !['rest', 'swapped'].includes(this.status); },
    },
    // Optional — just a data-entry shortcut that prefilled startTime/endTime at
    // creation time. Editing a category later does not retroactively change
    // shifts that already used it (same relationship as Employee.position).
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'ShiftCategory' },
    date: { type: String, required: true }, // YYYY-MM-DD
    startTime: { type: String, required: function () { return !['rest', 'swapped'].includes(this.status); } }, // HH:mm
    endTime: { type: String, required: function () { return !['rest', 'swapped'].includes(this.status); } }, // HH:mm
    note: { type: String, trim: true },
    // 'rest' marks a one-off day-off override in the monthly schedule table —
    // distinct from 'cancelled', which means a previously scheduled shift fell
    // through. 'swapped' marks a day with no shift at all specifically because
    // a position swap's transition logic left this employee with nothing to
    // work that one day (see positionSwap.js) — kept distinct from 'rest' so
    // it's never mistaken for a personal day off in leave calculations.
    status: { type: String, enum: ['scheduled', 'cancelled', 'rest', 'swapped'], default: 'scheduled' },
    // Set only when this 'rest' entry was created/overwritten by a company-wide
    // holiday — lets deleting that Holiday clean up exactly the Shift rows it
    // created, without touching an employee's own unrelated rest-day picks.
    holiday: { type: mongoose.Schema.Types.ObjectId, ref: 'Holiday' },
    // Set only on a 'scheduled' entry created to cover someone else's shift —
    // `employee` is the one actually working it, `coveringFor` the one being covered.
    coveringFor: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    // Set by ແກ້ໄຂການສະແກນ when HR types a night through midnight on a day that
    // isn't an overnight shift: the out HR typed (HH:mm). While the row still
    // ends at that time, the day ends right at it — no allowance after it for a
    // late scan-out — so the next morning's own scans stay with the next day
    // (decided 22/11/2026). A row changed elsewhere since no longer matches it.
    scanFixOut: { type: String },
    // The times this row had before that night was typed over it (none: the row
    // was made for the night) — put back if the day is fixed again to a
    // same-day time.
    scanFixReplaced: {
      startTime: { type: String },
      endTime: { type: String },
    },
  },
  { timestamps: true }
);

shiftSchema.index({ employee: 1, date: 1 });
shiftSchema.index({ date: 1 });

module.exports = mongoose.model('Shift', shiftSchema);
