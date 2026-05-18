"use strict";

const fs     = require("fs");
const engine = require("../utils/musicEngine");

// ── helpers ───────────────────────────────────────────────────────────────────
function buildCaption(track) {
  const lines = ["🎵 " + track.title];
  if (track.artist)   lines.push("🎤 " + track.artist);
  if (track.duration) lines.push("⏱ "  + track.duration);
  if (track.preview)  lines.push("ℹ️  معاينة 30 ثانية (لم يُعثر على النسخة الكاملة)");
  return lines.join("\n");
}

// ── execute ───────────────────────────────────────────────────────────────────
module.exports = {
  name: "music",
  aliases: ["song", "اغنية", "أغنية", "mp3"],
  description: "البحث عن أغنية وإرسالها صوتياً.",
  usage: "music [اسم الأغنية أو الفنان]",
  category: "Entertainment",

  async execute({ api, event, args }) {
    const { threadID, senderID } = event;

    // ── diagnostics subcommand ────────────────────────────────────────────
    if (args[0] === "diag" || args[0] === "status") {
      const d = engine.diagnostics();
      return api.sendMessage(
        [
          "🔧 حالة نظام الموسيقى",
          "━━━━━━━━━━━━━━━━━━",
          "yt-dlp : " + d.ytdlpPath,
          "نشط   : " + d.concurrent + " تحميل",
          "انتظار: " + d.queued    + " طلب",
          "ملفات مؤقتة: " + d.tmpFiles,
          "مجلد مؤقت: " + d.tmpDir,
        ].join("\n"),
        threadID
      );
    }

    // ── input validation ──────────────────────────────────────────────────
    const query = args.join(" ").trim();
    if (!query) {
      return api.sendMessage(
        [
          "🎵 الاستخدام: -music [اسم الأغنية]",
          "",
          "أمثلة:",
          "  -music GMFU",
          "  -music محمد عبده",
          "  -music The Weeknd Blinding Lights",
          "  -music كلثوم أنا في انتظارك",
        ].join("\n"),
        threadID
      );
    }

    if (query.length > 200) {
      return api.sendMessage("❌ الاستعلام طويل جداً (الحد الأقصى 200 حرف).", threadID);
    }

    // ── user cooldown ─────────────────────────────────────────────────────
    const wait = engine.userCooldown(senderID);
    if (wait > 0) {
      return api.sendMessage(`⏳ انتظر ${wait} ثانية قبل طلب أغنية أخرى.`, threadID);
    }
    engine.markUser(senderID);

    // ── notify ────────────────────────────────────────────────────────────
    await api.sendMessage("🔍 جاري البحث عن: " + query + " ...", threadID).catch(() => {});

    let audioPath = null;
    try {
      // 1. search
      const track = await engine.search(query);

      // 2. notify user of match
      await api.sendMessage(
        [
          "🎵 وجدتها: " + track.title,
          track.artist   ? "🎤 " + track.artist   : "",
          track.duration ? "⏱ "  + track.duration : "",
          "⬇️ جاري التحميل...",
          track.preview  ? "ℹ️  ستُرسَل معاينة 30 ثانية" : "",
        ].filter(Boolean).join("\n"),
        threadID
      ).catch(() => {});

      // 3. download
      audioPath = await engine.download(track);

      // 4. send
      await Promise.race([
        api.sendMessage(
          { body: buildCaption(track), attachment: fs.createReadStream(audioPath) },
          threadID
        ),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("send_timeout")), 90_000)
        ),
      ]);

    } catch (e) {
      const msg = _friendlyError(e.message);
      await api.sendMessage(msg, threadID).catch(() => {});
    } finally {
      if (audioPath) engine.safeDelete(audioPath);
    }
  },
};

function _friendlyError(raw) {
  if (!raw) return "❌ حدث خطأ غير معروف.";
  if (raw.includes("send_timeout"))       return "❌ انتهت مهلة الإرسال. جرّب أغنية أقصر.";
  if (raw.includes("قائمة الانتظار"))    return "❌ " + raw;
  if (raw.includes("انتهت مهلة"))        return "❌ " + raw + "\nالشبكة بطيئة أو الخدمة مؤقتاً غير متاحة.";
  if (raw.includes("لم يُعثر على نتائج")) return "😕 " + raw + "\nجرّب كتابة الاسم بشكل مختلف.";
  if (raw.includes("كبير جداً"))         return "❌ " + raw + "\nحاول أغنية أقصر.";
  if (raw.includes("فارغ"))              return "❌ الملف الصوتي فارغ. حاول مرة أخرى.";
  if (raw.length > 250)                   return "❌ فشل التحميل.\n" + raw.slice(0, 200) + "...";
  return "❌ فشل التحميل.\n" + raw;
}
