"use strict";

const lockedThreads  = new Set();
const mutedThreads   = new Map(); // threadID -> expiresAt (ms)
const groupsCache    = new Map(); // threadID -> { name, memberCount, lastSeen }
const activityLog    = [];        // { time, message }
const lockViolations = [];        // { time, threadID, threadName, senderID, messagePreview }
const autoReplies    = new Map(); // threadID -> { message, enabled, cooldownMs, lastSent: Map }
const groupStats     = new Map(); // threadID -> { messageCount, commandCount, lastMessageAt }
const replyDelay     = { enabled: false, ms: 1500 }; // anti-ban reply delay

module.exports = { lockedThreads, mutedThreads, groupsCache, activityLog, lockViolations, autoReplies, groupStats, replyDelay };
