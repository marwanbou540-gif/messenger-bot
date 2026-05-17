"use strict";

const logger = require("./logger");

// Map<threadID, Map<userID, nickname>>
const lockedNicknames = new Map();

let _apiRef     = null;
let _enforceTimer = null;
const ENFORCE_INTERVAL = 60000;

function setApi(api) {
  _apiRef = api;
  if (!_enforceTimer) {
    _enforceTimer = setInterval(_enforce, ENFORCE_INTERVAL);
    _enforceTimer.unref();
  }
}

async function _enforce() {
  if (!_apiRef || lockedNicknames.size === 0) return;
  for (const [threadID, members] of lockedNicknames.entries()) {
    for (const [userID, nickname] of members.entries()) {
      try {
        await _apiRef.nickname(nickname, threadID, userID);
      } catch (e) {
        logger.debug("NickLock", `Re-enforce failed [${threadID}/${userID}]: ${e.message}`);
      }
    }
  }
}

module.exports = { lockedNicknames, setApi };
