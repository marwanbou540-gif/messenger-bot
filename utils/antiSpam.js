"use strict";

const config = require("../config.json");

const cooldowns = new Map();

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
