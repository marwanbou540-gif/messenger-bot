"use strict";

const cooldowns = new Map();

let _cooldownMs = 3000;

function configure(ms) { _cooldownMs = Math.max(500, ms || 3000); }

function isOnCooldown(userID, cmd) {
  const last = cooldowns.get(`${userID}:${cmd}`);
  return last !== undefined && Date.now() - last < _cooldownMs;
}

function setCooldown(userID, cmd) {
  cooldowns.set(`${userID}:${cmd}`, Date.now());
}

function getRemainingCooldown(userID, cmd) {
  const last = cooldowns.get(`${userID}:${cmd}`);
  if (!last) return 0;
  return Math.max(0, _cooldownMs - (Date.now() - last));
}

function clearCooldown(userID, cmd) {
  if (cmd) cooldowns.delete(`${userID}:${cmd}`);
  else {
    for (const k of [...cooldowns.keys()]) {
      if (k.startsWith(`${userID}:`)) cooldowns.delete(k);
    }
  }
}

// Purge all expired entries every 5 minutes (was 2 min with wrong logic).
// Use a generous retention window so entries are kept long enough to be useful.
setInterval(() => {
  const now    = Date.now();
  const maxAge = Math.max(_cooldownMs * 2, 120_000); // at least 2× cooldown, min 2 min
  for (const [k, ts] of cooldowns) {
    if (now - ts >= maxAge) cooldowns.delete(k);
  }
}, 300_000).unref();

module.exports = { configure, isOnCooldown, setCooldown, getRemainingCooldown, clearCooldown };
