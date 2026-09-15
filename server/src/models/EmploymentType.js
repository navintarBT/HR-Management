const mongoose = require('mongoose');

const employmentTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'ກະລຸນາປ້ອນຊື່ປະເພດການຈ້າງ'], unique: true, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EmploymentType', employmentTypeSchema);
