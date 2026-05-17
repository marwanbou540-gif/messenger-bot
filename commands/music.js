"use strict";

const fs   = require("fs");
const os   = require("os");
const path = require("path");
const { execSync } = require("child_process");

async function downloadAudio(query, tmpBase) {
  const audioPath = tmpBase + ".m4a";
  
  try {
    // محاولة استخدام yt-dlp أولاً (أكثر استقراراً)
    try {
      const ytDlpCmd = `yt-dlp -f "bestaudio[ext=m4a]/bestaudio" -o "${audioPath}" "ytsearch1:${query}" 2>&1`;
      execSync(ytDlpCmd, { 
        stdio: "pipe",
        maxBuffer: 10 * 1024 * 1024
      });
      return { audioPath, title: query, channel: "", duration: "" };
    } catch (err) {
      console.error("yt-dlp failed:", err.message);
    }
    
    // إذا فشل yt-dlp، جرب youtube-dl-exec
    const youtubeDl = require("youtube-dl-exec");
    const info = await youtubeDl("ytsearch1:" + query, {
      dumpSingleJson: true,
      noPlaylist: true,
      noWarnings: true,
      format: "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
    });

    const videoUrl = info.webpage_url || info.original_url || info.url;
    await youtubeDl(videoUrl, {
      format: "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
      output: audioPath,
      noPlaylist: true,
      quiet: true,
      noWarnings: true,
      maxFilesize: "50m",
    });

    return {
      audioPath,
      title: info.title || query,
      channel: info.uploader || info.channel || "",
      duration: info.duration_string || "",
    };
  } catch (e) {
    throw new Error(`فشل التحميل: ${e.message}`);
  }
}

module.exports = {
  name: "music",
  aliases: ["song", "اغنية", "أغنية", "mp3"],
  description: "البحث عن أغنية وإرسالها كاملة.",
  usage: "music [اسم الأغنية أو الفنان]",
  category: "Entertainment",

  async execute({ api, event, args }) {
    const { threadID } = event;
    const query = args.join(" ").trim();

    if (!query) {
      return api.sendMessage(
        "🎵 الاستخدام: -music [اسم الأغنية]\nأمثلة:\n  -music Blindings\n  -music محمد عبده",
        threadID
      );
    }

    await api.sendMessage(
      "🔍 جاري البحث والتحميل: " + query + " ...",
      threadID
    );

    const tmpBase = path.join(os.tmpdir(), "music_" + Date.now());
    let meta;

    try {
      meta = await downloadAudio(query, tmpBase);
    } catch (e) {
      // تنظيف الملفات الجزئية
      for (const ext of ["m4a", "webm", "mp3", "opus"]) {
        try { fs.unlinkSync(tmpBase + "." + ext); } catch {}
      }
      return api.sendMessage(
        "❌ فشل تحميل الأغنية.\n" + e.message.slice(0, 250),
        threadID
      );
    }

    const { audioPath, title, channel, duration } = meta;

    if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
      return api.sendMessage(
        "❌ لم ينشأ ملف الصوت. حاول مرة أخرى.",
        threadID
      );
    }

    const caption =
      "🎵 " + title +
      (channel  ? "\n🎤 " + channel  : "") +
      (duration ? "\n⏱ "  + duration : "");

    const cleanup = () =>
      setTimeout(() => { try { fs.unlinkSync(audioPath); } catch {} }, 15000);

    try {
      await Promise.race([
        api.sendMessage(
          { body: caption, attachment: fs.createReadStream(audioPath) },
          threadID
        ),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("send_timeout")), 90000)
        ),
      ]);
    } catch (e) {
      const msg = e.message === "send_timeout"
        ? "❌ انتهت مهلة الإرسال. جرّب أغنية أقصر."
        : "❌ تعذّر إرسال الملف.\n" + e.message;
      api.sendMessage(msg + "\n" + caption, threadID).catch(() => {});
    } finally {
      cleanup();
    }
  },
};
