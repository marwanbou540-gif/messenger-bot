"use strict";

const os = require("os");
const {
  lockedThreads, mutedThreads, groupsCache, autoReplies, groupStats,
} = require("../state");
const config = require("../config.json");

// ── helpers ──────────────────────────────────────────────────────────────────

function isAdmin(id) {
  return (config.bot.adminIDs || []).includes(id);
}

function muteStatus(threadID) {
  const ex = mutedThreads.get(threadID);
  if (!ex || Date.now() >= ex) return "غير مكتوم";
  const rem = Math.ceil((ex - Date.now()) / 60000);
  return "مكتوم (متبقي " + rem + " دقيقة)";
}

function arStatus(threadID) {
  const ar = autoReplies.get(threadID);
  if (!ar || !ar.message) return "غير مفعّل";
  return ar.enabled
    ? "مفعّل — كل " + Math.round(ar.cooldownMs / 60000) + " دق لكل مستخدم"
    : "معطّل";
}

// ── main panel ───────────────────────────────────────────────────────────────

async function showPanel(api, threadID) {
  const cached = groupsCache.get(threadID) || {};
  const stats  = groupStats.get(threadID)  || { messageCount: 0, commandCount: 0, lastMessageAt: 0 };
  const ar     = autoReplies.get(threadID);

  let name = cached.name, members = cached.memberCount || "?", admins = "?";
  try {
    const info = await api.getThreadInfo(threadID);
    name    = info.name || cached.name || threadID;
    members = (info.participantIDs || []).length;
    admins  = (info.adminIDs  || []).length;
    const c = groupsCache.get(threadID) || {};
    groupsCache.set(threadID, { ...c, name, memberCount: members });
  } catch {}

  const lastActive = stats.lastMessageAt
    ? new Date(stats.lastMessageAt).toLocaleString("ar-SA", { hour:"2-digit", minute:"2-digit", day:"numeric", month:"numeric" })
    : "لا يوجد";

  const lines = [
    "┌─ 🎛️  لوحة التحكم ─────────────┐",
    "│",
    "│ 📌 " + (name || threadID),
    "│ 👥 الأعضاء : " + members + "  |  👑 المشرفون : " + admins,
    "│",
    "│ 🔒 القفل    : " + (lockedThreads.has(threadID) ? "مُفعَّل ❌" : "غير مفعّل ✅"),
    "│ 🔇 الكتم    : " + muteStatus(threadID),
    "│ 🤖 رد تلقائي: " + arStatus(threadID),
    "│",
    "│ 📨 الرسائل  : " + stats.messageCount,
    "│ ⚡ الأوامر  : " + stats.commandCount,
    "│ 🕒 آخر نشاط : " + lastActive,
    "│",
    "└───────────────────────────────┘",
    "",
    "📋 الأوامر المتاحة:",
    "  -control info          ← عرض هذه اللوحة",
    "  -control lock          ← قفل المجموعة",
    "  -control unlock        ← فتح القفل",
    "  -control mute [دقائق]  ← كتم المجموعة",
    "  -control unmute        ← رفع الكتم",
    "  -control rename [اسم]  ← تغيير الاسم",
    "  -control members       ← قائمة الأعضاء",
    "  -control stats         ← الإحصائيات",
    "  -control kick [ID]     ← طرد عضو",
    "  -control ar set [رسالة]← تفعيل الرد التلقائي",
    "  -control ar off        ← تعطيل الرد التلقائي",
    "  -control ar wait [دق]  ← تغيير وقت الانتظار",
    "  -control ar show       ← عرض إعدادات الرد",
  ];
  return api.sendMessage(lines.join("\n"), threadID);
}

// ── execute ───────────────────────────────────────────────────────────────────

