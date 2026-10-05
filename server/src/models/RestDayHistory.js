const mongoose = require('mongoose');

// One row per time an employee's recurring rest day (Employee.defaultRestDay)
// actually changes to a different value — written only on a real change (see
// routes/employees.js's PATCH handler), so there's no history before this
// feature existed and no noise from saves that touch other fields without
// actually moving the rest day.
const restDayHistorySchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    previousRestDay: { type: Number, min: 0, max: 6, default: null }, // null = had none set before
    newRestDay: { type: Number, min: 0, max: 6, default: null }, // null = cleared to none
    // Whoever was logged in when it changed. changedBy only resolves to a
    // name when that account is linked to an Employee profile (managers
    // usually are; a pure admin account often isn't) — changedByEmail is
    // always set from the account's login email, so there's still a usable
    // answer to "who changed this" even for an unlinked admin.
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    changedByEmail: { type: String, trim: true },
  },
  { timestamps: true }
);

restDayHistorySchema.index({ employee: 1, createdAt: -1 });

module.exports = mongoose.model('RestDayHistory', restDayHistorySchema);
