"use strict";

const config = require("../config.json");

module.exports = {
  name: "announce",
  aliases: ["ann", "broadcast"],
  description: "Send a bold announcement message. (Admin only)",
  usage: "announce <message>",
  category: "Group",
  groupOnly: true,
  adminOnly: true,

  async execute({ api, event, args }) {
    const text = args.join(" ").trim();
    if (!text) {
      return api.sendMessage(`❌ Provide a message.\nUsage: ${config.prefix}announce <message>`, event.threadID);
    }

    const msg =
      `📢 ══ ANNOUNCEMENT ══ 📢\n\n` +
      `${text}\n\n` +
      `── From: Group Admin ──`;

    api.sendMessage(msg, event.threadID);
  },
};
