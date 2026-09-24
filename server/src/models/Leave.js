const mongoose = require('mongoose');

const leaveSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    type: { type: String, enum: ['vacation', 'sick', 'personal'], default: 'vacation' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    reason: { type: String, trim: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    approver: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    decidedAt: { type: Date },
    // Payroll deduction bookkeeping for this leave — computed once (at
    // creation, or again on an edit that changes the dates) from the
    // employee's tenure/rest-day setup AT THAT TIME, then frozen on the
    // record — see computeDeductionFields in routes/leaves.js. Never
    // recomputed later just because the employee's status has since changed.
    billableDays: { type: Number, min: 0 }, // request span minus days that land on the employee's own rest day
    deductDaysX1: { type: Number, min: 0 }, // days actually deducted (billableDays minus the 3-day grace, once tenure applies)
    deductDaysX2: { type: Number, min: 0 }, // free grace days this request used, capped at 3 (0 if not yet eligible for the grace)
    // Rate tier — X0/X1/X2/X3 means 0x/1x/2x/3x the daily rate. X0 is forced
    // automatically whenever deductDaysX1 is 0 (still within the free days),
    // overriding any other choice; X1/X2/X3 are hand-picked once there are
    // actual days to deduct. The resulting money figure (deductAmountTotal)
    // is NOT stored: it's (employee's current salary ÷ 30) × deductDaysX1 ×
    // this multiplier, computed fresh on every read in routes/leaves.js's
    // attachDeductionAmount.
    deductAmount: { type: String, enum: ['X0', 'X1', 'X2', 'X3'] },
    deductNote: { type: String, trim: true },
    // Which specific dates in the request landed on a rest day, and which
    // kind — 'personal' (the employee's own recurring/one-off rest day,
    // ວັນພັກປະຈຳ) or 'holiday' (a company-wide closure, ວັນພັກຮ້ານ, with the
    // occasion's name). Computed alongside billableDays/deductDaysX1/X2 and
    // frozen the same way — see computeDeductionFields in routes/leaves.js.
    restDayOverlaps: [
      {
        _id: false,
        date: { type: String, required: true }, // YYYY-MM-DD
        type: { type: String, enum: ['personal', 'holiday'], required: true },
        holidayName: { type: String, trim: true },
      },
    ],
    // Set only when this request's date range crossed the employee's own
    // 1-year-tenure anniversary — the request is then split into two linked
    // documents sharing the same splitGroupId (one 'before', one 'after' the
    // anniversary), each computed with the tenure status that actually
    // applied to its own days. Editing or deleting either half cascades to
    // the other — see routes/leaves.js (applyDateChange, the DELETE handler).
    // null/unset for an ordinary, unsplit leave.
    splitGroupId: { type: mongoose.Schema.Types.ObjectId, default: null },
    splitPart: { type: String, enum: ['before', 'after'], default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Leave', leaveSchema);
