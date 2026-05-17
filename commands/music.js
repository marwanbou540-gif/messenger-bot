"use strict";

const fs   = require("fs");
const os   = require("os");
const path = require("path");

async function searchAndDownload(query, audioPath) {
  const playdl = require("play-dl");

  const results = await playdl.search(query, {
    source: { youtube: "video" },
    limit: 5,
  });

  if (!results || results.length === 0) {
    throw new Error("لم يُعثر على نتائج لـ: " + query);
  }

  const video =
    results.find(v => v.durationInSec && v.durationInSec < 600) || results[0];

  if (!video) throw new Error("لا توجد نتائج مناسبة");

  const stream = await playdl.stream(video.url, { quality: 2 });

  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(audioPath);
    stream.stream.pipe(writeStream);
    writeStream.on("finish", () =>
      resolve({
        title:    video.title            || query,
        channel:  video.channel?.name   || "",
        duration: video.durationRaw     || "",
      })
    );
    writeStream.on("error", reject);
    stream.stream.on("error", reject);
  });
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
        "🎵 الاستخدام: -music [اسم الأغنية]\nأمثلة:\n  -music Blinding Lights\n  -music محمد عبده",
        threadID
      );
    }

    await api.sendMessage("🔍 جاري البحث والتحميل: " + query + " ...", threadID);

    const audioPath = path.join(os.tmpdir(), "music_" + Date.now() + ".webm");

    try {
      const { title, channel, duration } = await searchAndDownload(query, audioPath);

      if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
        return api.sendMessage("❌ لم ينشأ ملف الصوت. حاول مرة أخرى.", threadID);
      }

      const caption =
        "🎵 " + title +
        (channel  ? "\n🎤 " + channel  : "") +
        (duration ? "\n⏱ "  + duration : "");

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
        const msg =
          e.message === "send_timeout"
            ? "❌ انتهت مهلة الإرسال. جرّب أغنية أقصر."
            : "❌ تعذّر إرسال الملف.\n" + e.message;
        await api.sendMessage(msg, threadID).catch(() => {});
      }
    } catch (e) {
      await api.sendMessage(
        "❌ فشل تحميل الأغنية.\n" + e.message.slice(0, 250),
        threadID
      );
    } finally {
      setTimeout(() => {
        try { fs.unlinkSync(audioPath); } catch {}
      }, 15000);
    }
  },
};
