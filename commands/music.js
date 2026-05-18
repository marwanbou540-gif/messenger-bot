"use strict";

/**
 * music.js — Audio command powered by musicEngine (production-grade).
 *
 * Engine features (handled transparently):
 *   ✅ yt-dlp download via native Node.js HTTPS (no curl/wget)
 *   ✅ Automatic redirect following
 *   ✅ Binary integrity validation + auto-repair
 *   ✅ iTunes 30s preview fallback when YouTube fails
 *   ✅ Concurrency semaphore (max 2 parallel downloads)
 *   ✅ Per-user cooldown (35s)
 *   ✅ Automatic temp file cleanup
 */

const fs     = require("fs");
const engine = require("../utils/musicEngine");

module.exports = {
  name: "music",
  aliases: ["song", "اغنية", "أغنية", "mp3"],
  description: "البحث عن أغنية وإرسالها كاملة.",
  usage: "music [اسم الأغنية أو الفنان]",
  category: "Entertainment",

  async execute({ api, event, args }) {
    const { threadID, senderID } = event;
    const query = args.join(" ").trim();

    // ── مساعد التشخيص (للمطور فقط) ─────────────────────────────────────────
    if (query === "diag") {
      const d = engine.diagnostics();
      return api.sendMessage(
        `🔧 تشخيص المحرك الموسيقي:\n` +
        `• yt-dlp: ${d.ytdlpPath}\n` +
        `• تحميلات جارية: ${d.concurrent}\n` +
        `• في الانتظار: ${d.queued}\n` +
        `• ملفات مؤقتة: ${d.tmpFiles}\n` +
        `• مجلد مؤقت: ${d.tmpDir}`,
        threadID
      );
    }

    // ── تحقق من الطلب ───────────────────────────────────────────────────────
    if (!query) {
      return api.sendMessage(
        "🎵 الاستخدام: -music [اسم الأغنية]\n" +
        "أمثلة:\n" +
        "  -music GMFU\n" +
        "  -music محمد عبده\n" +
        "  -music Blinding Lights The Weeknd",
        threadID
      );
    }

    // ── cooldown ─────────────────────────────────────────────────────────────
    const remaining = engine.userCooldown(senderID);
    if (remaining > 0) {
      return api.sendMessage(
        `⏳ انتظر ${remaining} ثانية قبل طلب أغنية أخرى.`,
        threadID
      );
    }
    engine.markUser(senderID);

    // ── بحث ─────────────────────────────────────────────────────────────────
    await api.sendMessage("🔍 جاري البحث عن: " + query + " ...", threadID).catch(() => {});

    let track;
    try {
      track = await engine.search(query);
    } catch (e) {
      return api.sendMessage("😕 " + e.message, threadID).catch(() => {});
    }

    // ── إبلاغ المستخدم بما وجده البوت ───────────────────────────────────────
    const previewNote = track.preview ? "\n⚠️ معاينة 30 ثانية فقط (iTunes)" : "";
    await api.sendMessage(
      `🎵 وجدتها: ${track.title}` +
      (track.artist   ? `\n🎤 ${track.artist}`   : "") +
      (track.duration ? `\n⏱ ${track.duration}` : "") +
      previewNote +
      "\n⬇️ جاري التحميل...",
      threadID
    ).catch(() => {});

    // ── تحميل ───────────────────────────────────────────────────────────────
    let audioPath;
    try {
      audioPath = await engine.download(track);
    } catch (e) {
      return api.sendMessage("❌ فشل التحميل:\n" + e.message.slice(0, 300), threadID).catch(() => {});
    }

    // ── إرسال ────────────────────────────────────────────────────────────────
    const caption =
      "🎵 " + track.title +
      (track.artist   ? "\n🎤 " + track.artist   : "") +
      (track.duration ? "\n⏱ "  + track.duration : "") +
      (track.preview  ? "\n⚠️ معاينة 30 ثانية (iTunes)" : "");

    try {
      await Promise.race([
        api.sendMessage({ body: caption, attachment: fs.createReadStream(audioPath) }, threadID),
        new Promise((_, rej) => setTimeout(() => rej(new Error("send_timeout")), 90_000)),
      ]);
    } catch (e) {
      const msg = e.message === "send_timeout"
        ? "❌ انتهت مهلة الإرسال. جرّب أغنية أقصر."
        : "❌ تعذّر إرسال الملف:\n" + e.message.slice(0, 200);
      await api.sendMessage(msg, threadID).catch(() => {});
    } finally {
      engine.safeDelete(audioPath);
    }
  },
};