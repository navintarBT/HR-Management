const mongoose = require('mongoose');

// One row per (device, PIN) the device has actually reported as enrolled —
// built from parsing "table=BIODATA" uploads (see routes/adms.js), which is
// how a ZKTeco terminal answers a "DATA QUERY USERINFO" command. This is the
// registry that lets ตารางวันพัກ find PINs sitting on a scanner with no
// matching Employee.deviceUserId anymore (someone long gone, a test
// enrollment, etc.) — not a log of every upload, just the latest known state
// per (device, PIN), upserted each time that PIN shows up again.
const deviceEnrolledUserSchema = new mongoose.Schema(
  {
    serialNumber: { type: String, required: true, trim: true },
    pin: { type: String, required: true, trim: true },
    lastSeenAt: { type: Date, required: true },
  },
  { timestamps: true }
);

deviceEnrolledUserSchema.index({ serialNumber: 1, pin: 1 }, { unique: true });

module.exports = mongoose.model('DeviceEnrolledUser', deviceEnrolledUserSchema);
