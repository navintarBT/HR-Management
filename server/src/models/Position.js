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
  },
  { timestamps: true }
);

module.exports = mongoose.model('Position', positionSchema);
