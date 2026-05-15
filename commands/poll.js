"use strict";

const config = require("../config.json");

module.exports = {
  name: "poll",
  aliases: ["vote"],
  description: "Create a poll in the group. (Admin only)",
  usage: "poll <question> | option1 | option2 | ...",
  category: "Group",
  groupOnly: true,
  adminOnly: true,

  async execute({ api, event, args }) {
    const raw = args.join(" ");
    const parts = raw.split("|").map(s => s.trim()).filter(Boolean);

    if (parts.length < 3) {
      return api.sendMessage(
        `❌ Usage: ${config.prefix}poll <question> | option1 | option2 | ...\n` +
        `Example: ${config.prefix}poll Best color? | Red | Blue | Green`,
        event.threadID
      );
    }

    const [question, ...options] = parts;

    try {
      await api.createPoll(question, event.threadID, options);
      api.sendMessage(`📊 Poll "${question}" created with ${options.length} options!`, event.threadID);
    } catch (e) {
      api.sendMessage(`❌ Error: ${e.message}`, event.threadID);
    }
  },
};
