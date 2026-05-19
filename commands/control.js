"use strict";

const {
  lockedThreads, mutedThreads, groupsCache, autoReplies, groupStats,
} = require("../state");
const { lockedNames }    = require("../utils/lockedNames");
const pendingReplies     = require("../utils/pendingReplies");
const threadScanner      = require("../utils/threadScanner");
const config             = require("../config.json");

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAdmin(id) {
  return (config.bot.adminIDs || []).includes(String(id));
}

function muteStatus(threadID) {
  const ex = mutedThreads.get(threadID);
  if (!ex || Date.now() >= ex) return "غير مكتوم";
  return "مكتوم (متبقي " + Math.ceil((ex - Date.now()) / 60000) + " دق)";
}

function arStatus(threadID) {
  const ar = autoReplies.get(threadID);
  if (!ar || !ar.message) return "غير مفعّل";
  return ar.enabled
    ? "مفعّل — كل " + Math.round(ar.cooldownMs / 60000) + " دق/مستخدم"
    : "معطّل";
}

function lnStatus(threadID) {
  const n = lockedNames.get(threadID);
  return n ? "مقفل: «" + n + "»" : "غير مقفل";
}

// ── Local control panel ───────────────────────────────────────────────────────

async function showPanel(api, threadID) {
  const cached = groupsCache.get(threadID) || {};
  const stats  = groupStats.get(threadID) || { messageCount: 0, commandCount: 0, lastMessageAt: 0 };

  let name = cached.name || threadID, members = cached.memberCount || "?", admins = "?";
  try {
    const info = await api.getThreadInfo(threadID);
    name    = info.name || cached.name || threadID;
    members = (info.participantIDs || []).length;
    admins  = (info.adminIDs || []).length;
    groupsCache.set(threadID, { ...cached, name, memberCount: members });
  } catch {}

  const lastActive = stats.lastMessageAt
    ? new Date(stats.lastMessageAt).toLocaleString("ar-SA", {
        hour: "2-digit", minute: "2-digit", day: "numeric", month: "numeric",
      })
    : "لا يوجد";

  return api.sendMessage([
    "┌─ 🎛️  لوحة التحكم ──────────────────┐",
    "│",
    "│ 📌 " + name,
    "│ 👥 الأعضاء: " + members + "  |  👑 المشرفون: " + admins,
    "│",
    "│ 🔒 قفل الرسائل : " + (lockedThreads.has(threadID) ? "مُفعَّل ❌" : "غير مفعّل ✅"),
    "│ 🏷️  قفل الاسم  : " + lnStatus(threadID),
    "│ 🔇 الكتم       : " + muteStatus(threadID),
    "│ 🤖 رد تلقائي  : " + arStatus(threadID),
    "│",
    "│ 📨 الرسائل: " + stats.messageCount + "  |  ⚡ الأوامر: " + stats.commandCount,
    "│ 🕒 آخر نشاط: " + lastActive,
    "│",
    "└────────────────────────────────────┘",
    "",
    "📋 الأوامر:",
    "  -control lock / unlock     ← قفل/فتح الرسائل",
    "  -control mute [دق] / unmute← كتم/رفع الكتم",
    "  -control lockname [اسم]    ← قفل اسم المجموعة",
    "  -control unlockname        ← رفع قفل الاسم",
    "  -control rename [اسم]      ← تغيير الاسم",
    "  -control members           ← قائمة الأعضاء",
    "  -control stats             ← الإحصائيات",
    "  -control kick [ID]         ← طرد عضو",
    "  -control ar set [رسالة]    ← تفعيل رد تلقائي",
    "  -control remote            ← تحكم عن بُعد",
  ].join("\n"), threadID);
}

// ── Remote: action menu for a single target group ─────────────────────────────

