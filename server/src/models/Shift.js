const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    // Not required for a 'rest' entry — a day off has no position/time to assign.
    position: { type: mongoose.Schema.Types.ObjectId, ref: 'Position', required: function () { return this.status !== 'rest'; } },
    // Optional — just a data-entry shortcut that prefilled startTime/endTime at
    // creation time. Editing a category later does not retroactively change
    // shifts that already used it (same relationship as Employee.position).
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'ShiftCategory' },
    date: { type: String, required: true }, // YYYY-MM-DD
    startTime: { type: String, required: function () { return this.status !== 'rest'; } }, // HH:mm
    endTime: { type: String, required: function () { return this.status !== 'rest'; } }, // HH:mm
    note: { type: String, trim: true },
    // 'rest' marks a one-off day-off override in the monthly schedule table —
    // distinct from 'cancelled', which means a previously scheduled shift fell through.
    status: { type: String, enum: ['scheduled', 'cancelled', 'rest'], default: 'scheduled' },
  },
  { timestamps: true }
);

shiftSchema.index({ employee: 1, date: 1 });
shiftSchema.index({ date: 1 });

module.exports = mongoose.model('Shift', shiftSchema);
