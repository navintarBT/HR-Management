const mongoose = require('mongoose');

// The image behind a ScanEvidence, kept in the database itself: the photo
// (resized on the phone before upload, ~1280px JPEG) and a small thumbnail
// for lists. Served only through routes/evidencePhoto.js, with a short-lived
// link — never as a public file.
const evidencePhotoSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    data: { type: Buffer, required: true },
    thumb: { type: Buffer, required: true },
    contentType: { type: String, default: 'image/jpeg' },
    size: { type: Number },
    // Fingerprint of the image file — tells when the same picture is used
    // again for another shift.
    sha256: { type: String, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EvidencePhoto', evidencePhotoSchema);
