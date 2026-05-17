"use strict";

const fs            = require("fs");
const os            = require("os");
const path          = require("path");
const https         = require("https");
const { execFileSync, execSync } = require("child_process");

const YTDLP_BIN = path.join(os.tmpdir(), "yt-dlp-standalone");

// ── تحميل yt-dlp standalone binary (لا يحتاج Python) ─────────────────────────
async function ensureYtDlp() {
  // إذا كان موجوداً وصالحاً نتخطى التحميل
  if (fs.existsSync(YTDLP_BIN)) {
    try {
      execFileSync(YTDLP_BIN, ["--version"], { stdio: "pipe", timeout: 5000 });
      return; // ✅ موجود وصالح
    } catch {
      fs.unlinkSync(YTDLP_BIN); // تالف، احذفه وأعد التحميل
    }
  }

  const url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
  // استخدام curl لتحميل الملف (يتعامل مع الـ redirects تلقائياً)
  execSync(`curl -L --silent --output "${YTDLP_BIN}" "${url}"`, {
    timeout: 120000,
    stdio: "pipe",
  });
  fs.chmodSync(YTDLP_BIN, 0o755);
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`⏳ انتهت مهلة ${label} (${ms / 1000}s)`)), ms)
    ),
  ]);
}

async function searchVideo(query) {
  const ytSearch = require("yt-search");
  const result   = await withTimeout(ytSearch(query), 15000, "البحث");
  const videos   = (result.videos || []).filter(v => v.seconds && v.seconds < 600);
  if (!videos.length) throw new Error("لم يُعثر على نتائج مناسبة لـ: " + query);
  return videos[0];
}

async function downloadAudio(videoUrl, outPath) {
  await withTimeout(ensureYtDlp(), 130000, "تجهيز أداة التحميل");

  // تحميل أفضل صوت بصيغة m4a أو bestaudio، حد أقصى 50MB
  execFileSync(
    YTDLP_BIN,
    [
      "--no-playlist",
      "--max-filesize", "50m",
      "-f", "bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio",
      "-o", outPath,
      "--no-part",
      "--quiet",
      videoUrl,
    ],
    { stdio: "pipe", timeout: 120000 }
  );
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

    await api.sendMessage("🔍 جاري البحث عن: " + query + " ...", threadID).catch(() => {});

    let audioPath = null;

    try {
      // 1. بحث عن الفيديو
      const video = await searchVideo(query);

      // 2. إبلاغ المستخدم
      await api.sendMessage(
        `🎵 وجدتها: ${video.title}\n⏱ المدة: ${video.timestamp || "?"}\n⬇️ جاري التحميل...`,
        threadID
      ).catch(() => {});

      // 3. تحميل الصوت
      audioPath = path.join(os.tmpdir(), "music_" + Date.now() + ".m4a");
      await withTimeout(
        (async () => downloadAudio(video.url, audioPath))(),
        130000,
        "التحميل"
      );

      if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
        throw new Error("الملف الصوتي فارغ أو لم يُنشأ.");
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
      if (audioPath) setTimeout(() => { try { fs.unlinkSync(audioPath); } catch {} }, 20000);
    }
  },
};