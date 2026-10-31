const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    // Admins and managers sign in with this. An employee's own account (role
    // 'employee', the ROMEO app at /me) has none — they sign in with their
    // employee code — hence optional, unique only among accounts that have one.
    email: { type: String, trim: true, lowercase: true },
    // Empty on an employee account until the employee sets it themselves
    // (routes/auth.js employee-setup) and again after an admin resets it.
    passwordHash: { type: String },
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

module.exports = mongoose.model('User', userSchema);
