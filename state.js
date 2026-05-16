"use strict";

const lockedThreads = new Set();
const mutedThreads  = new Map();
const groupsCache   = new Map(); // threadID -> { name, memberCount, lastSeen }
const activityLog   = [];        // { time, message }

module.exports = { lockedThreads, mutedThreads, groupsCache, activityLog };