module.exports = {
  name: "control",
  aliases: ["ctrl", "panel", "cp"],
  description: "لوحة تحكم شاملة لإدارة المجموعة.",
  usage: "control [subcommand] [args]",
  category: "Admin",

  async execute({ api, event, args }) {
    const { threadID, senderID } = event;
    const sub = (args[0] || "").toLowerCase();

    // ── no subcommand → show panel ────────────────────────────────────────
    if (!sub || sub === "info") {
      return showPanel(api, threadID);
    }

    // ── admin guard ───────────────────────────────────────────────────────
    const NEED_ADMIN = ["lock","unlock","mute","unmute","rename","kick","ar","autoreply"];
    if (NEED_ADMIN.includes(sub) && !isAdmin(senderID)) {
      return api.sendMessage("⛔ هذا الأمر خاص بالمشرفين فقط.", threadID);
    }

    // ── lock ──────────────────────────────────────────────────────────────
    if (sub === "lock") {
      lockedThreads.add(threadID);
      return api.sendMessage("🔒 تم قفل المجموعة. لا يمكن إرسال رسائل حتى يُرفع القفل.", threadID);
    }

    // ── unlock ────────────────────────────────────────────────────────────
    if (sub === "unlock") {
      lockedThreads.delete(threadID);
      return api.sendMessage("🔓 تم فتح القفل. المجموعة تعمل بشكل طبيعي.", threadID);
    }

    // ── mute ──────────────────────────────────────────────────────────────
    if (sub === "mute") {
      const mins = parseInt(args[1]) || 60;
      mutedThreads.set(threadID, Date.now() + mins * 60000);
      return api.sendMessage("🔇 تم كتم المجموعة لمدة " + mins + " دقيقة.", threadID);
    }

    // ── unmute ────────────────────────────────────────────────────────────
    if (sub === "unmute") {
      mutedThreads.delete(threadID);
      return api.sendMessage("🔊 تم رفع الكتم عن المجموعة.", threadID);
    }

    // ── rename ────────────────────────────────────────────────────────────
    if (sub === "rename") {
      const newName = args.slice(1).join(" ").trim();
      if (!newName) return api.sendMessage("❌ الاستخدام: -control rename [الاسم الجديد]", threadID);
      try {
        await api.setTitle(newName, threadID);
        const c = groupsCache.get(threadID) || {};
        groupsCache.set(threadID, { ...c, name: newName });
        return api.sendMessage("✏️ تم تغيير اسم المجموعة إلى:\n" + newName, threadID);
      } catch (e) {
        return api.sendMessage("❌ فشل تغيير الاسم. تأكد أن البوت مشرف.\n(" + e.message + ")", threadID);
      }
    }

    // ── members ───────────────────────────────────────────────────────────
    if (sub === "members") {
      try {
        const info     = await api.getThreadInfo(threadID);
        const ids      = info.participantIDs || [];
        const adminSet = new Set((info.adminIDs || []).map(a => a.id || a));
        const uInfos   = ids.length > 0 ? await api.getUserInfo(ids) : {};
        const lines    = ids.map((id, i) => {
          const name = uInfos[id] ? uInfos[id].name : id;
          return (i + 1) + ". " + name + (adminSet.has(id) ? " 👑" : "");
        });
        return api.sendMessage(
          "👥 الأعضاء (" + ids.length + "):\n" + lines.join("\n"),
          threadID
        );
      } catch (e) {
        return api.sendMessage("❌ تعذّر جلب قائمة الأعضاء.\n" + e.message, threadID);
      }
    }

    // ── stats ─────────────────────────────────────────────────────────────
    if (sub === "stats") {
      const st = groupStats.get(threadID) || { messageCount: 0, commandCount: 0, lastMessageAt: 0 };
      const last = st.lastMessageAt
        ? new Date(st.lastMessageAt).toLocaleString("ar-SA")
        : "لا يوجد";
      return api.sendMessage(
        [
          "📊 إحصائيات المجموعة",
          "━━━━━━━━━━━━━━━━━━",
          "📨 إجمالي الرسائل : " + st.messageCount,
          "⚡ الأوامر المُنفَّذة: " + st.commandCount,
          "🕒 آخر رسالة       : " + last,
        ].join("\n"),
        threadID
      );
    }

    // ── kick ──────────────────────────────────────────────────────────────
    if (sub === "kick") {
      const target = args[1] || Object.keys(event.mentions || {})[0];
      if (!target) return api.sendMessage("❌ الاستخدام: -control kick [userID]", threadID);
      try {
        await api.gcmember("remove", String(target), threadID);
        return api.sendMessage("🚫 تم طرد المستخدم بنجاح.", threadID);
      } catch (e) {
        return api.sendMessage("❌ فشل الطرد. تأكد أن البوت مشرف.\n" + e.message, threadID);
      }
    }

    // ── ar / autoreply ────────────────────────────────────────────────────
    if (sub === "ar" || sub === "autoreply") {
      const action = (args[1] || "show").toLowerCase();

      // show
      if (action === "show" || action === "status") {
        const ar = autoReplies.get(threadID);
        if (!ar || !ar.message) {
          return api.sendMessage("🤖 لا يوجد رد تلقائي مُعيَّن لهذه المجموعة.\nلإضافة واحد: -control ar set [الرسالة]", threadID);
        }
        return api.sendMessage(
          [
            "🤖 إعدادات الرد التلقائي",
            "━━━━━━━━━━━━━━━━━━",
            "الحالة  : " + (ar.enabled ? "مفعّل ✅" : "معطّل ❌"),
            "الرسالة : " + ar.message,
            "الانتظار: " + Math.round(ar.cooldownMs / 60000) + " دقيقة لكل مستخدم",
          ].join("\n"),
          threadID
        );
      }

      // set
      if (action === "set") {
        const msg = args.slice(2).join(" ").trim();
        if (!msg) return api.sendMessage("❌ الاستخدام: -control ar set [الرسالة]", threadID);
        const ex = autoReplies.get(threadID) || { lastSent: new Map(), cooldownMs: 30 * 60000 };
        autoReplies.set(threadID, { ...ex, message: msg, enabled: true });
        return api.sendMessage("🤖 تم تفعيل الرد التلقائي:\n" + msg, threadID);
      }

      // off
      if (action === "off" || action === "disable") {
        const ex = autoReplies.get(threadID);
        if (ex) { ex.enabled = false; autoReplies.set(threadID, ex); }
        return api.sendMessage("🤖 تم تعطيل الرد التلقائي.", threadID);
      }

      // on
      if (action === "on" || action === "enable") {
        const ex = autoReplies.get(threadID);
        if (!ex || !ex.message) return api.sendMessage("❌ لا توجد رسالة مُعيَّنة. استخدم: -control ar set [رسالة]", threadID);
        ex.enabled = true;
        autoReplies.set(threadID, ex);
        return api.sendMessage("🤖 تم تفعيل الرد التلقائي.", threadID);
      }

      // wait / cooldown
      if (action === "wait" || action === "cooldown") {
        const mins = parseInt(args[2]) || 30;
        const ex = autoReplies.get(threadID) || { message: "", enabled: false, lastSent: new Map() };
        ex.cooldownMs = mins * 60000;
        autoReplies.set(threadID, ex);
        return api.sendMessage("⏱️ تم تعيين وقت الانتظار بين الردود: " + mins + " دقيقة لكل مستخدم.", threadID);
      }

      return api.sendMessage(
        [
          "❓ الاستخدام الصحيح:",
          "  -control ar show       ← عرض الإعدادات",
          "  -control ar set [رسالة]← تفعيل رد جديد",
          "  -control ar on / off   ← تشغيل/إيقاف",
          "  -control ar wait [دق]  ← وقت الانتظار",
        ].join("\n"),
        threadID
      );
    }

    // ── unknown ───────────────────────────────────────────────────────────
    return api.sendMessage("❓ أمر غير معروف. استخدم -control لعرض القائمة.", threadID);
  },
};
