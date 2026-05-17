"use strict";

const fs       = require("fs");
const os       = require("os");
const path     = require("path");

let ytSearch, ytdl;
try {
  ytSearch = require("yt-search");
  ytdl     = require("@distube/ytdl-core");
} catch { /* handled in execute */ }

// ── Retry ytdl.getInfo up to 3 times (handles 429 rate-limits) ───────────────
async function getInfoWithRetry(url, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await ytdl.getInfo(url);
    } catch (e) {
      const is429 = e.statusCode === 429 || (e.message && e.message.includes("429"));
      if (is429 && i < attempts - 1) {
        await new Promise(r => setTimeout(r, 3000 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
}

// ── Pick the best audio-only format (prefer m4a for Messenger compatibility) ──
function pickAudioFormat(formats) {
  const audioOnly = formats.filter(f => f.hasAudio && !f.hasVideo);
  // m4a (audio/mp4) is natively playable in Facebook Messenger
  const m4a = audioOnly.find(f => f.mimeType && f.mimeType.startsWith("audio/mp4"));
  if (m4a) return { format: m4a, ext: ".m4a" };
  // fallback: any audio-only format
  if (audioOnly[0]) return { format: audioOnly[0], ext: ".mp4" };
  // last resort: audio+video (extract audio side)
  return { format: formats[0], ext: ".mp4" };
}

// ── Download with a Promise wrapper ──────────────────────────────────────────
function streamToFile(info, format, dest) {
  return new Promise((resolve, reject) => {
    const dl   = ytdl.downloadFromInfo(info, { format });
    const file = fs.createWriteStream(dest);
    dl.pipe(file);
    file.on("finish", resolve);
    file.on("error",  reject);
    dl.on("error",    reject);
  });
}

module.exports = {
  name: "music",
  aliases: ["song", "\u0627\u063a\u0646\u064a\u0629", "\u0623\u063a\u0646\u064a\u0629", "mp3"],
  description: "\u0627\u0644\u0628\u062d\u062b \u0639\u0646 \u0623\u063a\u0646\u064a\u0629 \u0648\u0625\u0631\u0633\u0627\u0644\u0647\u0627 \u0643\u0627\u0645\u0644\u0629 \u0643\u0631\u0633\u0627\u0644\u0629 \u0635\u0648\u062a\u064a\u0629.",
  usage: "music [\u0627\u0633\u0645 \u0627\u0644\u0623\u063a\u0646\u064a\u0629 \u0623\u0648 \u0627\u0644\u0641\u0646\u0627\u0646]",
  category: "Entertainment",

  async execute({ api, event, args }) {
    const { threadID } = event;
    const query = args.join(" ").trim();

    if (!query) {
      return api.sendMessage(
        "\uD83C\uDFB5 \u0627\u0644\u0627\u0633\u062a\u062e\u062f\u0627\u0645: -music [\u0627\u0633\u0645 \u0627\u0644\u0623\u063a\u0646\u064a\u0629]\n\u0623\u0645\u062b\u0644\u0629:\n  -music Blinding Lights\n  -music Fairuz",
        threadID
      );
    }

    if (!ytSearch || !ytdl) {
      return api.sendMessage("\u274C \u0645\u0643\u062a\u0628\u0629 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0645\u0648\u0633\u064a\u0642\u0649 \u063a\u064a\u0631 \u0645\u062a\u0648\u0641\u0631\u0629. \u0623\u0639\u062f \u062a\u0634\u063a\u064a\u0644 \u0627\u0644\u0628\u0648\u062a.", threadID);
    }

    await api.sendMessage("\uD83D\uDD0D \u062c\u0627\u0631\u064d \u0627\u0644\u0628\u062d\u062b \u0639\u0646: " + query + " ...", threadID);

    // ── Search YouTube ────────────────────────────────────────────────────────
    let video;
    try {
      const result = await ytSearch(query);
      const list   = (result.videos || []).filter(v => v.seconds > 0 && v.seconds <= 600);
      video = list[0] || (result.videos || [])[0];
    } catch (e) {
      return api.sendMessage("\u274C \u0641\u0634\u0644 \u0627\u0644\u0628\u062d\u062b: " + e.message, threadID);
    }

    if (!video) {
      return api.sendMessage("\uD83D\uDE15 \u0644\u0645 \u064a\u064f\u0639\u062b\u0631 \u0639\u0644\u0649 \u0646\u062a\u0627\u0626\u062c \u0644\u0640 \u00ab" + query + "\u00bb.", threadID);
    }

    await api.sendMessage(
      "\u2B07\uFE0F \u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644: " + video.title + " (" + video.timestamp + ") ...",
      threadID
    );

    // ── Fetch video info (with 429 retry) ─────────────────────────────────────
    let info;
    try {
      info = await getInfoWithRetry(video.url);
    } catch (e) {
      return api.sendMessage(
        "\u274C \u062a\u0639\u0630\u0651\u0631 \u062c\u0644\u0628 \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0623\u063a\u0646\u064a\u0629.\n" + e.message,
        threadID
      );
    }

    // ── Pick m4a format ───────────────────────────────────────────────────────
    const { format, ext } = pickAudioFormat(info.formats);
    const audioPath = path.join(os.tmpdir(), "music_" + Date.now() + ext);

    // ── Download audio ────────────────────────────────────────────────────────
    try {
      await streamToFile(info, format, audioPath);
    } catch (e) {
      try { fs.unlinkSync(audioPath); } catch {}
      return api.sendMessage(
        "\u274C \u0641\u0634\u0644 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0623\u063a\u0646\u064a\u0629.\n" + e.message,
        threadID
      );
    }

    const caption =
      "\uD83C\uDFB5 " + video.title + "\n" +
      "\uD83C\uDFA4 " + (video.author && video.author.name ? video.author.name : "") + "\n" +
      "\u23F1 " + video.timestamp;

    // ── Send as audio message (60 s timeout) ──────────────────────────────────
    const cleanup = () => { setTimeout(() => { try { fs.unlinkSync(audioPath); } catch {} }, 5000); };

    try {
      await Promise.race([
        api.sendMessage({ body: caption, attachment: fs.createReadStream(audioPath) }, threadID),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 60000)),
      ]);
    } catch (e) {
      const reason = e.message === "timeout"
        ? "\u274C \u0627\u0646\u062a\u0647\u062a \u0645\u062f\u0629 \u0627\u0644\u0625\u0631\u0633\u0627\u0644. \u062a\u0623\u0643\u062f \u0645\u0646 \u062d\u062c\u0645 \u0627\u0644\u0645\u0644\u0641 \u0623\u0648 \u062c\u0631\u0651\u0628 \u0623\u063a\u0646\u064a\u0629 \u0623\u0642\u0635\u0631."
        : "\u274C \u062a\u0639\u0630\u0651\u0631 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0635\u0648\u062a\u064a.\n" + e.message;
      api.sendMessage(reason + "\n" + caption, threadID).catch(() => {});
    } finally {
      cleanup();
    }
  },
};
