const mongoose = require('mongoose');

// What each mover's swap looked like, kept on the swap itself so ສະຫຼັບກະ can
// show it later — even after ຍ້ອນກັບ, which removes the shift and rest-day
// changes this is read from (utils/positionSwap.js describeSwapPeople).
const shiftSnapshotSchema = new mongoose.Schema(
  {
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'ShiftCategory', default: null },
    startTime: { type: String, default: null },
    endTime: { type: String, default: null },
  },
  { _id: false }
);
// The swap date itself: 'kept' (worked the old shift), 'extended' (worked
// through both halves of the day), 'off' (no shift that day), or 'set' (a
// schedule set by hand that day, which the swap left alone).
const swapDaySchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['kept', 'extended', 'off', 'set', 'rest'] },
    status: { type: String },
    startTime: { type: String, default: null },
    endTime: { type: String, default: null },
  },
  { _id: false }
);
const restDayChangeSchema = new mongoose.Schema(
  {
    before: { type: [Number], default: [] },
    after: { type: [Number], default: [] },
  },
  { _id: false }
);

const scheduledPositionSwapSchema = new mongoose.Schema(
  {
    positionA: { type: mongoose.Schema.Types.ObjectId, ref: 'Position', required: true },
    positionB: { type: mongoose.Schema.Types.ObjectId, ref: 'Position', required: true },
    effectiveDate: { type: String, required: true }, // YYYY-MM-DD — who's actually in each position is resolved on this day, not frozen at creation time
    status: { type: String, enum: ['pending', 'applied', 'cancelled', 'reverted'], default: 'pending' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    // Fallback identity when the creating account has no linked Employee
    // (e.g. a pure admin login) — otherwise createdBy is left empty.
    createdByEmail: { type: String, trim: true },
    appliedAt: { type: Date },
    movedFromA: { type: Number },
    movedFromB: { type: Number },
    // Who it moved and from which side, so it can be undone exactly
    // (utils/positionSwap.js revertPositionSwap). Swaps applied before this
    // existed have none; their movers are found from what the swap left behind.
    movers: [
      {
        _id: false,
        employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
        from: { type: String, enum: ['A', 'B'] },
        // Regular shift before and after; left out on swaps from before these existed.
        previous: { type: shiftSnapshotSchema, default: undefined },
        next: { type: shiftSnapshotSchema, default: undefined },
        swapDay: { type: swapDaySchema, default: undefined },
        restDay: { type: restDayChangeSchema, default: undefined },
      },
    ],
    // 'reverted': undone as if it never happened (ຍ້ອນກັບ on ສະຫຼັບກະ).
    revertedAt: { type: Date },
    revertedByEmail: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ScheduledPositionSwap', scheduledPositionSwapSchema);
