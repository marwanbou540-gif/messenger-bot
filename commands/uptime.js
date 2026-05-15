"use strict";

module.exports = {
  name: "uptime",
  aliases: ["up"],
  description: "Show how long the bot has been running.",
  usage: "uptime",
  category: "General",

  async execute({ api, event }) {
    const total = Math.floor(process.uptime());
    const days  = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const mins  = Math.floor((total % 3600) / 60);
    const secs  = total % 60;

    const parts = [];
    if (days)  parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (mins)  parts.push(`${mins}m`);
    parts.push(`${secs}s`);

    api.sendMessage(`⏱️ Bot Uptime: ${parts.join(" ")}`, event.threadID);
  },
};
