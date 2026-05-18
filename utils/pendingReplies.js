"use strict";

/**
 * pendingReplies — stores one pending interactive step per sender.
 *
 * Each entry:  { handler: async (input, api, event) => void, expiresAt: number }
 *
 * The handler is set by a command and consumed by the main message loop.
 * Entries expire automatically after TTL_MS to avoid memory leaks.
 */

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const _pending = new Map();

/**
 * Register a pending handler for a sender.
 * @param {string} senderID
 * @param {{ handler: Function }} entry
 */
function set(senderID, entry) {
  _pending.set(senderID, { ...entry, expiresAt: Date.now() + TTL_MS });
}

/**
 * Retrieve a pending entry (returns null if missing or expired).
 * @param {string} senderID
 * @returns {{ handler: Function } | null}
 */
function get(senderID) {
  const entry = _pending.get(senderID);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    _pending.delete(senderID);
    return null;
  }
  return entry;
}

/**
 * Remove a pending entry.
 * @param {string} senderID
 */
function del(senderID) {
  _pending.delete(senderID);
}

/**
 * Check whether a sender has a pending entry.
 * @param {string} senderID
 * @returns {boolean}
 */
function has(senderID) {
  return get(senderID) !== null;
}

module.exports = { set, get, del, has };
