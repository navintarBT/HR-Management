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
    // Sequential id handed out to each DeviceCommand queued for this device —
    // kept here (not derived from DeviceCommand's own count) so it stays
    // correct even after old commands are pruned.
    cmdCounter: { type: Number, default: 0 },
    // Debug aid — whatever a device sends to POST /iclock/cdata under any
    // table name other than ATTLOG (e.g. a response to a "DATA QUERY
    // USERINFO" command) used to be logged and discarded with nowhere to
    // inspect it afterward. Captured here instead so it can be read back
    // from the database — the exact table name/format a real terminal uses
    // for this isn't documented consistently enough to assume in advance.
    lastNonAttlogUpload: {
      table: { type: String, trim: true },
      body: { type: String },
      receivedAt: { type: Date },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Device', deviceSchema);
