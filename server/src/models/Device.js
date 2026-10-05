const mongoose = require('mongoose');

// One row per physical ZKTeco terminal that talks to us over ADMS. Tracks the
// sync "stamp" the protocol uses so a device only sends attendance punches it
// hasn't already delivered, instead of replaying its whole history on every
// handshake.
const deviceSchema = new mongoose.Schema(
  {
    serialNumber: { type: String, required: true, unique: true, trim: true },
    attStamp: { type: Number, default: 0 },
    opStamp: { type: Number, default: 0 },
    lastSeenAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Device', deviceSchema);
