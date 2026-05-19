"use strict";

/**
 * musicEngine — production-grade audio delivery engine for Madox bot.
 *
 * Provider chain:
 *   1. YouTube (yt-search + yt-dlp async spawn) — full songs
 *   2. iTunes Search API (direct preview URL)   — 30s preview fallback
 *
 * Architecture:
 *   - All downloads run as child_process.spawn (never blocks event loop)
 *   - Semaphore limits concurrency to MAX_CONCURRENT downloads
 *   - Per-user cooldown prevents request flooding
 *   - Each phase isolated — one failure never crashes the engine
 *   - Temp files cleaned up automatically (1h stale + 30s after send)
 */

const fs     = require("fs");
const os     = require("os");
const path   = require("path");
const https  = require("https");
const http   = require("http");
const { spawn } = require("child_process");

const logger = require("./logger");

// ── Config ────────────────────────────────────────────────────────────────────
const TMP_DIR          = path.join(os.tmpdir(), "madox_music");
const YTDLP_LOCAL      = path.join(TMP_DIR, "yt-dlp");
const MAX_CONCURRENT   = 2;
const QUEUE_MAX        = 5;
const SEARCH_TIMEOUT   = 15_000;
const DOWNLOAD_TIMEOUT = 110_000;
const BINARY_TIMEOUT   = 90_000;
const MAX_DURATION_SEC = 720;
const MAX_FILE_BYTES   = 48 * 1024 * 1024;
const USER_COOLDOWN_MS = 35_000;

// ── State ─────────────────────────────────────────────────────────────────────
const _userCooldowns = new Map();
let   _ytdlpPath     = null;
let   _ytdlpPromise  = null;

// ── Semaphore ─────────────────────────────────────────────────────────────────
class Semaphore {
  constructor(max) { this._max = max; this._running = 0; this._queue = []; }
  acquire() {
    return new Promise(resolve => {
      const release = () => { this._running--; this._flush(); };
      if (this._running < this._max) { this._running++; resolve(release); }
      else this._queue.push(() => { this._running++; resolve(release); });
    });
  }
  _flush() { if (this._queue.length > 0) this._queue.shift()(); }
  get running() { return this._running; }
  get waiting() { return this._queue.length; }
  get total()   { return this._running + this._queue.length; }
}

const _sem = new Semaphore(MAX_CONCURRENT);

// ── Startup cleanup ───────────────────────────────────────────────────────────
try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch {}
_cleanStaleFiles();

function _cleanStaleFiles() {
  try {
    const cutoff = Date.now() - 3_600_000;
    for (const f of fs.readdirSync(TMP_DIR)) {
      if (!f.startsWith("music_")) continue;
      const fp = path.join(TMP_DIR, f);
      try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch {}
    }
  } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error("انتهت مهلة: " + label + " (" + Math.round(ms / 1000) + "s)")), ms)
    ),
  ]);
}

function httpFetch(url, redirects = 6) {
  return new Promise((resolve, reject) => {
    if (redirects <= 0) return reject(new Error("too many redirects"));
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { timeout: 20_000, headers: { "User-Agent": "Mozilla/5.0" } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        req.destroy();
        const next = res.headers.location.startsWith("http")
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return httpFetch(next, redirects - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { req.destroy(); return reject(new Error("HTTP " + res.statusCode)); }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end",  () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error",   reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("HTTP timeout")); });
  });
}

async function httpFetchJson(url) {
  const buf = await httpFetch(url);
  return JSON.parse(buf.toString("utf8"));
}

function spawnAsync(cmd, args, { timeout = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    let killed = false;
    const proc  = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stderr = [];
    proc.stderr.on("data", d => stderr.push(d));
    proc.on("error", err => { if (!killed) reject(err); });
    proc.on("close", code => {
      if (killed) return;
      if (code === 0) return resolve(Buffer.concat(stderr).toString());
      reject(new Error(path.basename(cmd) + " exit " + code + ": " + Buffer.concat(stderr).toString().slice(0, 250)));
    });
    const timer = setTimeout(() => {
      killed = true; try { proc.kill("SIGKILL"); } catch {}
      reject(new Error(path.basename(cmd) + " timeout (" + Math.round(timeout / 1000) + "s)"));
    }, timeout);
    proc.on("close", () => clearTimeout(timer));
  });
}

