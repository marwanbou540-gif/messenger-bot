"use strict";

const fs     = require("fs");
const path   = require("path");
const logger = require("./utils/logger");

const DATA_DIR   = path.resolve(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

const lockedThreads  = new Set();
const mutedThreads   = new Map();
const groupsCache    = new Map();
const activityLog    = [];
const lockViolations = [];
const autoReplies    = new Map();
const groupStats     = new Map();
const replyDelay     = { enabled: false, ms: 1500 };

function _serialize() {
  return {
    version:     2,
    savedAt:     Date.now(),
    lockedThreads: [...lockedThreads],
    mutedThreads:  [...mutedThreads.entries()].filter(([, exp]) => exp > Date.now()),
    groupsCache:   [...groupsCache.entries()],
    groupStats:    [...groupStats.entries()],
    replyDelay:    { ...replyDelay },
    autoReplies:   [...autoReplies.entries()].map(([tid, ar]) => [
      tid, { message: ar.message, enabled: ar.enabled, cooldownMs: ar.cooldownMs }
    ]),
  };
}

function save() {
  try {
    const tmp = STATE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(_serialize(), null, 2), "utf8");
    fs.renameSync(tmp, STATE_FILE);
    logger.debug("State", "State persisted to disk.");
  } catch (e) {
    logger.warn("State", `Persist failed: ${e.message}`);
  }
}

function load() {
  if (!fs.existsSync(STATE_FILE)) { logger.debug("State", "No saved state — fresh start."); return; }
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!data || data.version !== 2) { logger.warn("State", "State version mismatch — resetting."); return; }
    const now = Date.now();
    for (const tid of (data.lockedThreads || []))           lockedThreads.add(tid);
    for (const [tid, exp] of (data.mutedThreads || []))     if (exp > now) mutedThreads.set(tid, exp);
    for (const [tid, info] of (data.groupsCache || []))     groupsCache.set(tid, info);
    for (const [tid, stats] of (data.groupStats || []))     groupStats.set(tid, stats);
    for (const [tid, ar] of (data.autoReplies || []))       autoReplies.set(tid, { ...ar, lastSent: new Map() });
    if (data.replyDelay) { replyDelay.enabled = !!data.replyDelay.enabled; replyDelay.ms = data.replyDelay.ms || 1500; }
    logger.success("State", `Restored: ${lockedThreads.size} locked, ${mutedThreads.size} muted, ${groupsCache.size} groups.`);
  } catch (e) {
    logger.warn("State", `Could not load state: ${e.message} — starting fresh.`);
  }
}

const _saveTimer = setInterval(save, 120000);
_saveTimer.unref();
process.on("SIGINT",  save);
process.on("SIGTERM", save);
process.on("exit",    save);
load();

module.exports = { lockedThreads, mutedThreads, groupsCache, activityLog, lockViolations, autoReplies, groupStats, replyDelay, save, load };
