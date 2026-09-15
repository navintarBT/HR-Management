const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'ກະລຸນາປ້ອນຊື່ພະແນກ'], unique: true, trim: true },
    head: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Department', departmentSchema);
