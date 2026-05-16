"use strict";

const config = require("../config.json");

// schedules: Map<id, { id, threadID, message, intervalMs, label, timer, createdBy, nextAt }>
const schedules = new Map();
let nextID = 1;

function parseInterval(amount, unit) {
  const n = parseInt(amount);
  if (isNaN(n) || n <= 0) return null;
  const u = (unit || "").toLowerCase();
  const map = {
    s: 1000,          ث: 1000,
    m: 60000,         د: 60000,
    h: 3600000,       س: 3600000,
    d: 86400000,      ي: 86400000,
    sec: 1000,        min: 60000,
    hour: 3600000,    day: 86400000,
    ثانية: 1000,      دقيقة: 60000,
    ساعة: 3600000,    يوم: 86400000,
  };
  const ms = map[u];
  if (!ms) return null;
  return n * ms;
}

function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60)    return `${s} ثانية`;
  if (s < 3600)  return `${Math.floor(s / 60)} دقيقة`;
  if (s < 86400) return `${Math.floor(s / 3600)} ساعة`;
  return `${Math.floor(s / 86400)} يوم`;
}

function formatDate(ts) {
  return new Date(ts).toLocaleString("ar-SA", {
    hour: "2-digit", minute: "2-digit",
    day: "numeric",  month: "numeric",
  });
}

function startTimer(entry, api) {
  entry.timer = setInterval(() => {
    entry.nextAt = Date.now() + entry.intervalMs;
    api.sendMessage(entry.message, entry.threadID).catch(() => {});
  }, entry.intervalMs);
  entry.nextAt = Date.now() + entry.intervalMs;
}

module.exports = {
  name: "autoreply",
  aliases: ["sch", "auto", "timer", "schedule"],
  description: "جدولة ردود تلقائية تُرسَل كل فترة زمنية محددة. (مشرف فقط)",
  usage: [
    "-autoreply add <مقدار> <وحدة> <الرسالة>",
    "-autoreply list",
    "-autoreply stop <ID>",
    "-autoreply stopall",
    "",
    "وحدات الوقت:",
    "  s / ث      = ثواني",
    "  m / د      = دقائق",
    "  h / س      = ساعات",
    "  d / ي      = أيام",
    "",
    "مثال:",
    "  -autoreply add 30 m صباح الخير للجميع 🌅",
    "  -autoreply add 2 h تذكير: التزموا بقوانين المجموعة",
  ].join("\n"),
  category: "Group",
  groupOnly: true,
  adminOnly: true,

  async execute({ api, event, args }) {
    global._botApi = api;
    const sub      = (args[0] || "").toLowerCase();
    const threadID = event.threadID;
    const prefix   = config.prefix;

    // ── add ──────────────────────────────────────────────────────────────────
    if (sub === "add") {
      const amount  = args[1];
      const unit    = args[2];
      const message = args.slice(3).join(" ").trim();

      if (!amount || !unit || !message) {
        return api.sendMessage(
          `❌ استخدام:\n${prefix}autoreply add <مقدار> <وحدة> <الرسالة>\n\nمثال:\n${prefix}autoreply add 30 m صباح الخير 🌅`,
          threadID
        );
      }

      const intervalMs = parseInterval(amount, unit);
      if (!intervalMs) {
        return api.sendMessage(
          `❌ وحدة الوقت غير صحيحة.\nالوحدات المتاحة: s/ث ، m/د ، h/س ، d/ي`,
          threadID
        );
      }

      if (intervalMs < 30000) {
        return api.sendMessage("❌ الحد الأدنى للجدولة هو 30 ثانية.", threadID);
      }

      const id = nextID++;
      const entry = {
        id,
        threadID,
        message,
        intervalMs,
        label: `${amount}${unit}`,
        timer: null,
        createdBy: event.senderID,
        nextAt: null,
      };

      startTimer(entry, api);
      schedules.set(id, entry);

      return api.sendMessage(
        [
          `✅ تم إنشاء الرد التلقائي رقم #${id}`,
          ``,
          `⏱️ التكرار  : كل ${formatMs(intervalMs)}`,
          `📩 الرسالة  : ${message}`,
          `🕐 الإرسال القادم: ${formatDate(entry.nextAt)}`,
          ``,
          `لإيقافه: ${prefix}autoreply stop ${id}`,
        ].join("\n"),
        threadID
      );
    }

    // ── list ──────────────────────────────────────────────────────────────────
    if (sub === "list") {
      const threadSchedules = [...schedules.values()].filter(s => s.threadID === threadID);

      if (threadSchedules.length === 0) {
        return api.sendMessage(
          `📭 لا توجد ردود تلقائية نشطة في هذه المجموعة.\nأضف واحدة: ${prefix}autoreply add <مقدار> <وحدة> <الرسالة>`,
          threadID
        );
      }

      let msg = `┌──── 🔁 الردود التلقائية النشطة (${threadSchedules.length}) ────\n│\n`;
      for (const s of threadSchedules) {
        msg += `│ 🆔 #${s.id}\n`;
        msg += `│ ⏱️  كل ${formatMs(s.intervalMs)}\n`;
        msg += `│ 🕐  القادم: ${formatDate(s.nextAt)}\n`;
        msg += `│ 📩  ${s.message.length > 40 ? s.message.slice(0, 40) + "..." : s.message}\n`;
        msg += `│\n`;
      }
      msg += `└─ لإيقاف رد تلقائي: ${prefix}autoreply stop <ID>`;

      return api.sendMessage(msg, threadID);
    }

    // ── stop <id> ─────────────────────────────────────────────────────────────
    if (sub === "stop") {
      const id = parseInt(args[1]);
      if (isNaN(id)) {
        return api.sendMessage(`❌ أدخل رقم ID صحيح.\nمثال: ${prefix}autoreply stop 1`, threadID);
      }

      const entry = schedules.get(id);
      if (!entry) {
        return api.sendMessage(`❌ لا يوجد رد تلقائي برقم #${id}.`, threadID);
      }
      if (entry.threadID !== threadID) {
        return api.sendMessage(`❌ هذا الرد التلقائي يعود لمجموعة أخرى.`, threadID);
      }

      clearInterval(entry.timer);
      schedules.delete(id);
      return api.sendMessage(
        `✅ تم إيقاف الرد التلقائي #${id}.\n📩 كانت الرسالة: ${entry.message}`,
        threadID
      );
    }

    // ── stopall ────────────────────────────────────────────────────────────────
    if (sub === "stopall") {
      const toDelete = [...schedules.entries()].filter(([, s]) => s.threadID === threadID);
      if (toDelete.length === 0) {
        return api.sendMessage("📭 لا توجد ردود تلقائية نشطة في هذه المجموعة.", threadID);
      }
      for (const [id, entry] of toDelete) {
        clearInterval(entry.timer);
        schedules.delete(id);
      }
      return api.sendMessage(`✅ تم إيقاف جميع الردود التلقائية (${toDelete.length}) في هذه المجموعة.`, threadID);
    }

    // ── usage ─────────────────────────────────────────────────────────────────
    return api.sendMessage(
      `📖 استخدام أمر الرد التلقائي:\n\n${this.usage}`,
      threadID
    );
  },
};
