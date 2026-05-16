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

module.exports.config = {
  name: "اوروا",
  version: "1.0.0",
  hasPermssion: 1,
  credits: "كاڪو",
  description: "يغير اسم الكروب ويمنع تغييره",
  commandCategory: "الملاك",
  usages: "اوروا [اسم] | اوروا وقف",
  cooldowns: 3
};

module.exports.run = async function ({ api, event, args }) {
  const { threadID } = event;
  const sub = args[0];

  if (sub === "وقف") {
    if (global.awrwaIntervals[threadID]) {
      clearInterval(global.awrwaIntervals[threadID]);
      delete global.awrwaIntervals[threadID];
    }
    const state = getState();
    delete state.awrwa[threadID];
    saveState(state);
    return api.sendMessage("تم إيقاف حماية الاسم ✅", threadID);
  }

  const newName = args.join(" ").trim();
  if (!newName) return api.sendMessage("يرجى كتابة اسم الكروب الجديد!", threadID);

  try {
    await api.setTitle(newName, threadID);
    const state = getState();
    state.awrwa[threadID] = newName;
    saveState(state);

    await api.sendMessage(`✅ تم تغيير اسم الكروب إلى: ${newName}\n🔒 الاسم محمي من التغيير`, threadID);

    if (global.awrwaIntervals[threadID]) clearInterval(global.awrwaIntervals[threadID]);

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

  } catch (e) {
    return api.sendMessage("❌ فشل في تغيير اسم الكروب: " + e.message, threadID);
  }
};
