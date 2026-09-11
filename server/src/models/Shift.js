const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    position: { type: mongoose.Schema.Types.ObjectId, ref: 'Position', required: true },
    // Optional — just a data-entry shortcut that prefilled startTime/endTime at
    // creation time. Editing a category later does not retroactively change
    // shifts that already used it (same relationship as Employee.position).
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'ShiftCategory' },
    date: { type: String, required: true }, // YYYY-MM-DD
    startTime: { type: String, required: true }, // HH:mm
    endTime: { type: String, required: true }, // HH:mm
    note: { type: String, trim: true },
    status: { type: String, enum: ['scheduled', 'cancelled'], default: 'scheduled' },
  },
  { timestamps: true }
);

shiftSchema.index({ employee: 1, date: 1 });
shiftSchema.index({ date: 1 });

module.exports = mongoose.model('Shift', shiftSchema);
