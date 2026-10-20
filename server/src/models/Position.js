const mongoose = require('mongoose');

const positionSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'ກະລຸນາປ້ອນຊື່ຕຳແໜ່ງ'], unique: true, trim: true },
    departments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
    head: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    // Lets an employee in this position be marked "ມາແທນ" (substituted) on the
    // attendance grid instead of showing as absent, for positions where someone
    // else routinely covers the shift instead of the assigned person (e.g. DJ).
    allowsSubstituteStatus: { type: Boolean, default: false },
    // Days of week (0=Sun..6=Sat) this position is never allowed to pick as a
    // rest day — for roles that can't be off on the business's busiest days
    // (e.g. Fri/Sat/Sun at a bar). Only blocks *choosing* a rest day (the
    // recurring default and one-off planned picks); sick leave is a separate
    // workflow and is never affected by this.
    restrictedRestDays: [{ type: Number, min: 0, max: 6 }],
    // Where a rest day that lands on a restricted day gets redirected to
    // instead of being rejected outright — e.g. a morning-shift position that
    // can't spare people on Sat/Sun sends them to Fri instead. null means
    // "no fallback", so a restricted day is still just rejected (the original
    // behavior) until an admin sets one. Must not itself be inside
    // restrictedRestDays — enforced in routes/positions.js.
    restDayFallback: { type: Number, min: 0, max: 6, default: null },
    // Days of week (0=Sun..6=Sat) this position can never be absent on — for
    // roles the business can't afford to be short-staffed on (e.g. the
    // busiest night of the week). Unlike restrictedRestDays, this never
    // blocks anyone from having the day off: if it's already their recurring
    // rest day or a planned rest override, this rule simply doesn't apply
    // that day. It only matters for a day they were actually expected to
    // work and weren't there — see noAbsenceSeverity.
    noAbsenceDays: [{ type: Number, min: 0, max: 6 }],
    // Deduction tier (same X1/X2/X3 scale ການລາ already uses) charged when
    // someone in this position is absent on one of noAbsenceDays — folds
    // straight into the same x1/x2/x3 payroll totals a leave deduction
    // would, rather than being a separate kind of penalty. null = not set,
    // so noAbsenceDays has no effect yet even with days already picked
    // (same "configured but incomplete" safety as restDayFallback).
    noAbsenceSeverity: { type: String, enum: ['X2', 'X3'], default: null },
    // Deduction tier for an absence on any OTHER day — one NOT in
    // noAbsenceDays. Independent of noAbsenceDays/noAbsenceSeverity (no
    // "must set both" pairing — this applies with or without that list
    // configured at all). null = not set, so an ordinary-day absence still
    // isn't charged anything here, same as before this field existed.
    ordinaryAbsenceSeverity: { type: String, enum: ['X2', 'X3'], default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Position', positionSchema);