// ── yt-dlp binary resolution ──────────────────────────────────────────────────
// Search order:
//   1. Standard system paths (nixpacks installs to /usr/local/bin via curl)
//   2. pip user-install paths (HOME/.local/bin)
//   3. Cached local binary (downloaded previously)
//   4. Download standalone binary from GitHub

async function ensureYtDlp() {
  if (_ytdlpPath) return _ytdlpPath;
  if (_ytdlpPromise) return _ytdlpPromise;
  _ytdlpPromise = _resolveYtDlp().finally(() => { _ytdlpPromise = null; });
  return _ytdlpPromise;
}

async function _resolveYtDlp() {
  // Build the candidate list dynamically so HOME-based paths work at runtime
  const HOME     = process.env.HOME || "/root";
  const candidates = [
    "yt-dlp",                                      // in PATH
    "/usr/local/bin/yt-dlp",                       // nixpacks curl install
    "/usr/bin/yt-dlp",                             // system apt/yum
    path.join(HOME, ".local/bin/yt-dlp"),          // pip --user install
    "/root/.local/bin/yt-dlp",                     // pip as root
    "/nix/var/nix/profiles/default/bin/yt-dlp",   // nix profile
    path.join(HOME, ".nix-profile/bin/yt-dlp"),    // nix user profile
  ];

  for (const cmd of candidates) {
    try {
      await spawnAsync(cmd, ["--version"], { timeout: 5_000 });
      logger.info("MusicEngine", "yt-dlp found at: " + cmd);
      return (_ytdlpPath = cmd);
    } catch {}
  }

  // Cached local binary from a previous download
  if (fs.existsSync(YTDLP_LOCAL)) {
    try {
      await spawnAsync(YTDLP_LOCAL, ["--version"], { timeout: 5_000 });
      logger.info("MusicEngine", "Using cached local yt-dlp binary");
      return (_ytdlpPath = YTDLP_LOCAL);
    } catch {
      try { fs.unlinkSync(YTDLP_LOCAL); } catch {}
    }
  }

  // Download standalone Linux binary from GitHub releases
  logger.info("MusicEngine", "Downloading yt-dlp binary (first-time setup)...");
  const url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
  const buf = await withTimeout(httpFetch(url), BINARY_TIMEOUT, "تحميل yt-dlp");

  fs.writeFileSync(YTDLP_LOCAL, buf, { mode: 0o755 });
  await spawnAsync(YTDLP_LOCAL, ["--version"], { timeout: 5_000 });

  logger.success("MusicEngine", "yt-dlp binary ready (self-downloaded)");
  return (_ytdlpPath = YTDLP_LOCAL);
}

// ── Detect system ffmpeg path ─────────────────────────────────────────────────
function _findFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const candidates = [
    "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg",
    "/nix/var/nix/profiles/default/bin/ffmpeg",
    (process.env.HOME || "/root") + "/.nix-profile/bin/ffmpeg",
  ];
  for (const p of candidates) {
    try { if (fs.statSync(p).isFile()) return p; } catch {}
  }
  return "ffmpeg"; // hope it's in PATH
}

// ── Provider 1: YouTube ───────────────────────────────────────────────────────
async function _searchYouTube(query) {
  const ytSearch = require("yt-search");
  const result   = await withTimeout(ytSearch(query), SEARCH_TIMEOUT, "YouTube search");
  const videos   = (result.videos || []).filter(v => v.seconds && v.seconds > 15 && v.seconds < MAX_DURATION_SEC);
  if (!videos.length) throw new Error("no_results");
  const v = videos[0];
  return { provider: "youtube", url: v.url, title: v.title || query, artist: v.author?.name || "", duration: v.timestamp || "", seconds: v.seconds, preview: false };
}