async function showRemoteMenu(api, replyTID, senderID, target) {
  const isLocked    = lockedThreads.has(target.threadID);
  const muteExp     = mutedThreads.get(target.threadID);
  const isMuted     = !!muteExp && muteExp > Date.now();
  const hasLockName = lockedNames.has(target.threadID);
  const ar          = autoReplies.get(target.threadID);
  const hasAR       = !!(ar && ar.message);

  const menu = [
    "🎛️ التحكم عن بُعد",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "📌 " + target.name,
    "👥 الأعضاء : " + (target.memberCount || "؟"),
    "",
    "الحالة:",
    "  🔒 القفل     : " + (isLocked    ? "مفعّل"  : "غير مفعّل"),
    "  🔇 الكتم     : " + (isMuted     ? "مكتوم"  : "غير مكتوم"),
    "  🏷️  قفل الاسم: " + (hasLockName ? "مفعّل"  : "غير مفعّل"),
    "  🤖 رد تلقائي: " + (hasAR ? (ar.enabled ? "مفعّل" : "معطّل") : "لا يوجد"),
    "",
    "اختر أمراً:",
    isLocked  ? "1. 🔓 فتح قفل الرسائل"    : "1. 🔒 قفل الرسائل",
    isMuted   ? "2. 🔊 رفع الكتم"           : "2. 🔇 كتم (ستُسأل عن المدة)",
    "3. 💬 إرسال رسالة",
    "4. ✏️ تغيير الاسم",
    hasLockName ? "5. 🔓 رفع قفل الاسم"    : "5. 🏷️ قفل الاسم الحالي",
    "6. 📊 إحصائيات",
    "7. 👥 معلومات الأعضاء",
    "8. 🎛️ إرسال لوحة التحكم للمجموعة",
    hasAR && ar.enabled ? "9. 🤖 تعطيل الرد التلقائي"
                        : (hasAR ? "9. 🤖 تفعيل الرد التلقائي" : "9. 🤖 إعداد رد تلقائي"),
    "",
    "0. ↩️ رجوع للقائمة",
    "00. ❌ إلغاء",
  ].join("\n");

  await api.sendMessage(menu, replyTID);

  pendingReplies.set(senderID, {
    handler: async (input, _api, _ev) => {
      const rTID = _ev.threadID;
      const rSID = _ev.senderID;
      const ch   = input.trim();

      if (ch === "00" || ch === "إلغاء") {
        pendingReplies.del(rSID);
        return _api.sendMessage("❌ تم الإلغاء.", rTID);
      }

      // 0 = back to group list (re-run remote)
      if (ch === "0" || ch === "رجوع") {
        pendingReplies.del(rSID);
        return handleRemote(_api, _ev);
      }

      pendingReplies.del(rSID);

      switch (ch) {

        // ── 1: toggle lock ───────────────────────────────────────────────
        case "1":
          if (isLocked) {
            lockedThreads.delete(target.threadID);
            _api.sendMessage("✅ تم فتح قفل الرسائل في «" + target.name + "».", rTID);
            _api.sendMessage("🔓 تم فتح قفل الرسائل عن بُعد.", target.threadID).catch(() => {});
          } else {
            lockedThreads.add(target.threadID);
            _api.sendMessage("✅ تم قفل الرسائل في «" + target.name + "».", rTID);
            _api.sendMessage("🔒 تم قفل الرسائل عن بُعد.", target.threadID).catch(() => {});
          }
          break;

        // ── 2: toggle mute ───────────────────────────────────────────────
        case "2":
          if (isMuted) {
            mutedThreads.delete(target.threadID);
            _api.sendMessage("✅ تم رفع الكتم عن «" + target.name + "».", rTID);
            _api.sendMessage("🔊 تم رفع الكتم عن بُعد.", target.threadID).catch(() => {});
          } else {
            await _api.sendMessage("⏱️ كم دقيقة تريد كتم «" + target.name + "»؟ (مثال: 30)", rTID);
            pendingReplies.set(rSID, {
              handler: async (inp, a2, ev2) => {
                pendingReplies.del(ev2.senderID);
                const mins = Math.max(1, parseInt(inp) || 60);
                mutedThreads.set(target.threadID, Date.now() + mins * 60000);
                a2.sendMessage("✅ تم كتم «" + target.name + "» لمدة " + mins + " دقيقة.", ev2.threadID);
                a2.sendMessage("🔇 تم الكتم لمدة " + mins + " دقيقة عن بُعد.", target.threadID).catch(() => {});
              },
            });
          }
          break;

        // ── 3: send message ──────────────────────────────────────────────
        case "3":
          await _api.sendMessage("💬 اكتب الرسالة التي تريد إرسالها إلى «" + target.name + "»:", rTID);
          pendingReplies.set(rSID, {
            handler: async (msg, a2, ev2) => {
              pendingReplies.del(ev2.senderID);
              if (!msg.trim()) return a2.sendMessage("❌ رسالة فارغة، تم الإلغاء.", ev2.threadID);
              try {
                await a2.sendMessage(msg.trim(), target.threadID);
                a2.sendMessage("✅ تم إرسال الرسالة إلى «" + target.name + "».", ev2.threadID);
              } catch (e) {
                a2.sendMessage("❌ فشل الإرسال: " + e.message, ev2.threadID);
              }
            },
          });
          break;

        // ── 4: rename ────────────────────────────────────────────────────
        case "4":
          if (lockedNames.has(target.threadID)) {
            return _api.sendMessage("⛔ الاسم مقفل. استخدم الخيار 5 لرفع القفل أولاً.", rTID);
          }
          await _api.sendMessage("✏️ اكتب الاسم الجديد لـ «" + target.name + "»:", rTID);
          pendingReplies.set(rSID, {
            handler: async (newName, a2, ev2) => {
              pendingReplies.del(ev2.senderID);
              const n = newName.trim();
              if (!n) return a2.sendMessage("❌ اسم فارغ، تم الإلغاء.", ev2.threadID);
              try {
                await a2.gcname(n, target.threadID);
                const c = groupsCache.get(target.threadID) || {};
                groupsCache.set(target.threadID, { ...c, name: n });
                a2.sendMessage("✅ تم تغيير الاسم إلى «" + n + "».", ev2.threadID);
              } catch (e) {
                a2.sendMessage("❌ فشل تغيير الاسم: " + e.message, ev2.threadID);
              }
            },
          });
          break;

        // ── 5: toggle lockname ───────────────────────────────────────────
        case "5":
          if (hasLockName) {
            lockedNames.delete(target.threadID);
            _api.sendMessage("✅ تم رفع قفل الاسم عن «" + target.name + "».", rTID);
            _api.sendMessage("🔓 تم رفع قفل الاسم عن بُعد.", target.threadID).catch(() => {});
          } else {
            lockedNames.set(target.threadID, target.name);
            _api.sendMessage("✅ تم قفل الاسم «" + target.name + "» عن بُعد.", rTID);
            _api.sendMessage("🏷️ تم قفل الاسم على «" + target.name + "».", target.threadID).catch(() => {});
          }
          break;

        // ── 6: stats ─────────────────────────────────────────────────────
        case "6": {
          const st   = groupStats.get(target.threadID) || { messageCount: 0, commandCount: 0, lastMessageAt: 0 };
          const last = st.lastMessageAt ? new Date(st.lastMessageAt).toLocaleString("ar-SA") : "لا يوجد";
          _api.sendMessage([
            "📊 إحصائيات «" + target.name + "»",
            "━━━━━━━━━━━━━━━",
            "📨 الرسائل  : " + st.messageCount,
            "⚡ الأوامر  : " + st.commandCount,
            "🕒 آخر نشاط: " + last,
          ].join("\n"), rTID);
          break;
        }

        // ── 7: member info ───────────────────────────────────────────────
        case "7":
          try {
            const info = await _api.getThreadInfo(target.threadID);
            _api.sendMessage(
              "👥 «" + target.name + "»\n" +
              "الأعضاء : " + (info.participantIDs || []).length + "\n" +
              "المشرفون: " + (info.adminIDs || []).length,
              rTID
            );
          } catch (e) {
            _api.sendMessage("❌ تعذّر جلب المعلومات: " + e.message, rTID);
          }
          break;

        // ── 8: send panel to group ───────────────────────────────────────
        case "8":
          try {
            await showPanel(_api, target.threadID);
            _api.sendMessage("✅ تم إرسال لوحة التحكم إلى «" + target.name + "».", rTID);
          } catch (e) {
            _api.sendMessage("❌ فشل إرسال لوحة التحكم: " + e.message, rTID);
          }
          break;

        // ── 9: autoreply toggle / set ────────────────────────────────────
        case "9":
          if (hasAR && ar.enabled) {
            ar.enabled = false;
            autoReplies.set(target.threadID, ar);
            _api.sendMessage("✅ تم تعطيل الرد التلقائي في «" + target.name + "».", rTID);
          } else if (hasAR && !ar.enabled) {
            ar.enabled = true;
            autoReplies.set(target.threadID, ar);
            _api.sendMessage("✅ تم تفعيل الرد التلقائي في «" + target.name + "».", rTID);
          } else {
            await _api.sendMessage("🤖 اكتب رسالة الرد التلقائي لـ «" + target.name + "»:", rTID);
            pendingReplies.set(rSID, {
              handler: async (msg, a2, ev2) => {
                pendingReplies.del(ev2.senderID);
                const m = msg.trim();
                if (!m) return a2.sendMessage("❌ رسالة فارغة، تم الإلغاء.", ev2.threadID);
                const ex = autoReplies.get(target.threadID) || { lastSent: new Map(), cooldownMs: 30 * 60000 };
                autoReplies.set(target.threadID, { ...ex, message: m, enabled: true });
                a2.sendMessage("✅ تم تفعيل الرد التلقائي في «" + target.name + "»:\n" + m, ev2.threadID);
              },
            });
          }
          break;

        default:
          _api.sendMessage("❌ خيار غير صحيح. اختر رقماً من القائمة.", rTID);
      }
    },
  });
}

