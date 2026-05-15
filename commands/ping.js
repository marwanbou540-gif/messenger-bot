"use strict";

module.exports = {
  name: "ping",
  aliases: ["pong"],
  description: "Check if the bot is alive and measure response latency.",
  usage: "ping",
  category: "General",

  async execute({ api, event }) {
    const start = Date.now();
    await api.sendMessage("🏓 Pinging...", event.threadID);
    const latency = Date.now() - start;
    api.sendMessage(`🏓 Pong! Latency: ${latency}ms`, event.threadID);
  },
};
