const mongoose = require('mongoose');

const positionSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'ກະລຸນາປ້ອນຊື່ຕຳແໜ່ງ'], unique: true, trim: true },
    departments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
    head: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Position', positionSchema);
