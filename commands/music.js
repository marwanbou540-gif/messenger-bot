"use strict";

const fs   = require("fs");
const os   = require("os");
const path = require("path");

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`⏳ انتهت مهلة ${label} بعد ${ms / 1000}s`)), ms)
    ),
  ]);
}

async function searchVideo(query) {
  const ytSearch = require("yt-search");
  const result   = await withTimeout(ytSearch(query), 15000, "البحث");
  const videos   = result.videos || [];
  if (!videos.length) throw new Error("لم يُعثر على نتائج لـ: " + query);
  // أقصر من 8 دقائق يُفضَّل
  return videos.find(v => v.seconds && v.seconds < 480) || videos[0];
}

async function downloadAudio(videoUrl, audioPath) {
  const ytdl = require("@distube/ytdl-core");

  // جرب m4a أولاً (Facebook يقبلها)، ثم أي صوت
  const formats = ytdl.filterFormats(
    (await withTimeout(ytdl.getInfo(videoUrl), 20000, "جلب معلومات الأغنية")).formats,
    f => f.hasAudio && !f.hasVideo
  );

  const m4aFmt = formats.find(f => f.container === "mp4" || f.mimeType?.includes("mp4"));
  const chosen  = m4aFmt || formats[0];
  if (!chosen) throw new Error("لا يوجد تنسيق صوتي متاح.");

  const ext = (m4aFmt ? ".m4a" : ".webm");
  const finalPath = audioPath.replace(".tmp", ext);

  await withTimeout(
    new Promise((resolve, reject) => {
      const stream = ytdl(videoUrl, { format: chosen });
      const ws     = fs.createWriteStream(finalPath);
      stream.pipe(ws);
      ws.on("finish", () => resolve(finalPath));
      ws.on("error",  reject);
      stream.on("error", reject);
    }),
    120000,
    "التحميل"
  );

  return finalPath;
}

module.exports = {
  name: "music",
  aliases: ["song", "اغنية", "أغنية", "mp3"],
  description: "البحث عن أغنية وإرسالها.",
  usage: "music [اسم الأغنية أو الفنان]",
  category: "Entertainment",

  async execute({ api, event, args }) {
    const { threadID } = event;
    const query = args.join(" ").trim();

    if (!query) {
      return api.sendMessage(
        "🎵 الاستخدام: -music [اسم الأغنية]\nأمثلة:\n  -music GMFU\n  -music محمد عبده",
        threadID
      );
    }

    const statusMsg = await api.sendMessage("🔍 جاري البحث عن: " + query + " ...", threadID)
      .catch(() => null);

    let audioPath = null;

    try {
      // 1. بحث
      const video = await searchVideo(query);

      // 2. إبلاغ المستخدم باسم الأغنية الفعلي
      if (statusMsg) {
        api.sendMessage(
          `🎵 وجدتها: ${video.title}\n⏱ المدة: ${video.timestamp || "?"}\n⬇️ جاري التحميل...`,
          threadID
        ).catch(() => {});
      }

      // 3. تحميل
      audioPath = await downloadAudio(video.url, path.join(os.tmpdir(), "music_" + Date.now() + ".tmp"));

      if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
        throw new Error("الملف الصوتي فارغ بعد التحميل.");
      }

      const caption =
        "🎵 " + video.title +
        (video.author?.name ? "\n🎤 " + video.author.name : "") +
        (video.timestamp    ? "\n⏱ "  + video.timestamp   : "");

      // 4. إرسال
      await Promise.race([
        api.sendMessage({ body: caption, attachment: fs.createReadStream(audioPath) }, threadID),
        new Promise((_, rej) => setTimeout(() => rej(new Error("send_timeout")), 90000)),
      ]);

    } catch (e) {
      const msg = e.message === "send_timeout"
        ? "❌ انتهت مهلة الإرسال. جرّب أغنية أقصر."
        : "❌ فشل تحميل الأغنية.\n" + e.message.slice(0, 300);
      await api.sendMessage(msg, threadID).catch(() => {});
    } finally {
      if (audioPath) {
        setTimeout(() => { try { fs.unlinkSync(audioPath); } catch {} }, 20000);
      }
    }
  },
};