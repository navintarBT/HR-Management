const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    // Admins and managers sign in with this. An employee's own account (role
    // 'employee', the ROMEO app at /me) has none — they sign in with their
    // username or employee code — hence optional, unique only among accounts that have one.
    email: { type: String, trim: true, lowercase: true },
    // An employee's own account only: the name they picked when they
    // registered in the app (routes/auth.js employee-register). They sign in
    // with it or with their employee code. Unique among accounts that have one.
    username: { type: String, trim: true, lowercase: true },
    // An employee account only: the employee code typed when it was
    // registered (or the one an admin made it on). Moving the account to
    // another code keeps it, so ບັນຊີແອັບພະນັກງານ shows in red the accounts whose
    // registered ID isn't the code they belong to now. None on accounts from
    // before 22/11/2026 — those were registered with their own code.
    registeredCode: { type: String, trim: true },
    // Empty on an employee account until the employee sets it themselves
    // (routes/auth.js employee-register) and again after an admin resets it.
    passwordHash: { type: String },
    // An employee account only: the same password, encrypted so an admin can
    // read it back on ບັນຊີແອັບພະນັກງານ (utils/passwordView.js). Never loaded
    // unless asked for by name.
    passwordView: { type: String, select: false },
    role: { type: String, enum: ['admin', 'manager', 'employee'], required: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    // Part of every token issued (`tv`); bumped when the password changes or
    // is reset, which ends every session signed in before that.
    tokenVersion: { type: Number, default: 0 },
    passwordSetAt: { type: Date },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userSchema.index({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: 'string' } } });

module.exports = mongoose.model('User', userSchema);