// ── Remote: group list with pagination ───────────────────────────────────────

const PAGE_SIZE = 10;

function buildGroupPage(groups, page, scanMeta) {
  const total = Math.ceil(groups.length / PAGE_SIZE);
  const start = page * PAGE_SIZE;
  const slice = groups.slice(start, start + PAGE_SIZE);

  const sourceTag = scanMeta.fromCache ? " (من الذاكرة)" : " (" + scanMeta.duration + "ms)";
  const lines = [
    "🎛️ التحكم عن بُعد" + sourceTag,
    "━━━━━━━━━━━━━━━━━━━━━━",
    "📋 اختر مجموعة — صفحة " + (page + 1) + " / " + total + ":",
    "",
  ];

  slice.forEach((g, i) => {
    const n     = start + i + 1;
    const lock  = lockedThreads.has(g.threadID) ? " 🔒" : "";
    const muted = (mutedThreads.get(g.threadID) || 0) > Date.now() ? " 🔇" : "";
    lines.push(n + ". " + g.name + lock + muted + "  (" + (g.memberCount || "؟") + " عضو)");
  });

  lines.push("");
  if (total > 1) {
    const nav = [];
    if (page > 0)         nav.push("< سابق");
    if (page < total - 1) nav.push("تالي >");
    if (nav.length)       lines.push("التنقل: " + nav.join("  |  "));
  }
  if (scanMeta.errors && scanMeta.errors.length > 0) {
    lines.push("⚠️ " + scanMeta.errors.length + " مجموعة/خطأ لم يُجلب");
  }
  lines.push("0. ❌ إلغاء");

  return lines.join("\n");
}

