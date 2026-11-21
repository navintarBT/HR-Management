const crypto = require('crypto');

// An employee app account's password, kept so an admin can read it back on
// ບັນຊີແອັບພະນັກງານ instead of setting a new one each time someone forgets
// (decided 22/11/2026). Sign-in still checks the bcrypt hash only; this copy is
// encrypted (AES-256-GCM) with a key from the server's own secret, so the
// database alone doesn't give the passwords away. A password typed before this
// existed can't be read from its hash — its copy is made at the next sign-in.
// Changing the secret (PASSWORD_VIEW_KEY, else JWT_SECRET) makes the copies
// unreadable: they show as unknown until the next sign-in or a new password.
function viewKey() {
  const secret = process.env.PASSWORD_VIEW_KEY || process.env.JWT_SECRET;
  return secret ? crypto.createHash('sha256').update(`romeo-hr:app-password-view:${secret}`).digest() : null;
}

function sealPassword(password) {
  const key = viewKey();
  if (!key || typeof password !== 'string' || !password) return undefined;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function openPassword(sealed) {
  const key = viewKey();
  if (!key || typeof sealed !== 'string') return null;
  const [version, iv, tag, data] = sealed.split(':');
  if (version !== 'v1' || !iv || !tag || !data) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { sealPassword, openPassword };
