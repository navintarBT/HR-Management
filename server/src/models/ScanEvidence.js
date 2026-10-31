const mongoose = require('mongoose');

// An employee's photo evidence for one shift (the ROMEO app at /me): one for
// coming in and one for going out, per shift-day — the same day key the
// scans are grouped under (attendanceProcessor.resolveShiftDateKey), so a
// night shift's 01:00 photo belongs to the shift that started the evening
// before. ປະຫວັດການສະແກນ shows them on that day's cell. The image itself is
// a separate EvidencePhoto, so listing these never loads image data.
const scanEvidenceSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD shift-day
    kind: { type: String, enum: ['in', 'out'], required: true },
    photo: { type: mongoose.Schema.Types.ObjectId, ref: 'EvidencePhoto', required: true },
    // When the photo was taken (the phone's clock — the camera moment, or a
    // picked photo's file time) and when it reached the server.
    takenAt: { type: Date },
    uploadedAt: { type: Date, required: true },
    // Uploaded after its shift-day had passed (ອັບໂຫຼດຍ້ອນຫຼັງ) — allowed any
    // time, flagged so HR sees it.
    backdated: { type: Boolean, default: false },
    // The same image file was already used as evidence for another shift.
    duplicate: { type: Boolean, default: false },
    note: { type: String, trim: true, default: '' },
    // Earlier photos for this slot, kept when the employee replaces one.
    replaced: [
      {
        _id: false,
        photo: { type: mongoose.Schema.Types.ObjectId, ref: 'EvidencePhoto' },
        takenAt: { type: Date },
        uploadedAt: { type: Date },
        replacedAt: { type: Date },
      },
    ],
    editedAt: { type: Date },
  },
  { timestamps: true }
);

scanEvidenceSchema.index({ employee: 1, date: 1, kind: 1 }, { unique: true });
scanEvidenceSchema.index({ date: 1 });

module.exports = mongoose.model('ScanEvidence', scanEvidenceSchema);
