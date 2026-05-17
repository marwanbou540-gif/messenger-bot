"use strict";

const https = require("https");
const http  = require("http");
const fs    = require("fs");
const os    = require("os");
const path  = require("path");

// ── iTunes Search API (free, no key) ─────────────────────────────────────────

function itunesSearch(query) {
  return new Promise((resolve, reject) => {
    const q   = encodeURIComponent(query);
    const url = "https://itunes.apple.com/search?term=" + q +
                "&media=music&entity=song&limit=10&lang=en_us";
    const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Parse error: " + e.message)); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

// ── Download a URL to a temp file (follows redirects) ────────────────────────

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    function get(u, redirects) {
      if (redirects > 5) { file.close(); return reject(new Error("Too many redirects")); }
      const proto = u.startsWith("https") ? https : http;
      proto.get(u, { headers: { "User-Agent": "Mozilla/5.0" } }, res => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
          return get(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          file.close();
          return reject(new Error("HTTP " + res.statusCode));
        }
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(dest); });
        file.on("error",  reject);
      }).on("error", e => { file.close(); reject(e); });
    }
    get(url, 0);
  });
}

// ── Format duration ms → m:ss ─────────────────────────────────────────────────

function fmtDuration(ms) {
  if (!ms) return "?:??";
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

// ── Main command ──────────────────────────────────────────────────────────────

module.exports = {
  name: "music",
  aliases: ["song", "اغنية", "أغنية", "mp3"],
  description: "البحث عن أغنية وإرسالها كرسالة صوتية.",
  usage: "music [اسم الأغنية أو الفنان]",
  category: "Entertainment",

  async execute({ api, event, args }) {
    const { threadID } = event;
    const query = args.join(" ").trim();

    if (!query) {
      return api.sendMessage(
        "🎵 الاستخدام: -music [اسم الأغنية]\n" +
        "أمثلة:\n" +
        "  -music Blinding Lights\n" +
        "  -music The Weeknd\n" +
        "  -music Fairuz",
        threadID
      );
    }

    await api.sendMessage("🔍 جارٍ البحث عن: " + query + " ...", threadID);

    // ── Search ──
    let results;
    try {
      const data = await itunesSearch(query);
      results = (data.results || []).filter(r => r.kind === "song" && r.previewUrl);
    } catch (e) {
      return api.sendMessage("❌ فشل الاتصال بخادم البحث.\n" + e.message, threadID);
    }

    if (!results || results.length === 0) {
      return api.sendMessage(
        "😕 لم يُعثر على نتائج لـ «" + query + "».\n" +
        "جرّب تغيير الكلمات أو الكتابة بالإنجليزية.",
        threadID
      );
    }

    const track = results[0];
    const year  = track.releaseDate ? track.releaseDate.slice(0, 4) : "";
    const genre = track.primaryGenreName || "";

    // ── Download 30-second audio preview ──
    const audioPath = path.join(os.tmpdir(), "music_" + Date.now() + ".m4a");

    try {
      await download(track.previewUrl, audioPath);
    } catch (e) {
      return api.sendMessage(
        "❌ فشل تحميل الأغنية.\n" +
        "🎵 " + track.trackName + " — " + track.artistName,
        threadID
      );
    }

    const caption =
      "🎵 " + track.trackName + "\n" +
      "🎤 " + track.artistName + "\n" +
      "💿 " + (track.collectionName || "Single") +
      (year  ? "  •  📅 " + year  : "") +
      (genre ? "  •  🎼 " + genre : "") + "\n" +
      "⏱ " + fmtDuration(track.trackTimeMillis) + "  •  🎧 معاينة 30 ثانية";

    try {
      await api.sendMessage(
        { body: caption, attachment: fs.createReadStream(audioPath) },
        threadID
      );
    } catch (e) {
      api.sendMessage(
        "❌ تعذّر إرسال الملف الصوتي.\n" + caption,
        threadID
      ).catch(() => {});
    } finally {
      setTimeout(() => { try { fs.unlinkSync(audioPath); } catch {} }, 15000);
    }
  },
};
