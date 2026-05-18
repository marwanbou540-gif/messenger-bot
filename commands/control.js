"use strict";

const {
  lockedThreads, mutedThreads, groupsCache, autoReplies, groupStats,
} = require("../state");
const { lockedNames }    = require("../utils/lockedNames");
const pendingReplies     = require("../utils/pendingReplies");
const config             = require("../config.json");

// ── helpers ───────────────────────────────────────────────────────────────────

function isAdmin(id) {
  return (config.bot.adminIDs || []).includes(id);
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

// ── local panel (for the current group) ──────────────────────────────────────

async function showPanel(api, threadID) {
  const cached = groupsCache.get(threadID) || {};
  const stats  = groupStats.get(threadID)  || { messageCount: 0, commandCount: 0, lastMessageAt: 0 };

  let name = cached.name || threadID, members = cached.memberCount || "?", admins = "?";
  try {
    const info = await api.getThreadInfo(threadID);
    name    = info.name || cached.name || threadID;
    members = (info.participantIDs || []).length;
    admins  = (info.adminIDs || []).length;
    const c = groupsCache.get(threadID) || {};
    groupsCache.set(threadID, { ...c, name, memberCount: members });
  } catch {}

  const lastActive = stats.lastMessageAt
    ? new Date(stats.lastMessageAt).toLocaleString("ar-SA", {
        hour: "2-digit", minute: "2-digit", day: "numeric", month: "numeric",
      })
    : "لا يوجد";

  const lines = [
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
    "📋 الأوامر المتاحة:",
    "  -control info              ← لوحة التحكم",
    "  -control lock / unlock     ← قفل/فتح الرسائل",
    "  -control mute [دق] / unmute← كتم/رفع الكتم",
    "  -control lockname [اسم]    ← قفل اسم المجموعة",
    "  -control unlockname        ← رفع قفل الاسم",
    "  -control rename [اسم]      ← تغيير الاسم",
    "  -control members           ← قائمة الأعضاء",
    "  -control stats             ← الإحصائيات",
    "  -control kick [ID]         ← طرد عضو",
    "  -control ar set [رسالة]    ← تفعيل رد تلقائي",
    "  -control ar off / on       ← إيقاف/تشغيل الرد",
    "  -control ar wait [دق]      ← وقت الانتظار",
    "  -control ar show           ← عرض إعدادات الرد",
    "  -control remote            ← تحكم عن بُعد بأي مجموعة",
  ];
  return api.sendMessage(lines.join("\n"), threadID);
}

// ── remote control action menu ────────────────────────────────────────────────

async function showRemoteMenu(api, replyThreadID, senderID, target) {
  const isLocked    = lockedThreads.has(target.threadID);
  const muteExp     = mutedThreads.get(target.threadID);
  const isMuted     = muteExp && muteExp > Date.now();
  const hasLockName = lockedNames.has(target.threadID);
  const ar          = autoReplies.get(target.threadID);
  const hasAR       = ar && ar.message;

  const lines = [
    "🎛️ التحكم عن بُعد",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "📌 المجموعة: " + target.name,
    "👥 الأعضاء : " + target.memberCount,
    "",
    "الحالة الحالية:",
    "  🔒 القفل   : " + (isLocked    ? "مفعّل"  : "غير مفعّل"),
    "  🔇 الكتم   : " + (isMuted     ? "مكتوم"  : "غير مكتوم"),
    "  🏷️  قفل الاسم: " + (hasLockName ? "مفعّل"  : "غير مفعّل"),
    "  🤖 رد تلقائي: " + (hasAR       ? (ar.enabled ? "مفعّل" : "معطّل") : "لا يوجد"),
    "",
    "📋 اختر أمراً:",
    "",
    isLocked  ? "1. 🔓 فتح قفل الرسائل"          : "1. 🔒 قفل الرسائل",
    isMuted   ? "2. 🔊 رفع الكتم"                 : "2. 🔇 كتم المجموعة (ستُسأل عن المدة)",
    "3. 💬 إرسال رسالة للمجموعة",
    "4. ✏️ تغيير اسم المجموعة",
    hasLockName ? "5. 🔓 رفع قفل الاسم"           : "5. 🏷️ قفل اسم المجموعة الحالي",
    "6. 📊 إحصائيات المجموعة",
    "7. 👥 معلومات الأعضاء",
    "8. 🎛️ إرسال لوحة التحكم للمجموعة",
    hasAR && ar.enabled ? "9. 🤖 تعطيل الرد التلقائي" : "9. 🤖 تفعيل الرد التلقائي (ستُسأل عن الرسالة)",
    "",
    "0. ❌ إلغاء",
  ];

  await api.sendMessage(lines.join("\n"), replyThreadID);

  pendingReplies.set(senderID, {
    handler: async (input, _api, _event) => {
      const rTID = _event.threadID;
      const rSID = _event.senderID;
      const choice = input.trim();

      if (choice === "0" || choice === "إلغاء") {
        pendingReplies.del(rSID);
        return _api.sendMessage("❌ تم الإلغاء.", rTID);
      }

      // Always clear current pending before setting a nested one
      pendingReplies.del(rSID);

      switch (choice) {

        // ── 1: lock / unlock ────────────────────────────────────────────────
        case "1":
          if (isLocked) {
            lockedThreads.delete(target.threadID);
            _api.sendMessage(
              "✅ تم فتح قفل الرسائل في:\n«" + target.name + "»",
              rTID
            );
            _api.sendMessage("🔓 تم فتح قفل الرسائل عن بُعد بواسطة المشرف.", target.threadID).catch(() => {});
          } else {
            lockedThreads.add(target.threadID);
            _api.sendMessage(
              "✅ تم قفل الرسائل في:\n«" + target.name + "»",
              rTID
            );
            _api.sendMessage("🔒 تم قفل الرسائل عن بُعد بواسطة المشرف.", target.threadID).catch(() => {});
          }
          break;

        // ── 2: mute / unmute ────────────────────────────────────────────────
        case "2":
          if (isMuted) {
            mutedThreads.delete(target.threadID);
            _api.sendMessage(
              "✅ تم رفع الكتم عن:\n«" + target.name + "»",
              rTID
            );
            _api.sendMessage("🔊 تم رفع الكتم عن بُعد.", target.threadID).catch(() => {});
          } else {
            await _api.sendMessage(
              "⏱️ كم دقيقة تريد كتم «" + target.name + "»؟\n(أدخل رقماً، مثال: 30)",
              rTID
            );
            pendingReplies.set(rSID, {
              handler: async (inp2, _api2, _ev2) => {
                pendingReplies.del(_ev2.senderID);
                const mins = Math.max(1, parseInt(inp2) || 60);
                mutedThreads.set(target.threadID, Date.now() + mins * 60000);
                _api2.sendMessage(
                  "✅ تم كتم «" + target.name + "» لمدة " + mins + " دقيقة.",
                  _ev2.threadID
                );
                _api2.sendMessage(
                  "🔇 تم كتم المجموعة لمدة " + mins + " دقيقة عن بُعد.",
                  target.threadID
                ).catch(() => {});
              },
            });
          }
          break;

        // ── 3: send message ─────────────────────────────────────────────────
        case "3":
          await _api.sendMessage(
            "💬 اكتب الرسالة التي تريد إرسالها إلى:\n«" + target.name + "»",
            rTID
          );
          pendingReplies.set(rSID, {
            handler: async (msg, _api2, _ev2) => {
              pendingReplies.del(_ev2.senderID);
              if (!msg.trim()) {
                return _api2.sendMessage("❌ الرسالة فارغة، تم الإلغاء.", _ev2.threadID);
              }
              try {
                await _api2.sendMessage(msg.trim(), target.threadID);
                _api2.sendMessage(
                  "✅ تم إرسال الرسالة إلى «" + target.name + "».",
                  _ev2.threadID
                );
              } catch (e) {
                _api2.sendMessage("❌ فشل الإرسال: " + e.message, _ev2.threadID);
              }
            },
          });
          break;

        // ── 4: rename ───────────────────────────────────────────────────────
        case "4":
          if (lockedNames.has(target.threadID)) {
            return _api.sendMessage(
              "⛔ اسم هذه المجموعة مقفل حالياً.\nاستخدم الخيار 5 لرفع القفل أولاً.",
              rTID
            );
          }
          await _api.sendMessage(
            "✏️ اكتب الاسم الجديد لـ «" + target.name + "»:",
            rTID
          );
          pendingReplies.set(rSID, {
            handler: async (newName, _api2, _ev2) => {
              pendingReplies.del(_ev2.senderID);
              const trimmed = newName.trim();
              if (!trimmed) {
                return _api2.sendMessage("❌ الاسم فارغ، تم الإلغاء.", _ev2.threadID);
              }
              try {
                await _api2.gcname(trimmed, target.threadID);
                const c = groupsCache.get(target.threadID) || {};
                groupsCache.set(target.threadID, { ...c, name: trimmed });
                _api2.sendMessage(
                  "✅ تم تغيير الاسم إلى «" + trimmed + "».",
                  _ev2.threadID
                );
              } catch (e) {
                _api2.sendMessage("❌ فشل تغيير الاسم: " + e.message, _ev2.threadID);
              }
            },
          });
          break;

        // ── 5: lock / unlock name ───────────────────────────────────────────
        case "5":
          if (hasLockName) {
            lockedNames.delete(target.threadID);
            _api.sendMessage(
              "✅ تم رفع قفل الاسم عن «" + target.name + "».",
              rTID
            );
            _api.sendMessage("🔓 تم رفع قفل الاسم عن بُعد.", target.threadID).catch(() => {});
          } else {
            lockedNames.set(target.threadID, target.name);
            _api.sendMessage(
              "✅ تم قفل اسم «" + target.name + "» عن بُعد.",
              rTID
            );
            _api.sendMessage(
              "🏷️ تم قفل اسم المجموعة على «" + target.name + "» عن بُعد.",
              target.threadID
            ).catch(() => {});
          }
          break;

        // ── 6: stats ────────────────────────────────────────────────────────
        case "6": {
          const st   = groupStats.get(target.threadID) || { messageCount: 0, commandCount: 0, lastMessageAt: 0 };
          const last = st.lastMessageAt ? new Date(st.lastMessageAt).toLocaleString("ar-SA") : "لا يوجد";
          _api.sendMessage(
            [
              "📊 إحصائيات «" + target.name + "»",
              "━━━━━━━━━━━━━━━━━",
              "📨 الرسائل  : " + st.messageCount,
              "⚡ الأوامر  : " + st.commandCount,
              "🕒 آخر نشاط: " + last,
            ].join("\n"),
            rTID
          );
          break;
        }

        // ── 7: member info ──────────────────────────────────────────────────
        case "7":
          try {
            const info    = await _api.getThreadInfo(target.threadID);
            const members = info.participantIDs ? info.participantIDs.length : "؟";
            const admins  = info.adminIDs ? info.adminIDs.length : "؟";
            _api.sendMessage(
              "👥 «" + target.name + "»\n" +
              "الأعضاء  : " + members + "\n" +
              "المشرفون: " + admins,
              rTID
            );
          } catch (e) {
            _api.sendMessage("❌ تعذّر جلب المعلومات: " + e.message, rTID);
          }
          break;

        // ── 8: send control panel to group ──────────────────────────────────
        case "8":
          try {
            await showPanel(_api, target.threadID);
            _api.sendMessage(
              "✅ تم إرسال لوحة التحكم إلى «" + target.name + "».",
              rTID
            );
          } catch (e) {
            _api.sendMessage("❌ فشل إرسال لوحة التحكم: " + e.message, rTID);
          }
          break;

        // ── 9: toggle autoreply ─────────────────────────────────────────────
        case "9":
          if (hasAR && ar.enabled) {
            ar.enabled = false;
            autoReplies.set(target.threadID, ar);
            _api.sendMessage(
              "✅ تم تعطيل الرد التلقائي في «" + target.name + "».",
              rTID
            );
          } else if (hasAR && !ar.enabled) {
            ar.enabled = true;
            autoReplies.set(target.threadID, ar);
            _api.sendMessage(
              "✅ تم تفعيل الرد التلقائي في «" + target.name + "».",
              rTID
            );
          } else {
            // No AR yet — ask for message
            await _api.sendMessage(
              "🤖 اكتب رسالة الرد التلقائي لـ «" + target.name + "»:",
              rTID
            );
            pendingReplies.set(rSID, {
              handler: async (msg, _api2, _ev2) => {
                pendingReplies.del(_ev2.senderID);
                const trimmed = msg.trim();
                if (!trimmed) {
                  return _api2.sendMessage("❌ الرسالة فارغة، تم الإلغاء.", _ev2.threadID);
                }
                const existing = autoReplies.get(target.threadID) || { lastSent: new Map(), cooldownMs: 30 * 60000 };
                autoReplies.set(target.threadID, { ...existing, message: trimmed, enabled: true });
                _api2.sendMessage(
                  "✅ تم تفعيل الرد التلقائي في «" + target.name + "»:\n" + trimmed,
                  _ev2.threadID
                );
              },
            });
          }
          break;

        default:
          _api.sendMessage(
            "❌ خيار غير صحيح. اختر رقماً من 0 إلى 9.",
            rTID
          );
      }
    },
  });
}

// ── remote: list all groups and start interactive flow ────────────────────────

async function handleRemote(api, event) {
  const { threadID, senderID } = event;

  if (!isAdmin(senderID)) {
    return api.sendMessage("⛔ التحكم عن بُعد خاص بمشرف البوت فقط.", threadID);
  }

  // Collect groups — prefer named ones first, fall back to threadIDs
  const groups = [...groupsCache.entries()]
    .map(([tid, info]) => ({
      threadID:    tid,
      name:        info.name || tid,
      memberCount: info.memberCount || "؟",
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "ar"));

  if (groups.length === 0) {
    return api.sendMessage(
      "ℹ️ لا توجد مجموعات مسجلة بعد.\n" +
      "أرسل أي رسالة في مجموعة حتى يتعرف عليها البوت.",
      threadID
    );
  }

  const lines = [
    "🎛️ التحكم عن بُعد",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "📋 اختر المجموعة التي تريد التحكم بها:",
    "",
    ...groups.map((g, i) => `${i + 1}. ${g.name}  (${g.memberCount} عضو)`),
    "",
    "اكتب رقم المجموعة | 0 للإلغاء",
  ];

  await api.sendMessage(lines.join("\n"), threadID);

  pendingReplies.set(senderID, {
    handler: async (input, _api, _event) => {
      const rTID = _event.threadID;
      const rSID = _event.senderID;
      const trimmed = input.trim();

      if (trimmed === "0" || trimmed === "إلغاء") {
        pendingReplies.del(rSID);
        return _api.sendMessage("❌ تم إلغاء التحكم عن بُعد.", rTID);
      }

      const idx = parseInt(trimmed) - 1;
      if (isNaN(idx) || idx < 0 || idx >= groups.length) {
        return _api.sendMessage(
          "❌ رقم غير صحيح. اختر من 1 إلى " + groups.length + "، أو 0 للإلغاء.",
          rTID
        );
      }

      const target = groups[idx];
      pendingReplies.del(rSID);
      await showRemoteMenu(_api, rTID, rSID, target);
    },
  });
}

// ── execute ───────────────────────────────────────────────────────────────────

module.exports = {
  name: "control",
  aliases: ["ctrl", "panel", "cp"],
  description: "لوحة تحكم شاملة لإدارة المجموعة، مع دعم التحكم عن بُعد.",
  usage: "control [subcommand] [args]",
  category: "Admin",

  async execute({ api, event, args }) {
    const { threadID, senderID } = event;
    const sub = (args[0] || "").toLowerCase();

    // ── no args → show panel ──────────────────────────────────────────────
    if (!sub || sub === "info") return showPanel(api, threadID);

    // ── remote control ────────────────────────────────────────────────────
    if (sub === "remote" || sub === "r") return handleRemote(api, event);

    // ── admin guard ───────────────────────────────────────────────────────
    const NEED_ADMIN = [
      "lock","unlock","mute","unmute","rename",
      "kick","ar","autoreply","lockname","unlockname",
    ];
    if (NEED_ADMIN.includes(sub) && !isAdmin(senderID)) {
      return api.sendMessage("⛔ هذا الأمر خاص بالمشرفين فقط.", threadID);
    }

    // ── lock (messages) ───────────────────────────────────────────────────
    if (sub === "lock") {
      lockedThreads.add(threadID);
      return api.sendMessage("🔒 تم قفل المجموعة. لا يمكن إرسال رسائل حتى يُرفع القفل.", threadID);
    }

    // ── unlock (messages) ─────────────────────────────────────────────────
    if (sub === "unlock") {
      lockedThreads.delete(threadID);
      return api.sendMessage("🔓 تم فتح قفل الرسائل. المجموعة تعمل بشكل طبيعي.", threadID);
    }

    // ── lockname ──────────────────────────────────────────────────────────
    if (sub === "lockname") {
      const nameToLock = args.slice(1).join(" ").trim();

      let finalName = nameToLock;
      if (!finalName) {
        try {
          const info = await api.getThreadInfo(threadID);
          finalName  = info.name || "";
        } catch {}
      }

      if (!finalName) {
        return api.sendMessage(
          "❌ لم أتمكن من تحديد الاسم.\nالاستخدام: -control lockname [الاسم]",
          threadID
        );
      }

      if (nameToLock) {
        try { await api.gcname(finalName, threadID); } catch {}
      }

      lockedNames.set(threadID, finalName);
      const c = groupsCache.get(threadID) || {};
      groupsCache.set(threadID, { ...c, name: finalName });

      return api.sendMessage(
        "🏷️ تم قفل اسم المجموعة على:\n«" + finalName + "»\n\n" +
        "أي محاولة لتغيير الاسم ستُتجاهل وسيُعاد الاسم الأصلي تلقائياً.",
        threadID
      );
    }

    // ── unlockname ────────────────────────────────────────────────────────
    if (sub === "unlockname") {
      const wasLocked = lockedNames.get(threadID);
      if (!wasLocked) {
        return api.sendMessage("ℹ️ اسم هذه المجموعة غير مقفل أصلاً.", threadID);
      }
      lockedNames.delete(threadID);
      return api.sendMessage(
        "🔓 تم رفع قفل الاسم.\nيمكن الآن تغيير اسم المجموعة بحرية.",
        threadID
      );
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

      if (lockedNames.has(threadID)) {
        return api.sendMessage(
          "⛔ الاسم مقفل حالياً على «" + lockedNames.get(threadID) + "».\n" +
          "استخدم -control unlockname أولاً لرفع القفل.",
          threadID
        );
      }

      try {
        await api.gcname(newName, threadID);
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
        const uInfos   = ids.length ? await api.getUserInfo(ids) : {};
        const lines    = ids.map((id, i) => {
          const n = uInfos[id] ? uInfos[id].name : id;
          return (i + 1) + ". " + n + (adminSet.has(id) ? " 👑" : "");
        });
        return api.sendMessage("👥 الأعضاء (" + ids.length + "):\n" + lines.join("\n"), threadID);
      } catch (e) {
        return api.sendMessage("❌ تعذّر جلب قائمة الأعضاء.\n" + e.message, threadID);
      }
    }

    // ── stats ─────────────────────────────────────────────────────────────
    if (sub === "stats") {
      const st   = groupStats.get(threadID) || { messageCount: 0, commandCount: 0, lastMessageAt: 0 };
      const last = st.lastMessageAt ? new Date(st.lastMessageAt).toLocaleString("ar-SA") : "لا يوجد";
      return api.sendMessage(
        [
          "📊 إحصائيات المجموعة",
          "━━━━━━━━━━━━━━━━━━",
          "📨 إجمالي الرسائل  : " + st.messageCount,
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

      if (action === "show" || action === "status") {
        const ar = autoReplies.get(threadID);
        if (!ar || !ar.message) {
          return api.sendMessage(
            "🤖 لا يوجد رد تلقائي مُعيَّن.\nلإضافة واحد: -control ar set [الرسالة]",
            threadID
          );
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

      if (action === "set") {
        const msg = args.slice(2).join(" ").trim();
        if (!msg) return api.sendMessage("❌ الاستخدام: -control ar set [الرسالة]", threadID);
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
        if (!ex || !ex.message) {
          return api.sendMessage("❌ لا توجد رسالة مُعيَّنة. استخدم: -control ar set [رسالة]", threadID);
        }
        ex.enabled = true;
        autoReplies.set(threadID, ex);
        return api.sendMessage("🤖 تم تفعيل الرد التلقائي.", threadID);
      }

      if (action === "wait" || action === "cooldown") {
        const mins = parseInt(args[2]) || 30;
        const ex   = autoReplies.get(threadID) || { message: "", enabled: false, lastSent: new Map() };
        ex.cooldownMs = mins * 60000;
        autoReplies.set(threadID, ex);
        return api.sendMessage("⏱️ تم تعيين وقت الانتظار: " + mins + " دقيقة لكل مستخدم.", threadID);
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
