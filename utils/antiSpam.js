"use strict";

const config = require("../config.json");

const cooldowns = new Map();

// Periodically purge expired cooldown entries to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, last] of cooldowns.entries()) {
    if (now - last >= config.features.antiSpamCooldownMs) {
      cooldowns.delete(key);
    }
  }
}, 60000);

function isOnCooldown(userID, cmd) {
  const key = `${userID}:${cmd}`;
  const last = cooldowns.get(key);
  if (!last) return false;
  return Date.now() - last < config.features.antiSpamCooldownMs;
}

function setCooldown(userID, cmd) {
  cooldowns.set(`${userID}:${cmd}`, Date.now());
}

function getRemainingCooldown(userID, cmd) {
  const key = `${userID}:${cmd}`;
  const last = cooldowns.get(key);
  if (!last) return 0;
  const remaining = config.features.antiSpamCooldownMs - (Date.now() - last);
  return remaining > 0 ? remaining : 0;
}

module.exports = { isOnCooldown, setCooldown, getRemainingCooldown };
