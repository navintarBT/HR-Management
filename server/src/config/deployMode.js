const path = require('path');

// The two ways this system runs (deploy/README.md):
//   online — API on Render, web app on Vercel, database on MongoDB Atlas
//   local  — everything on the shop's Windows server (deploy/windows), its
//            own MongoDB on the same disk
// DEPLOY_MODE in .env picks one, and whatever differs between them is decided
// here — moving between them is a settings change, not a code change. Unset,
// a server handing out the web app itself (CLIENT_DIST) counts as local.
function readMode() {
  const raw = String(process.env.DEPLOY_MODE || '').trim().toLowerCase();
  if (raw === 'online' || raw === 'local') return raw;
  return process.env.CLIENT_DIST ? 'local' : 'online';
}

const MODE = readMode();
const isLocal = MODE === 'local';

// The built web app this server hands out itself: local always (from
// client/dist unless CLIENT_DIST says otherwise); online it's on Vercel.
const clientDist =
  process.env.CLIENT_DIST || isLocal ? path.resolve(__dirname, '../..', process.env.CLIENT_DIST || '../client/dist') : null;

// Ceiling for the employees' photo evidence, in MB (utils/evidence.js): Atlas's
// free tier online, none on the shop's own disk. EVIDENCE_DB_LIMIT_MB overrides.
const EVIDENCE_LIMIT_DEFAULT_MB = isLocal ? 0 : 450;

module.exports = { MODE, isLocal, clientDist, EVIDENCE_LIMIT_DEFAULT_MB };
