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
    employmentType: { type: mongoose.Schema.Types.ObjectId, ref: 'EmploymentType' },
    status: { type: String, enum: ['draft', 'active', 'inactive', 'resigned', 'suspended'], default: 'active' },
    deviceUserId: { type: String, trim: true, unique: true, sparse: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    photoUrl: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Employee', employeeSchema);
