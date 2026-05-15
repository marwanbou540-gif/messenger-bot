"use strict";

const config = require("../config.json");
const { lockedNames } = require("../utils/lockedNames");

module.exports = {
  name: "lockname",
  aliases: ["namelock", "قفل-اسم"],
  description: "قفل اسم المجموعة ومنع تغييره.",
  usage: "lockname [on|off|status]",
  category: "Group",
  groupOnly: true,
  adminOnly: true,

  async execute({ api, event, args }) {
    const { threadID } = event;
    const sub = (args[0] || "").toLowerCase();

    if (sub === "off" || sub === "إيقاف") {
      if (!lockedNames.has(threadID)) {
        return api.sendMessage("🔓 اسم المجموعة غير مقفل أصلاً.", threadID);
      }
      lockedNames.delete(threadID);
      return api.sendMessage("🔓 تم إلغاء قفل اسم المجموعة.", threadID);
    }

    if (sub === "status" || sub === "حالة") {
      if (lockedNames.has(threadID)) {
        return api.sendMessage(`🔒 الاسم المقفل: «${lockedNames.get(threadID)}»`, threadID);
      }
      return api.sendMessage("🔓 لا يوجد قفل على اسم المجموعة حالياً.", threadID);
    }

    // on أو بدون مُعامِل → نجلب اسم المجموعة الحالي ونقفله
    try {
      const info = await api.getThreadInfo(threadID);
      const name = info.threadName || info.name;
      if (!name) {
        return api.sendMessage("❌ تعذّر جلب اسم المجموعة الحالي.", threadID);
      }
      lockedNames.set(threadID, name);
      return api.sendMessage(
        `🔒 تم قفل اسم المجموعة على:\n«${name}»\n\nأي تغيير سيُعاد تلقائياً.`,
        threadID
      );
    } catch (e) {
      return api.sendMessage(`❌ خطأ: ${e.message}`, threadID);
    }
  },
};
