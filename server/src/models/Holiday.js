const mongoose = require('mongoose');

const holidaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true, trim: true }, // YYYY-MM-DD
    name: { type: String, required: true, trim: true }, // occasion, e.g. "ວັນປີໃໝ່"
  },
  { timestamps: true }
);

module.exports = mongoose.model('Holiday', holidaySchema);
