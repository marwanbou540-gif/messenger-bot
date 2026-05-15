"use strict";

const config = require("../config.json");

module.exports = {
  name: "mute",
  aliases: ["unmute"],
  description: "Mute or unmute the bot in this thread for a duration. (Admin only)",
  usage: "mute [minutes] | unmute",
  category: "Group",
  adminOnly: true,

  async execute({ api, event, args, mutedThreads }) {
    const sub = (args[0] || "").toLowerCase();

    if (sub === "unmute" || sub === "0") {
      mutedThreads.delete(event.threadID);
      try { await api.muteThread(event.threadID, 0); } catch (_) {}
      return api.sendMessage("🔊 Bot unmuted in this thread.", event.threadID);
    }

    const minutes = parseInt(args[0]) || 60;
    const ms = minutes * 60 * 1000;
    mutedThreads.set(event.threadID, Date.now() + ms);

    try { await api.muteThread(event.threadID, minutes * 60); } catch (_) {}

    api.sendMessage(`🔇 Bot muted for ${minutes} minute(s) in this thread.`, event.threadID);
    setTimeout(() => mutedThreads.delete(event.threadID), ms);
  },
};
