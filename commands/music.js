"use strict";

const { execFile } = require("child_process");
const { promisify } = require("util");
const fs            = require("fs");
const os            = require("os");
const path          = require("path");

const execAsync = promisify(execFile);

let ytdlpAvailable = null;
async function checkYtdlp() {
  if (ytdlpAvailable !== null) return ytdlpAvailable;
  try {
    await execAsync("yt-dlp", ["--version"], { timeout: 5000 });
    ytdlpAvailable = true;
  } catch {
    ytdlpAvailable = false;
  }
  return ytdlpAvailable;
}

async function ytdlpDownload(query, audioPath) {
  const { stdout } = await execAsync("yt-dlp", [
    "ytsearch1:" + query,
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "5",
    "-o", audioPath,
    "--no-playlist",
    "--quiet",
    "--no-warnings",
    "--print", "before_dl:%(title)s\t%(channel)s\t%(duration_string)s",
    "--max-filesize", "50m",
    "--socket-timeout", "30",
  ], { timeout: 180000 });

  const parts    = (stdout || "").trim().split("\t");
  const title    = parts[0] || query;
  const channel  = parts[1] || "";
  const duration = parts[2] || "";
  return { title, channel, duration };
}

module.exports = {
  name: "music",
  aliases: ["song", "\u0627\u063a\u0646\u064a\u0629", "\u0623\u063a\u0646\u064a\u0629", "mp3"],
  description: "\u0627\u0644\u0628\u062d\u062b \u0639\u0646 \u0623\u063a\u0646\u064a\u0629 \u0648\u0625\u0631\u0633\u0627\u0644\u0647\u0627 \u0643\u0627\u0645\u0644\u0629.",
  usage: "music [\u0627\u0633\u0645 \u0627\u0644\u0623\u063a\u0646\u064a\u0629 \u0623\u0648 \u0627\u0644\u0641\u0646\u0627\u0646]",
  category: "Entertainment",

  async execute({ api, event, args }) {
    const { threadID } = event;
    const query = args.join(" ").trim();

    if (!query) {
      return api.sendMessage(
        "\uD83C\uDFB5 \u0627\u0644\u0627\u0633\u062a\u062e\u062f\u0627\u0645: -music [\u0627\u0633\u0645 \u0627\u0644\u0623\u063a\u0646\u064a\u0629]\n\u0623\u0645\u062b\u0644\u0629:\n  -music Blinding Lights\n  -music The Weeknd\n  -music Fairuz",
        threadID
      );
    }

    if (!await checkYtdlp()) {
      return api.sendMessage(
        "\u274C yt-dlp \u063a\u064a\u0631 \u0645\u062a\u0648\u0641\u0631. \u062a\u0623\u0643\u062f \u0645\u0646 \u0623\u0646 Railway \u0623\u0639\u0627\u062f \u0627\u0644\u0628\u0646\u0627\u0621 \u0628\u0639\u062f \u0625\u0636\u0627\u0641\u0629 nixpacks.toml.",
        threadID
      );
    }

    await api.sendMessage(
      "\uD83D\uDD0D \u062c\u0627\u0631\u064d \u0627\u0644\u0628\u062d\u062b \u0648\u0627\u0644\u062a\u062d\u0645\u064a\u0644: " + query + " ...",
      threadID
    );

    const audioPath = path.join(os.tmpdir(), "music_" + Date.now() + ".mp3");

    let meta;
    try {
      meta = await ytdlpDownload(query, audioPath);
    } catch (e) {
      try { fs.unlinkSync(audioPath); } catch {}
      return api.sendMessage(
        "\u274C \u0641\u0634\u0644 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0623\u063a\u0646\u064a\u0629.\n" + ((e.stderr || e.message || "").slice(0, 300)),
        threadID
      );
    }

    if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
      return api.sendMessage("\u274C \u0644\u0645 \u064a\u064f\u0646\u0634\u0623 \u0645\u0644\u0641 \u0627\u0644\u0635\u0648\u062a. \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.", threadID);
    }

    const caption =
      "\uD83C\uDFB5 " + meta.title +
      (meta.channel  ? "\n\uD83C\uDFA4 " + meta.channel  : "") +
      (meta.duration ? "\n\u23F1 "         + meta.duration : "");

    const cleanup = () =>
      setTimeout(() => { try { fs.unlinkSync(audioPath); } catch {} }, 15000);

    try {
      await Promise.race([
        api.sendMessage({ body: caption, attachment: fs.createReadStream(audioPath) }, threadID),
        new Promise((_, rej) => setTimeout(() => rej(new Error("send_timeout")), 90000)),
      ]);
    } catch (e) {
      const msg = e.message === "send_timeout"
        ? "\u274C \u0627\u0646\u062a\u0647\u062a \u0645\u0647\u0644\u0629 \u0627\u0644\u0625\u0631\u0633\u0627\u0644. \u0627\u0644\u0623\u063a\u0646\u064a\u0629 \u0643\u0628\u064a\u0631\u0629\u060c \u062c\u0631\u0651\u0628 \u0623\u063a\u0646\u064a\u0629 \u0623\u0642\u0635\u0631."
        : "\u274C \u062a\u0639\u0630\u0651\u0631 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0645\u0644\u0641.\n" + e.message;
      api.sendMessage(msg + "\n" + caption, threadID).catch(() => {});
    } finally {
      cleanup();
    }
  },
};
