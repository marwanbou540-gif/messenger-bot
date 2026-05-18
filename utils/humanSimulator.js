"use strict";

/**
 * humanSimulator — makes the bot account look like a real human to Facebook.
 *
 * Behaviors simulated:
 *  - Periodic presence/online heartbeat
 *  - Simulated typing bursts in random active groups
 *  - Random "mark as read" on threads (mimics opening app)
 *  - Random inter-action delays with human-like jitter
 *  - Tracks and logs all simulated actions for dashboard display
 */

const logger = require("./logger");

const DEFAULT_CONFIG = {
  enabled:              true,
  presenceIntervalMs:   5 * 60 * 1000,    // send presence every 5 min
  typingIntervalMs:     8 * 60 * 1000,    // simulate typing every 8 min
  readIntervalMs:       3 * 60 * 1000,    // mark threads read every 3 min
  jitterMs:             30 * 1000,        // ±30s random jitter
  maxTypingMs:          4000,             // max typing simulation duration
  maxGroupsPerCycle:    3,                // max groups to interact with per cycle
};

let _api     = null;
let _cfg     = { ...DEFAULT_CONFIG };
let _timers  = [];
let _running = false;
let _stats   = {
  startedAt:       null,
  presenceSent:    0,
  typingSimulated: 0,
  threadsRead:     0,
  lastActionAt:    null,
  lastActionType:  null,
};

function _jitter(baseMs) {
  const j = _cfg.jitterMs || 30000;
  return baseMs + Math.floor((Math.random() * 2 - 1) * j);
}

function _randomGroupIDs(max) {
  try {
    const { groupsCache } = require("../state");
    const ids = [...groupsCache.keys()];
    if (ids.length === 0) return [];
    const shuffled = ids.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, max);
  } catch {
    return [];
  }
}

function _recordAction(type) {
  _stats.lastActionAt   = Date.now();
  _stats.lastActionType = type;
}

// ── Presence heartbeat ────────────────────────────────────────────────────────
function _schedulePresence() {
  const ms = _jitter(_cfg.presenceIntervalMs);
  const t = setTimeout(async () => {
    if (!_running || !_api) return;
    try {
      // Send a presence ping by marking own status as online
      if (typeof _api.setOptions === "function") {
        _api.setOptions({ online: true });
      }
      _stats.presenceSent++;
      _recordAction("presence");
      logger.debug("HumanSim", `Presence heartbeat sent (#${_stats.presenceSent})`);
    } catch (e) {
      logger.debug("HumanSim", `Presence error: ${e.message}`);
    }
    _schedulePresence();
  }, ms);
  t.unref();
  _timers.push(t);
}

// ── Typing simulation ─────────────────────────────────────────────────────────
function _scheduleTyping() {
  const ms = _jitter(_cfg.typingIntervalMs);
  const t = setTimeout(async () => {
    if (!_running || !_api) return;
    const groups = _randomGroupIDs(1);
    for (const threadID of groups) {
      try {
        const duration = 800 + Math.floor(Math.random() * _cfg.maxTypingMs);
        await _api.sendTypingIndicator(threadID);
        await new Promise(r => setTimeout(r, duration));
        await _api.sendTypingIndicator(threadID); // stop typing
        _stats.typingSimulated++;
        _recordAction("typing");
        logger.debug("HumanSim", `Typing simulated in ${threadID} for ${duration}ms`);
      } catch (e) {
        logger.debug("HumanSim", `Typing sim error in ${threadID}: ${e.message}`);
      }
    }
    _scheduleTyping();
  }, ms);
  t.unref();
  _timers.push(t);
}

// ── Mark threads as read ──────────────────────────────────────────────────────
function _scheduleRead() {
  const ms = _jitter(_cfg.readIntervalMs);
  const t = setTimeout(async () => {
    if (!_running || !_api) return;
    const groups = _randomGroupIDs(_cfg.maxGroupsPerCycle);
    for (const threadID of groups) {
      try {
        await _api.markAsRead(threadID);
        _stats.threadsRead++;
        _recordAction("markRead");
        logger.debug("HumanSim", `Marked ${threadID} as read`);
        // Human-like pause between reads
        await new Promise(r => setTimeout(r, 800 + Math.random() * 2000));
      } catch (e) {
        logger.debug("HumanSim", `markAsRead error ${threadID}: ${e.message}`);
      }
    }
    _scheduleRead();
  }, ms);
  t.unref();
  _timers.push(t);
}

// ── Public API ────────────────────────────────────────────────────────────────
function start(api, userConfig = {}) {
  if (_running) stop();
  _api     = api;
  _cfg     = { ...DEFAULT_CONFIG, ...userConfig };
  _running = true;
  _timers  = [];
  _stats   = {
    startedAt:       Date.now(),
    presenceSent:    0,
    typingSimulated: 0,
    threadsRead:     0,
    lastActionAt:    null,
    lastActionType:  null,
  };

  // Stagger starts so they don't all fire at once
  const p = setTimeout(() => _schedulePresence(), 60000);
  const ty = setTimeout(() => _scheduleTyping(), 90000);
  const r  = setTimeout(() => _scheduleRead(), 30000);
  p.unref(); ty.unref(); r.unref();
  _timers.push(p, ty, r);

  logger.info("HumanSim", `Started — presence:${_cfg.presenceIntervalMs / 60000}min, typing:${_cfg.typingIntervalMs / 60000}min, read:${_cfg.readIntervalMs / 60000}min`);
}

function stop() {
  _running = false;
  for (const t of _timers) clearTimeout(t);
  _timers = [];
  logger.info("HumanSim", "Stopped.");
}

function configure(newConfig) {
  _cfg = { ..._cfg, ...newConfig };
  if (_running && _api) {
    stop();
    start(_api, _cfg);
  }
}

function status() {
  return {
    running:  _running,
    config:   { ..._cfg },
    stats:    { ..._stats },
  };
}

module.exports = { start, stop, configure, status };
