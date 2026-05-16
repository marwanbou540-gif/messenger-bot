"use strict";

const config = require("../config.json");
const fs = require("fs-extra");
const path = require("path");
const statePath = path.join(__dirname, "data/malakState.json");

function getState() {
  try { return JSON.parse(fs.readFileSync(statePath, "utf-8")); }
  catch { return { locks: {}, botAdmins: {}, awrwa: {} }; }
}

function saveState(s) {
  fs.writeFileSync(statePath, JSON.stringify(s, null, 2));
}

if (!global.awrwaIntervals) global.awrwaIntervals = {};

module.exports = {
  name: "rename",
  aliases: ["setname", "groupname"],
  description: "تغيير اسم المجموعة (مشرف فقط) | استخدم --lock لمنع الآخرين من تغيير الاسم",
  usage: "rename <اسم جديد> [--lock]",
  category: "Group",
  groupOnly: true,
  adminOnly: true,

  async execute({ api, event, args }) {
    const threadID = event.threadID;
    let lockFlag = false;

    // Check if --lock flag is present
    if (args.includes("--lock")) {
      lockFlag = true;
      args = args.filter(arg => arg !== "--lock");
    }

    const newName = args.join(" ").trim();
    if (!newName) {
      return api.sendMessage(
        `❌ يرجى إدخال اسم جديد.\nالاستخدام: ${config.prefix}rename <اسم جديد> [--lock]\n\nمثال: ${config.prefix}rename مجموعتي\n${config.prefix}rename مجموعتي --lock (لق��ل الاسم)`,
        threadID
      );
    }

    try {
      await api.gcname(newName, threadID);
      
      // If --lock flag is used, enable name protection
      if (lockFlag) {
        const state = getState();
        state.awrwa = state.awrwa || {};
        state.awrwa[threadID] = newName;
        saveState(state);

        // Clear existing interval if any
        if (global.awrwaIntervals[threadID]) {
          clearInterval(global.awrwaIntervals[threadID]);
        }

        // Set up protection interval
        global.awrwaIntervals[threadID] = setInterval(async () => {
          try {
            const info = await api.getThreadInfo(threadID);
            const st = getState();
            const protectedName = st.awrwa[threadID];
            if (protectedName && info.threadName !== protectedName) {
              await api.setTitle(protectedName, threadID);
            }
          } catch (e) {}
        }, 5000);

        api.sendMessage(
          `✅ تم تغيير اسم المجموعة إلى: ${newName}\n🔒 الاسم مقفل الآن - فقط المشرفين يمكنهم تغييره!`,
          threadID
        );
      } else {
        api.sendMessage(`✅ تم تغيير اسم المجموعة إلى: ${newName}`, threadID);
      }
    } catch (e) {
      api.sendMessage(`❌ خطأ: ${e.message}`, threadID);
    }
  },
};