async function handleRemote(api, event) {
  const { threadID, senderID } = event;

  if (!isAdmin(senderID)) {
    return api.sendMessage("⛔ التحكم عن بُعد خاص بمشرف البوت فقط.", threadID);
  }

  // Notify user we're scanning
  await api.sendMessage(
    "🔄 جاري البحث عن المجموعات...\nقد يستغرق هذا بضع ثوانٍ.",
    threadID
  );

  let scanResult;
  try {
    scanResult = await threadScanner.scan();
  } catch (e) {
    return api.sendMessage("❌ فشل البحث: " + e.message, threadID);
  }

  const { groups } = scanResult;

  if (groups.length === 0) {
    const errLine = scanResult.errors.length
      ? "\n⚠️ أخطاء: " + scanResult.errors.slice(0, 2).join(" | ")
      : "";
    return api.sendMessage(
      "ℹ️ لا توجد مجموعات مسجلة بعد.\n" +
      "أرسل أي رسالة في مجموعة لكي يتعرف عليها البوت." + errLine,
      threadID
    );
  }

  // Pagination state (captured in closure)
  let page = 0;

  await api.sendMessage(buildGroupPage(groups, page, scanResult), threadID);

  pendingReplies.set(senderID, {
    handler: async (input, _api, _ev) => {
      const rTID = _ev.threadID;
      const rSID = _ev.senderID;
      const ch   = input.trim();

      // Navigation
      if (ch === ">" || ch === "تالي") {
        const total = Math.ceil(groups.length / PAGE_SIZE);
        if (page < total - 1) page++;
        await _api.sendMessage(buildGroupPage(groups, page, scanResult), rTID);
        return pendingReplies.KEEP; // keep pagination alive
      }
      if (ch === "<" || ch === "سابق") {
        if (page > 0) page--;
        await _api.sendMessage(buildGroupPage(groups, page, scanResult), rTID);
        return pendingReplies.KEEP; // keep pagination alive
      }

      // Cancel
      if (ch === "0" || ch === "إلغاء") {
        pendingReplies.del(rSID);
        return _api.sendMessage("❌ تم الإلغاء.", rTID);
      }

      // Group selection
      const idx = parseInt(ch) - 1;
      if (isNaN(idx) || idx < 0 || idx >= groups.length) {
        await _api.sendMessage(
          "❌ رقم غير صحيح. اختر من 1 إلى " + groups.length +
          (Math.ceil(groups.length / PAGE_SIZE) > 1 ? "، أو < / > للتنقل" : "") +
          "، أو 0 للإلغاء.",
          rTID
        );
        return pendingReplies.KEEP; // keep pagination alive on invalid input
      }

      const target = groups[idx];
      pendingReplies.del(rSID);

      // Validate thread before showing menu
      if (!target || !target.threadID) {
        return _api.sendMessage("❌ بيانات المجموعة تالفة، اختر مجموعة أخرى.", rTID);
      }

      await showRemoteMenu(_api, rTID, rSID, target);
    },
  });
}

