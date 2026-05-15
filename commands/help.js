"use strict";

const config = require("../config.json");

module.exports = {
  name: "help",
  aliases: ["h", "cmds", "commands"],
  description: "Show a list of all available commands.",
  usage: "help [command]",
  category: "General",

  async execute({ api, event, args, commands }) {
    const prefix = config.prefix;

    if (args[0]) {
      const name = args[0].toLowerCase();
      const cmd = commands.get(name) ||
        [...commands.values()].find(c => c.aliases && c.aliases.includes(name));
      if (!cmd) {
        return api.sendMessage(`❌ Command "${name}" not found.`, event.threadID);
      }
      return api.sendMessage(
        `📖 Command: ${prefix}${cmd.name}\n` +
        `📝 Description: ${cmd.description}\n` +
        `🏷️ Category: ${cmd.category || "General"}\n` +
        `📌 Usage: ${prefix}${cmd.usage || cmd.name}\n` +
        (cmd.aliases ? `🔁 Aliases: ${cmd.aliases.map(a => prefix + a).join(", ")}` : ""),
        event.threadID
      );
    }

    const categories = {};
    for (const cmd of commands.values()) {
      const cat = cmd.category || "General";
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(`${prefix}${cmd.name}`);
    }

    let msg = `┌─── 🤖 ${config.bot.name} Commands ───\n`;
    for (const [cat, cmds] of Object.entries(categories)) {
      msg += `│\n│ 【${cat}】\n│  ${cmds.join("  ")}\n`;
    }
    msg += `│\n└─ Type ${prefix}help <command> for details.`;

    api.sendMessage(msg, event.threadID);
  },
};
