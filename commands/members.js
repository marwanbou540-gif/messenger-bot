"use strict";

module.exports = {
  name: "members",
  aliases: ["list", "ml"],
  description: "List all members in this group chat.",
  usage: "members",
  category: "Group",
  groupOnly: true,

  async execute({ api, event }) {
    const info = await api.getThreadInfo(event.threadID);
    if (!info) return api.sendMessage("❌ Could not retrieve group info.", event.threadID);

    const userInfo = await api.getUserInfo(info.participantIDs);
    const adminIDs = (info.adminIDs || []).map(a => a.id);

    const lines = info.participantIDs.map((id, i) => {
      const name = userInfo[id]?.name || `User ${id}`;
      const isAdmin = adminIDs.includes(id) ? " 👑" : "";
      return `${i + 1}. ${name}${isAdmin}`;
    });

    const msg =
      `👥 Group: ${info.name || "Unnamed"}\n` +
      `📊 Members: ${info.participantIDs.length}\n` +
      `─────────────────\n` +
      lines.join("\n");

    api.sendMessage(msg, event.threadID);
  },
};