// ── execute ───────────────────────────────────────────────────────────────────

module.exports = {
  name: "control",
  aliases: ["ctrl", "panel", "cp"],
  description: "لوحة تحكم شاملة للمجموعة + تحكم عن بُعد بجميع المجموعات.",
  usage: "control [subcommand] [args]",
  category: "Admin",

  async execute({ api, event, args }) {
    const { threadID, senderID } = event;
    const sub = (args[0] || "").toLowerCase();

    if (!sub || sub === "info") return showPanel(api, threadID);

    // ── remote ─────────────────────────────────────────────────────────────
    if (sub === "remote" || sub === "r") return handleRemote(api, event);

    // ── scanner diagnostics (admin only) ───────────────────────────────────
    if (sub === "scan" || sub === "scanner") {
      if (!isAdmin(senderID)) return api.sendMessage("⛔ للمشرفين فقط.", threadID);
      const diag = threadScanner.diagnostics();
      return api.sendMessage([
        "🔍 ThreadScanner",
        "━━━━━━━━━━━━━━━━",
        "API جاهز : " + (diag.apiReady ? "نعم" : "لا"),
        "يجري فحص: " + (diag.scanning ? "نعم" : "لا"),
        "عدد الفحوصات: " + diag.scanCount,
        "آخر فحص: " + (diag.lastScanAt || "لم يُجرَ بعد"),
        "المجموعات المخزنة: " + diag.cacheSize,
        "مدة آخر فحص: " + (diag.lastDuration ? diag.lastDuration + "ms" : "–"),
        "أخطاء آخر فحص: " + (diag.lastErrors.length || 0),
      ].join("\n"), threadID);
    }

    // ── admin guard ─────────────────────────────────────────────────────────
    const NEED_ADMIN = ["lock","unlock","mute","unmute","rename","kick","ar","autoreply","lockname","unlockname"];
    if (NEED_ADMIN.includes(sub) && !isAdmin(senderID)) {
      return api.sendMessage("⛔ هذا الأمر خاص بالمشرفين فقط.", threadID);
    }

    if (sub === "lock") {
      lockedThreads.add(threadID);
      return api.sendMessage("🔒 تم قفل المجموعة.", threadID);
    }

    if (sub === "unlock") {
      lockedThreads.delete(threadID);
      return api.sendMessage("🔓 تم فتح قفل المجموعة.", threadID);
    }

    if (sub === "lockname") {
      const nameToLock = args.slice(1).join(" ").trim();
      let finalName = nameToLock;
      if (!finalName) {
        try { const info = await api.getThreadInfo(threadID); finalName = info.name || ""; } catch {}
      }
      if (!finalName) return api.sendMessage("❌ الاستخدام: -control lockname [الاسم]", threadID);
      if (nameToLock) { try { await api.gcname(finalName, threadID); } catch {} }
      lockedNames.set(threadID, finalName);
      const c = groupsCache.get(threadID) || {};
      groupsCache.set(threadID, { ...c, name: finalName });
      return api.sendMessage("🏷️ تم قفل الاسم على:\n«" + finalName + "»", threadID);
    }

    if (sub === "unlockname") {
      if (!lockedNames.get(threadID)) return api.sendMessage("ℹ️ الاسم غير مقفل أصلاً.", threadID);
      lockedNames.delete(threadID);
      return api.sendMessage("🔓 تم رفع قفل الاسم.", threadID);
    }

    if (sub === "mute") {
      const mins = parseInt(args[1]) || 60;
      mutedThreads.set(threadID, Date.now() + mins * 60000);
      return api.sendMessage("🔇 تم كتم المجموعة لمدة " + mins + " دقيقة.", threadID);
    }

    if (sub === "unmute") {
      mutedThreads.delete(threadID);
      return api.sendMessage("🔊 تم رفع الكتم.", threadID);
    }

    if (sub === "rename") {
      const newName = args.slice(1).join(" ").trim();
      if (!newName) return api.sendMessage("❌ الاستخدام: -control rename [الاسم]", threadID);
      if (lockedNames.has(threadID)) {
        return api.sendMessage("⛔ الاسم مقفل على «" + lockedNames.get(threadID) + "». استخدم unlockname أولاً.", threadID);
      }
      try {
        await api.gcname(newName, threadID);
        const c = groupsCache.get(threadID) || {};
        groupsCache.set(threadID, { ...c, name: newName });
        return api.sendMessage("✏️ تم تغيير الاسم إلى:\n" + newName, threadID);
      } catch (e) {
        return api.sendMessage("❌ فشل تغيير الاسم: " + e.message, threadID);
      }
    }

    if (sub === "members") {
      try {
        const info     = await api.getThreadInfo(threadID);
        const ids      = info.participantIDs || [];
        const adminSet = new Set((info.adminIDs || []).map(a => a.id || a));
        const uInfos   = ids.length ? await api.getUserInfo(ids) : {};
        const lines    = ids.map((id, i) =>
          (i + 1) + ". " + (uInfos[id]?.name || id) + (adminSet.has(id) ? " 👑" : "")
        );
        return api.sendMessage("👥 الأعضاء (" + ids.length + "):\n" + lines.join("\n"), threadID);
      } catch (e) {
        return api.sendMessage("❌ تعذّر جلب الأعضاء: " + e.message, threadID);
      }
    }

    if (sub === "stats") {
      const st   = groupStats.get(threadID) || { messageCount: 0, commandCount: 0, lastMessageAt: 0 };
      const last = st.lastMessageAt ? new Date(st.lastMessageAt).toLocaleString("ar-SA") : "لا يوجد";
      return api.sendMessage([
        "📊 إحصائيات المجموعة",
        "━━━━━━━━━━━━━━━━━━",
        "📨 الرسائل  : " + st.messageCount,
        "⚡ الأوامر  : " + st.commandCount,
        "🕒 آخر نشاط: " + last,
      ].join("\n"), threadID);
    }

    if (sub === "kick") {
      const target = args[1] || Object.keys(event.mentions || {})[0];
      if (!target) return api.sendMessage("❌ الاستخدام: -control kick [userID]", threadID);
      try {
        await api.gcmember("remove", String(target), threadID);
        return api.sendMessage("🚫 تم الطرد بنجاح.", threadID);
      } catch (e) {
        return api.sendMessage("❌ فشل الطرد: " + e.message, threadID);
      }
    }

    if (sub === "ar" || sub === "autoreply") {
      const action = (args[1] || "show").toLowerCase();

      if (action === "show" || action === "status") {
        const ar = autoReplies.get(threadID);
        if (!ar || !ar.message) return api.sendMessage("🤖 لا يوجد رد تلقائي.\nالاستخدام: -control ar set [رسالة]", threadID);
        return api.sendMessage([
          "🤖 الرد التلقائي",
          "━━━━━━━━━━━━━━━━",
          "الحالة  : " + (ar.enabled ? "مفعّل ✅" : "معطّل ❌"),
          "الرسالة : " + ar.message,
          "الانتظار: " + Math.round(ar.cooldownMs / 60000) + " دقيقة/مستخدم",
        ].join("\n"), threadID);
      }

      if (action === "set") {
        const msg = args.slice(2).join(" ").trim();
        if (!msg) return api.sendMessage("❌ الاستخدام: -control ar set [رسالة]", threadID);
        const ex = autoReplies.get(threadID) || { lastSent: new Map(), cooldownMs: 30 * 60000 };
        autoReplies.set(threadID, { ...ex, message: msg, enabled: true });
        return api.sendMessage("🤖 تم تفعيل الرد التلقائي:\n" + msg, threadID);
      }

      if (action === "off" || action === "disable") {
        const ex = autoReplies.get(threadID);
        if (ex) { ex.enabled = false; autoReplies.set(threadID, ex); }
        return api.sendMessage("🤖 تم تعطيل الرد التلقائي.", threadID);
      }

      if (action === "on" || action === "enable") {
        const ex = autoReplies.get(threadID);
        if (!ex || !ex.message) return api.sendMessage("❌ لا توجد رسالة. استخدم: -control ar set [رسالة]", threadID);
        ex.enabled = true;
        autoReplies.set(threadID, ex);
        return api.sendMessage("🤖 تم تفعيل الرد التلقائي.", threadID);
      }

      if (action === "wait" || action === "cooldown") {
        const mins = parseInt(args[2]) || 30;
        const ex   = autoReplies.get(threadID) || { message: "", enabled: false, lastSent: new Map() };
        ex.cooldownMs = mins * 60000;
        autoReplies.set(threadID, ex);
        return api.sendMessage("⏱️ وقت الانتظار: " + mins + " دقيقة/مستخدم.", threadID);
      }

      return api.sendMessage([
        "❓ الاستخدام:",
        "  -control ar show       ← عرض الإعدادات",
        "  -control ar set [رسالة]← رد جديد",
        "  -control ar on / off   ← تشغيل/إيقاف",
        "  -control ar wait [دق]  ← وقت الانتظار",
      ].join("\n"), threadID);
    }

    return api.sendMessage("❓ أمر غير معروف. استخدم -control لعرض القائمة.", threadID);
  },
};