async function _downloadYouTube(track, outPath) {
  const bin    = await withTimeout(ensureYtDlp(), BINARY_TIMEOUT + 5_000, "تجهيز أداة التحميل");
  const ffmpeg = _findFfmpeg();
  await withTimeout(
    spawnAsync(bin, [
      "--no-playlist",
      "--max-filesize", "48m",
      "-f", "bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio",
      "--ffmpeg-location", ffmpeg,
      "-o", outPath,
      "--no-part",
      "--no-cache-dir",
      "--quiet",
      "--no-warnings",
      "--add-header", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      track.url,
    ], { timeout: DOWNLOAD_TIMEOUT }),
    DOWNLOAD_TIMEOUT + 5_000,
    "تحميل الأغنية من YouTube"
  );
}

// ── Provider 2: iTunes (30s preview) ─────────────────────────────────────────
async function _searchItunes(query) {
  const url  = "https://itunes.apple.com/search?term=" + encodeURIComponent(query) + "&media=music&limit=8&entity=song";
  const data = await withTimeout(httpFetchJson(url), SEARCH_TIMEOUT, "iTunes search");
  const hits = (data.results || []).filter(r => r.previewUrl && r.trackName);
  if (!hits.length) throw new Error("no_results");
  const h = hits[0];
  return { provider: "itunes", url: h.previewUrl, title: h.trackName || query, artist: h.artistName || "", duration: "0:30", seconds: 30, preview: true };
}

async function _downloadItunes(track, outPath) {
  const buf = await withTimeout(httpFetch(track.url), 30_000, "تحميل معاينة iTunes");
  fs.writeFileSync(outPath, buf);
}

// ── File validation ───────────────────────────────────────────────────────────
function _validateFile(fp) {
  if (!fs.existsSync(fp))  throw new Error("الملف الصوتي لم يُنشأ");
  const sz = fs.statSync(fp).size;
  if (sz < 1024)           throw new Error("الملف فارغ (" + sz + " bytes)");
  if (sz > MAX_FILE_BYTES) throw new Error("الملف كبير جداً (" + Math.round(sz / 1048576) + "MB)");
  return sz;
}

// ── Public API ────────────────────────────────────────────────────────────────

async function search(query) {
  const q = query.slice(0, 200).trim();
  try { return await _searchYouTube(q); } catch (e) { if (e.message !== "no_results") logger.warn("MusicEngine", "YouTube search failed: " + e.message); }
  try { return await _searchItunes(q); }  catch (e) { if (e.message !== "no_results") logger.warn("MusicEngine", "iTunes search failed: " + e.message); }
  throw new Error("لم يُعثر على نتائج لـ: " + q);
}

async function download(track) {
  if (_sem.total >= QUEUE_MAX) throw new Error("قائمة الانتظار ممتلئة، حاول بعد قليل.");

  const outPath = path.join(TMP_DIR, "music_" + Date.now() + "_" + Math.random().toString(36).slice(2) + ".m4a");
  const release = await _sem.acquire();
  try {
    logger.info("MusicEngine", "Downloading [" + track.provider + "]: " + track.title);
    if (track.provider === "itunes") {
      await _downloadItunes(track, outPath);
    } else {
      await _downloadYouTube(track, outPath);
    }
    const bytes = _validateFile(outPath);
    logger.success("MusicEngine", "Download done: " + Math.round(bytes / 1024) + "KB — " + track.title);
    return outPath;
  } catch (e) {
    safeDelete(outPath);
    throw e;
  } finally {
    release();
  }
}

function safeDelete(fp, delayMs = 30_000) {
  setTimeout(() => { try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {} }, delayMs);
}

function userCooldown(senderID) {
  const last    = _userCooldowns.get(senderID) || 0;
  const elapsed = Date.now() - last;
  return elapsed < USER_COOLDOWN_MS ? Math.ceil((USER_COOLDOWN_MS - elapsed) / 1000) : 0;
}

function markUser(senderID) { _userCooldowns.set(senderID, Date.now()); }

function diagnostics() {
  let tmpFiles = 0;
  try { tmpFiles = fs.readdirSync(TMP_DIR).filter(f => f.startsWith("music_")).length; } catch {}
  return { ytdlpPath: _ytdlpPath || "(not resolved yet)", concurrent: _sem.running, queued: _sem.waiting, tmpFiles, tmpDir: TMP_DIR };
}

module.exports = { search, download, safeDelete, userCooldown, markUser, diagnostics };
