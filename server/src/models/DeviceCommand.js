const mongoose = require('mongoose');

// A command queued to be pushed to a physical ZKTeco terminal the next time
// it polls GET /iclock/getrequest (ADMS "push" protocol) — see routes/adms.js.
// Not yet verified against a real terminal (same caveat as the rest of the
// ADMS integration): implemented against the documented wire format, but
// firmware varies enough across models that this needs testing against an
// actual device before being relied on.
const deviceCommandSchema = new mongoose.Schema(
  {
    serialNumber: { type: String, required: true, trim: true },
    // Per-device sequential id the terminal echoes back in its ack (POST
    // /iclock/devicecmd) — how we match a Return code to the command that
    // caused it. Assigned from Device.cmdCounter, not from this collection's
    // own count, so it stays correct even if commands are deleted/pruned later.
    cmdId: { type: Number, required: true },
    command: { type: String, required: true, trim: true }, // e.g. "DATA DELETE USERINFO PIN=00212"
    // sha1 of `command` — template pushes are kilobytes long, so an identical
    // command already waiting is found by this instead of the full text.
    commandHash: { type: String },
    status: { type: String, enum: ['pending', 'sent', 'acked', 'failed'], default: 'pending' },
    returnCode: { type: String, trim: true },
    sentAt: { type: Date },
    ackedAt: { type: Date },
    // Context only — not used by the protocol itself, just so a human looking
    // at the queue later can tell what a given command was for.
    deviceUserId: { type: String, trim: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  },
  { timestamps: true }
);

deviceCommandSchema.index({ serialNumber: 1, status: 1 });
deviceCommandSchema.index({ serialNumber: 1, commandHash: 1, status: 1 });

module.exports = mongoose.model('DeviceCommand', deviceCommandSchema);
