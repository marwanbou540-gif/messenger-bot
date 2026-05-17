"use strict";

const fs   = require("fs");
const os   = require("os");
const path = require("path");

let youtubeDl = null;
try { youtubeDl = require("youtube-dl-exec"); } catch {}

// ── Download: search + fetch metadata + save audio in one call ────────────────
async function downloadAudio(query, tmpBase) {
  // Step 1 — get video metadata (no download)
  const info = await youtubeDl("ytsearch1:" + query, {
    dumpSingleJson:  true,
    noPlaylist:      true,
    noWarnings:      true,
    // prefer m4a (Messenger-compatible); fall back to any audio-only stream
    format:          "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
  });

  const title    = info.title         || query;
  const channel  = info.uploader || info.channel || "";
  const duration = info.duration_string || "";
  const videoUrl = info.webpage_url   || info.original_url || info.url;
  const ext      = info.ext           || "m4a";

  // Step 2 — download audio to exact path
  const audioPath = tmpBase + "." + ext;
  await youtubeDl(videoUrl, {
    format:      "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
    output:      audioPath,
    noPlaylist:  true,
    quiet:       true,
    noWarnings:  true,
    maxFilesize: "50m",
  });

  return { audioPath, title, channel, duration };
}

// ── Command ───────────────────────────────────────────────────────────────────
module.exports = {
  name: "music",
  aliases: ["song", "\u0627\u063a\u0646\u064a\u0629", "\u0623\u063a\u0646\u064a\u0629", "mp3"],
  description: "\u0627\u0644\u0628\u062d\u062b \u0639\u0646 \u0623\u063a\u0646\u064a\u0629 \u0648\u0625\u0631\u0633\u0627\u0644\u0647\u0627 \u0643\u0627\u0645\u0644\u0629.",
  usage:       "music [\u0627\u0633\u0645 \u0627\u0644\u0623\u063a\u0646\u064a\u0629 \u0623\u0648 \u0627\u0644\u0641\u0646\u0627\u0646]",
  category:    "Entertainment",

  async execute({ api, event, args }) {
    const { threadID } = event;
    const query = args.join(" ").trim();

    if (!query) {
      return api.sendMessage(
        "\uD83C\uDFB5 \u0627\u0644\u0627\u0633\u062a\u062e\u062f\u0627\u0645: -music [\u0627\u0633\u0645 \u0627\u0644\u0623\u063a\u0646\u064a\u0629]\n\u0623\u0645\u062b\u0644\u0629:\n  -music Blinding Lights\n  -music The Weeknd\n  -music Fairuz",
        threadID
      );
    }

    if (!youtubeDl) {
      return api.sendMessage(
        "\u274C \u0645\u0643\u062a\u0628\u0629 youtube-dl-exec \u063a\u064a\u0631 \u0645\u062b\u0628\u062a\u0629. \u0623\u0639\u062f \u062a\u0634\u063a\u064a\u0644 \u0627\u0644\u0628\u0648\u062a.",
        threadID
      );
    }

    await api.sendMessage(
      "\uD83D\uDD0D \u062c\u0627\u0631\u064d \u0627\u0644\u0628\u062d\u062b \u0648\u0627\u0644\u062a\u062d\u0645\u064a\u0644: " + query + " ...",
      threadID
    );

    const tmpBase = path.join(os.tmpdir(), "music_" + Date.now());
    let meta;

    try {
      meta = await downloadAudio(query, tmpBase);
    } catch (e) {
      // Clean up any partial files
      for (const ext of ["m4a", "webm", "mp3", "opus"]) {
        try { fs.unlinkSync(tmpBase + "." + ext); } catch {}
      }
      return api.sendMessage(
        "\u274C \u0641\u0634\u0644 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0623\u063a\u0646\u064a\u0629.\n" +
        ((e.stderr || e.message || "").toString().slice(0, 250)),
        threadID
      );
    }

    const { audioPath, title, channel, duration } = meta;

    if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
      return api.sendMessage(
        "\u274C \u0644\u0645 \u064a\u064f\u0646\u0634\u0623 \u0645\u0644\u0641 \u0627\u0644\u0635\u0648\u062a. \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.",
        threadID
      );
    }

    const caption =
      "\uD83C\uDFB5 " + title +
      (channel  ? "\n\uD83C\uDFA4 " + channel  : "") +
      (duration ? "\n\u23F1 "         + duration : "");

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
        ? "\u274C \u0627\u0646\u062a\u0647\u062a \u0645\u0647\u0644\u0629 \u0627\u0644\u0625\u0631\u0633\u0627\u0644. \u062c\u0631\u0651\u0628 \u0623\u063a\u0646\u064a\u0629 \u0623\u0642\u0635\u0631."
        : "\u274C \u062a\u0639\u0630\u0651\u0631 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0645\u0644\u0641.\n" + e.message;
      api.sendMessage(msg + "\n" + caption, threadID).catch(() => {});
    } finally {
      cleanup();
    }
  },
};
