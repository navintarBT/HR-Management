const mongoose = require('mongoose');

// ປະຫວັດການແກ້ໄຂ on ແກ້ໄຂກະແບບກຸ່ມ: one row per round — each press of ຍ້າຍ
// on that page, whether it picked one person or many. Who, when, what it moved
// them to, and each person's department/position/shift before and after, with
// whether their move went through. Since the employee page only sets these when
// someone is first added (routes/employees.js), this is the record of every
// later move. See utils/bulkEditRounds.js. A ປັບເວລາສະເພາະມື້ round (one day's
// or a few days' working time for many people, utils/dayTimeRounds.js) is kept
// here too, day by day, and can be called off as a whole.
const sideSchema = new mongoose.Schema(
  {
    department: { type: String, default: null },
    position: { type: String, default: null },
    shift: { type: String, default: null },
  },
  { _id: false }
);

// ປັບເວລາສະເພາະມື້ only: one of the round's days for one person — set (with
// the Shift row it made, so the round can be called off), or left out and why.
const daySchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // YYYY-MM-DD
    status: { type: String, enum: ['ok', 'skipped', 'cancelled'], required: true },
    before: { type: String, default: null }, // the time they had that day, HH:mm-HH:mm
    message: { type: String, default: null },
    shift: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', default: null },
  },
  { _id: false }
);

const itemSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    // Kept as they were then, so the row still reads right after a rename.
    employeeCode: { type: String, default: null },
    name: { type: String, default: null },
    before: { type: sideSchema, default: () => ({}) },
    after: { type: sideSchema, default: undefined },
    // pending: sent but not confirmed yet (a round left unfinished keeps it).
    // cancelled: a ຍ້າຍກະ called off before its start date.
    status: { type: String, enum: ['pending', 'ok', 'failed', 'skipped', 'cancelled'], default: 'pending' },
    message: { type: String, default: null },
    days: { type: [daySchema], default: undefined },
  },
  { _id: false }
);

const bulkEditRoundSchema = new mongoose.Schema(
  {
    // 'dayTime': ປັບເວລາສະເພາະມື້ — the working time for chosen days only.
    action: { type: String, enum: ['department', 'position', 'shift', 'dayTime'], required: true },
    // Where it was done: ແກ້ໄຂກະແບບກຸ່ມ, or a single ຍ້າຍກະ from the employee
    // page or ຕັ້ງຄ່າແຜນວຽກ (the same move, recorded the same way).
    source: { type: String, enum: ['bulk', 'employee', 'planner'], default: 'bulk' },
    target: {
      id: { type: mongoose.Schema.Types.ObjectId, default: null },
      label: { type: String, default: null },
      // ຍ້າຍກະ: the day the new shift starts. ປັບເວລາສະເພາະມື້: the first day.
      effectiveDate: { type: String, default: null },
      // ປັບເວລາສະເພາະມື້ only: the last day (the same as the first for one day).
      toDate: { type: String, default: null },
    },
    byEmail: { type: String, trim: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    items: { type: [itemSchema], default: [] },
    finishedAt: { type: Date, default: null },
    // ປັບເວລາສະເພາະມື້ called off as a whole (ຍົກເລີກທັງຮອບ).
    cancelledAt: { type: Date, default: null },
    cancelledByEmail: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

bulkEditRoundSchema.index({ createdAt: -1 });
bulkEditRoundSchema.index({ 'items.employee': 1 });

module.exports = mongoose.model('BulkEditRound', bulkEditRoundSchema);
