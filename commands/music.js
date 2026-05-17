"use strict";

const fs    = require("fs");
const https = require("https");
const http  = require("http");
const os    = require("os");
const path  = require("path");

// Public Invidious instances — tried in order until one responds
const INSTANCES = [
  "invidious.io",
  "invidious.nerdvpn.de",
  "invidious.kavin.rocks",
  "vid.puffyan.us",
  "y.com.sb",
  "inv.nadeko.net",
];

// ── Generic Invidious GET (JSON) ──────────────────────────────────────────────
function invGet(host, urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      { hostname: host, path: urlPath, headers: { "User-Agent": "Mozilla/5.0" }, timeout: 9000 },
      res => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          req.destroy();
          return resolve(invGet(host, res.headers.location));
        }
        let d = "";
        res.on("data", c => d += c);
        res.on("end", () => {
          try { resolve(JSON.parse(d)); }
          catch { reject(new Error("Bad JSON from " + host)); }
        });
      }
    );
    req.on("error",   reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout: " + host)); });
  });
}

// ── Search YouTube via Invidious (tries each instance) ───────────────────────
async function searchVideo(query) {
  const q = encodeURIComponent(query);
  for (const host of INSTANCES) {
    try {
      const results = await invGet(
        host,
        "/api/v1/search?q=" + q + "&type=video&fields=videoId,title,author,lengthSeconds&page=1"
      );
      if (!Array.isArray(results) || results.length === 0) continue;
      // Prefer songs under 10 min; fall back to first result
      const video =
        results.find(v => v.lengthSeconds > 0 && v.lengthSeconds <= 600) || results[0];
      return { host, video };
    } catch { /* try next instance */ }
  }
  throw new Error("\u0641\u0634\u0644 \u0627\u0644\u0628\u062d\u062b: \u0644\u0645 \u064a\u0633\u062a\u062c\u0628 \u0623\u064a \u062e\u0627\u062f\u0645.");
}

// ── Get direct audio URL from Invidious ───────────────────────────────────────
async function getAudioUrl(host, videoId) {
  // Try the same instance first, then others
  const tryHosts = [host, ...INSTANCES.filter(h => h !== host)];
  for (const h of tryHosts) {
    try {
      const info = await invGet(
        h,
        "/api/v1/videos/" + videoId + "?fields=adaptiveFormats,title,author,lengthSeconds"
      );
      const fmts = info.adaptiveFormats || [];
      // Prefer audio/mp4 (m4a) — natively playable in Facebook Messenger
      const m4a  = fmts.find(f => f.type && f.type.startsWith("audio/mp4"));
      const webm = fmts.find(f => f.type && f.type.includes("audio/webm"));
      const fmt  = m4a || webm;
      if (!fmt || !fmt.url) continue;
      return { url: fmt.url, ext: m4a ? ".m4a" : ".webm", host: h };
    } catch { /* try next */ }
  }
  throw new Error("\u0644\u0645 \u064a\u064f\u0639\u062b\u0631 \u0639\u0644\u0649 \u0631\u0627\u0628\u0637 \u0635\u0648\u062a\u064a.");
}

// ── Download URL → file (follows redirects) ───────────────────────────────────
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    function get(u, hops) {
      if (hops > 8) { file.close(); return reject(new Error("Too many redirects")); }
      const proto = u.startsWith("https") ? https : http;
      proto.get(u, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 120000 }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location, hops + 1);
        }
        if (res.statusCode !== 200) {
          file.close();
          return reject(new Error("HTTP " + res.statusCode));
        }
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(); });
        file.on("error", e => { file.close(); reject(e); });
        res.on("error",  e => { file.close(); reject(e); });
      }).on("error", e => { file.close(); reject(e); });
    }
    get(url, 0);
  });
}

function fmtDur(sec) {
  if (!sec) return "?:??";
  return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
}

// ── Command ───────────────────────────────────────────────────────────────────
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

    await api.sendMessage("\uD83D\uDD0D \u062c\u0627\u0631\u064d \u0627\u0644\u0628\u062d\u062b \u0639\u0646: " + query + " ...", threadID);

    // 1. Search
    let host, video;
    try {
      ({ host, video } = await searchVideo(query));
    } catch (e) {
      return api.sendMessage("\u274C " + e.message, threadID);
    }

    if (!video || !video.videoId) {
      return api.sendMessage("\uD83D\uDE15 \u0644\u0645 \u064a\u064f\u0639\u062b\u0631 \u0639\u0644\u0649 \u0646\u062a\u0627\u0626\u062c \u0644\u0640 \u00ab" + query + "\u00bb.", threadID);
    }

    const dur = fmtDur(video.lengthSeconds);
    await api.sendMessage(
      "\u2B07\uFE0F \u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644: " + video.title + " (" + dur + ") ...",
      threadID
    );

    // 2. Get audio URL
    let audioUrl, ext;
    try {
      ({ url: audioUrl, ext } = await getAudioUrl(host, video.videoId));
    } catch (e) {
      return api.sendMessage("\u274C " + e.message, threadID);
    }

    // 3. Download
    const audioPath = path.join(os.tmpdir(), "music_" + Date.now() + ext);
    try {
      await download(audioUrl, audioPath);
    } catch (e) {
      try { fs.unlinkSync(audioPath); } catch {}
      return api.sendMessage(
        "\u274C \u0641\u0634\u0644 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0623\u063a\u0646\u064a\u0629.\n" + e.message,
        threadID
      );
    }

    const caption =
      "\uD83C\uDFB5 " + video.title + "\n" +
      "\uD83C\uDFA4 " + (video.author || "") + "\n" +
      "\u23F1 " + dur;

    // 4. Send (60 s timeout guard)
    const cleanup = () => setTimeout(() => { try { fs.unlinkSync(audioPath); } catch {} }, 10000);
    try {
      await Promise.race([
        api.sendMessage({ body: caption, attachment: fs.createReadStream(audioPath) }, threadID),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 60000)),
      ]);
    } catch (e) {
      const msg = e.message === "timeout"
        ? "\u274C \u0627\u0646\u062a\u0647\u062a \u0645\u0647\u0644\u0629 \u0627\u0644\u0625\u0631\u0633\u0627\u0644. \u062c\u0631\u0651\u0628 \u0623\u063a\u0646\u064a\u0629 \u0623\u0642\u0635\u0631."
        : "\u274C \u062a\u0639\u0630\u0651\u0631 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0635\u0648\u062a\u064a.\n" + e.message;
      api.sendMessage(msg + "\n" + caption, threadID).catch(() => {});
    } finally {
      cleanup();
    }
  },
};
