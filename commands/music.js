"use strict";

const fs   = require("fs");
const os   = require("os");
const path = require("path");

let play;
try { play = require("play-dl"); } catch { /* handled in execute */ }

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

    if (!play) {
      return api.sendMessage("\u274C \u0645\u0643\u062a\u0628\u0629 play-dl \u063a\u064a\u0631 \u0645\u062b\u0628\u062a\u0629. \u0623\u0639\u062f \u062a\u0634\u063a\u064a\u0644 \u0627\u0644\u0628\u0648\u062a.", threadID);
    }

    await api.sendMessage("\uD83D\uDD0D \u062c\u0627\u0631\u064d \u0627\u0644\u0628\u062d\u062b \u0639\u0646: " + query + " ...", threadID);

    // ── Search YouTube ────────────────────────────────────────────────────────
    let video;
    try {
      const results = await play.search(query, { source: { youtube: "video" }, limit: 5 });
      video = (results || []).find(v => v.durationInSec > 0 && v.durationInSec <= 600) || (results || [])[0];
    } catch (e) {
      return api.sendMessage("\u274C \u0641\u0634\u0644 \u0627\u0644\u0628\u062d\u062b: " + e.message, threadID);
    }

    if (!video) {
      return api.sendMessage(
        "\uD83D\uDE15 \u0644\u0645 \u064a\u064f\u0639\u062b\u0631 \u0639\u0644\u0649 \u0646\u062a\u0627\u0626\u062c \u0644\u0640 \u00ab" + query + "\u00bb.\n\u062c\u0631\u0651\u0628 \u062a\u063a\u064a\u064a\u0631 \u0627\u0644\u0643\u0644\u0645\u0627\u062a \u0623\u0648 \u0627\u0644\u0643\u062a\u0627\u0628\u0629 \u0628\u0627\u0644\u0625\u0646\u062c\u0644\u064a\u0632\u064a\u0629.",
        threadID
      );
    }

    const dur = video.durationRaw || "?:??";
    await api.sendMessage(
      "\u2B07\uFE0F \u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644: " + video.title + " (" + dur + ") ...",
      threadID
    );

    const audioPath = path.join(os.tmpdir(), "music_" + Date.now() + ".mp4");

    // ── Stream full audio via play-dl ─────────────────────────────────────────
    try {
      const stream = await play.stream(video.url, { quality: 2 });
      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(audioPath);
        stream.stream.pipe(file);
        file.on("finish", resolve);
        file.on("error",  reject);
        stream.stream.on("error", reject);
      });
    } catch (e) {
      try { fs.unlinkSync(audioPath); } catch {}
      return api.sendMessage(
        "\u274C \u0641\u0634\u0644 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0623\u063a\u0646\u064a\u0629.\n" + e.message,
        threadID
      );
    }

    const caption =
      "\uD83C\uDFB5 " + video.title + "\n" +
      "\uD83C\uDFA4 " + (video.channel && video.channel.name ? video.channel.name : "") + "\n" +
      "\u23F1 " + dur;

    // ── Send as audio/voice message ───────────────────────────────────────────
    try {
      await api.sendMessage(
        { body: caption, attachment: fs.createReadStream(audioPath) },
        threadID
      );
    } catch (e) {
      api.sendMessage(
        "\u274C \u062a\u0639\u0630\u0651\u0631 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0635\u0648\u062a\u064a.\n" + caption,
        threadID
      ).catch(() => {});
    } finally {
      setTimeout(() => { try { fs.unlinkSync(audioPath); } catch {} }, 30000);
    }
  },
};
