const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema(
  {
    employeeCode: { type: String, unique: true, sparse: true, trim: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    position: { type: mongoose.Schema.Types.ObjectId, ref: 'Position' },
    supervisor: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    positionHead: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    hireDate: { type: Date },
    terminationDate: { type: Date },
    terminationReason: { type: String, trim: true }, // captured when status transitions to "resigned"
    employmentType: { type: mongoose.Schema.Types.ObjectId, ref: 'EmploymentType' },
    status: { type: String, enum: ['draft', 'active', 'inactive', 'resigned', 'suspended'], default: 'active' },
    deviceUserId: { type: String, trim: true, unique: true, sparse: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    photoUrl: { type: String, trim: true },
    // The employee's normal recurring schedule — used to pre-fill the monthly
    // rest-day/shift table so admins only need to enter actual exceptions
    // (a one-off rest day or a different shift time) instead of every day.
    // Unlike Shift.category (a one-time prefill shortcut), this IS a live
    // link: editing the category's time later updates every employee that
    // references it. defaultShiftStart/End are the fallback for an employee
    // given a manual time with no matching category.
    defaultShiftCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'ShiftCategory' },
    defaultShiftStart: { type: String, trim: true }, // HH:mm
    defaultShiftEnd: { type: String, trim: true }, // HH:mm
    defaultRestDay: { type: Number, min: 0, max: 6 }, // 0 = Sunday .. 6 = Saturday
    salary: { type: Number, min: 0 },
    annualLeaveDays: { type: Number, min: 0 },
    // Individual override of Position.allowsSubstituteStatus — unset inherits
    // the position's setting; true/false forces it on/off for this one person
    // regardless of position (e.g. one server who also covers DJ nights).
    allowsSubstituteStatus: { type: Boolean },
    // Snapshot of defaultShiftCategory/Start/End taken the moment the
    // substitute rule turns on for this employee (see utils/substituteRule.js)
    // — restored when the rule turns back off, since that clears the live
    // fields with nothing else keeping a copy.
    substituteBackupShiftCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'ShiftCategory' },
    substituteBackupShiftStart: { type: String, trim: true },
    substituteBackupShiftEnd: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Employee', employeeSchema);
