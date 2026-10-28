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
    // Updated on every /iclock/cdata handshake (findOrTouchDevice).
    lastSeenAt: { type: Date },
    // Separate from lastSeenAt — updated on every GET /iclock/getrequest hit,
    // whether or not anything was pending. cdata and getrequest are two
    // independent polling loops on a real terminal and can run on very
    // different schedules; a device stuck with queued commands never acked
    // could mean it isn't calling getrequest at all, or is calling it but
    // something else is wrong — this field is what tells the two apart
    // instead of just inferring from how long a DeviceCommand sits pending.
    lastGetRequestAt: { type: Date },
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
    // What the terminal reports about itself in its "options" upload (see
    // utils/zkProtocol.js parseDeviceOptions): model, firmware, algorithm
    // versions and how full it is. Empty until the first such upload.
    info: {
      deviceName: { type: String, trim: true },
      firmware: { type: String, trim: true },
      pushVersion: { type: String, trim: true },
      platform: { type: String, trim: true },
      ipAddress: { type: String, trim: true },
      fpVersion: { type: Number },
      faceVersion: { type: Number },
      multiBioDataSupport: { type: String, trim: true },
      userCount: { type: Number },
      maxUsers: { type: Number },
      fingerprintCount: { type: Number },
      maxFingerprints: { type: Number },
      faceCount: { type: Number },
      maxFaces: { type: Number },
      attLogCount: { type: Number },
      maxAttLogs: { type: Number },
    },
    infoUpdatedAt: { type: Date },
    // Opt-in per terminal: only these receive employees and templates pushed
    // from this system (utils/deviceSync.js). Off by default so a terminal
    // that's nearly full, or one being retired, never gets filled up by it.
    syncEnabled: { type: Boolean, default: false },
    // The /iclock endpoints can't authenticate a terminal, so any serial
    // number registers itself on first contact — a serial seen for the first
    // time is stored as false and nothing it sends (punches, users,
    // fingerprints/faces) is taken until an admin approves it on ເຄື່ອງສະແກນ.
    // Deliberately no schema default: terminals already registered before
    // this existed have no value and count as approved (utils/deviceApproval.js),
    // so switching this on stopped no real scanner.
    approved: { type: Boolean },
    // Last time a not-yet-approved terminal tried to upload punches or
    // templates (refused, so it keeps them and retries) — shown on ເຄື່ອງສະແກນ.
    blockedUploadAt: { type: Date },
    // The last /iclock/* request nothing here recognized — e.g. a terminal
    // still in access-control push mode — kept so the scanner page can show
    // it instead of it only ever reaching the server log.
    lastUnknownRequest: {
      method: { type: String, trim: true },
      path: { type: String, trim: true },
      body: { type: String },
      receivedAt: { type: Date },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Device', deviceSchema);
