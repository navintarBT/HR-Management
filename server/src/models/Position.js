const mongoose = require('mongoose');

const positionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    level: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Position', positionSchema);
