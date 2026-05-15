"use strict";

// Shared locked-nicknames store: Map<threadID, Map<userID, nickname>>
const lockedNicknames = new Map();

// Re-enforce locked nicknames every 60 seconds
setInterval(async () => {
  if (lockedNicknames.size === 0 || !global._botApi) return;
  for (const [threadID, members] of lockedNicknames.entries()) {
    for (const [userID, nickname] of members.entries()) {
      try {
        await global._botApi.nickname(nickname, threadID, userID);
      } catch {}
    }
  }
}, 60000);

module.exports = { lockedNicknames };
