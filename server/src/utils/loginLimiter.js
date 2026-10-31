// Employee codes are short and sequential, so anyone can guess whose account
// to try — wrong passwords (and wrong phone numbers when setting one) are
// counted per account and the account is held for a while after too many.
// In memory: one server process, and a restart only gives a few more tries.
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map();

function recentFailures(key, now = Date.now()) {
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

// Minutes left before `key` may try again, or 0 when it may.
function blockedFor(key, now = Date.now()) {
  const list = recentFailures(key, now);
  if (list.length < MAX_FAILURES) return 0;
  return Math.ceil((WINDOW_MS - (now - list[0])) / 60000);
}

function recordFailure(key, now = Date.now()) {
  const list = recentFailures(key, now);
  list.push(now);
  failures.set(key, list);
}

function clearFailures(key) {
  failures.delete(key);
}

module.exports = { blockedFor, recordFailure, clearFailures, MAX_FAILURES };
