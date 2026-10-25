const mongoose = require('mongoose');

// One fingerprint or face template as a terminal uploaded it — kept so someone
// enrolled on one scanner can be pushed to the others (utils/deviceSync.js).
// `tmp` is biometric data: it's never selected by default, never sent to the
// browser, and is deleted together with the employee's scanner enrollment.
const biometricTemplateSchema = new mongoose.Schema(
  {
    pin: { type: String, required: true, trim: true },
    type: { type: Number, required: true }, // 1 fingerprint, 2 IR face, 9 visible-light face
    no: { type: Number, default: 0 }, // which finger, for fingerprints
    index: { type: Number, default: 0 },
    valid: { type: Number, default: 1 },
    duress: { type: Number, default: 0 },
    // Algorithm version — only a terminal running the same version can use it.
    majorVer: { type: Number },
    minorVer: { type: Number, default: 0 },
    format: { type: Number, default: 0 },
    tmp: { type: String, required: true, select: false },
    hash: { type: String, required: true },
    sourceSerial: { type: String, trim: true },
  },
  { timestamps: true }
);

biometricTemplateSchema.index({ pin: 1, type: 1, no: 1, index: 1, majorVer: 1 }, { unique: true });

module.exports = mongoose.model('BiometricTemplate', biometricTemplateSchema);
