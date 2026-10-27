const mongoose = require('mongoose');

// One change to an employee's recurring rest day (Employee.defaultRestDay)
// and the day it takes effect — "from effectiveDate on, they rest on
// newRestDay". Every day is judged by the rest day in force ON that day
// (utils/restDaySchedule.js), so changing it never rewrites the past: before
// this, the field was simply overwritten and every earlier day — months
// already paid included — was re-read as the new rest day.
//
// A change made by hand starts on a Monday after today — by default the
// first Monday of the next month, as HR plans each month's rest days ahead —
// so every Monday-to-Sunday week rests on one pattern; someone with no rest
// day yet may start sooner (restDaySchedule.js startOfChange). Several can
// be waiting at once, one per date, and any not yet in effect can be
// cancelled. Employee.defaultRestDay holds whichever applies today.
const restDayHistorySchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    previousRestDay: { type: [{ type: Number, min: 0, max: 6 }], default: [] }, // [] = had none set before
    newRestDay: { type: [{ type: Number, min: 0, max: 6 }], default: [] }, // [] = cleared to none
    // YYYY-MM-DD — the first day newRestDay applies. Rows written before this
    // existed got the (local) day they were made, except the ones that first
    // set someone's rest day up: FROM_THE_START (restDaySchedule.js).
    effectiveDate: { type: String, trim: true },
    // 'manual' (ຕາຕະລາງວັນພັກ / the employee record), 'plan' (ວາງແຜນວັນພັກ),
    // 'position-swap', or 'migration' for rows recorded before
    // effectiveDate existed.
    source: { type: String, trim: true },
    // When Employee.defaultRestDay was switched to newRestDay — null while
    // the change is still waiting for its effectiveDate.
    appliedAt: { type: Date, default: null },
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
restDayHistorySchema.index({ employee: 1, effectiveDate: 1 });

module.exports = mongoose.model('RestDayHistory', restDayHistorySchema);
