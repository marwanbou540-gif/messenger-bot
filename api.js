"use strict";

const express = require("express");
const cors    = require("cors");
const config  = require("./config.json");
const logger  = require("./utils/logger");
const diagnostics = require("./utils/diagnostics");
const health      = require("./utils/health");
const {
  lockedThreads, mutedThreads, groupsCache,
  activityLog, lockViolations, autoReplies, groupStats,
} = require("./state");

let botApi    = null;
let startTime = Date.now();
let botStatus = "connecting";

function setBotApi(api)   { botApi = api; startTime = Date.now(); }
function setBotStatus(s)  { botStatus = s; }

function logActivity(msg) {
  activityLog.push({ time: Date.now(), message: String(msg) });
  if (activityLog.length > 300) activityLog.shift();
}

function logViolation({ threadID, threadName, senderID, messagePreview }) {
  lockViolations.push({ time: Date.now(), threadID, threadName, senderID, messagePreview });
  if (lockViolations.length > 200) lockViolations.shift();
}

// ── Rate limiter (simple in-memory per-IP) ────────────────────────────────────
const _reqMap = new Map();
function _rateLimit(maxPerMinute = 60) {
  return (req, res, next) => {
    const ip  = req.ip || req.connection.remoteAddress || "unknown";
    const now = Date.now();
    const rec = _reqMap.get(ip) || { count: 0, reset: now + 60000 };
    if (now > rec.reset) { rec.count = 0; rec.reset = now + 60000; }
    rec.count++;
    _reqMap.set(ip, rec);
    if (rec.count > maxPerMinute) {
      return res.status(429).json({ error: "Too many requests. Slow down." });
    }
    next();
  };
}
// Clean rate map every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of _reqMap) { if (now > rec.reset) _reqMap.delete(ip); }
}, 300000).unref();

// ── Auth middleware ───────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const key = config.dashboard && config.dashboard.apiKey;
  if (!key || key === "changeme-set-a-strong-secret" || key === "changeme") return next();
  const authHeader = req.headers["authorization"] || "";
  if (authHeader !== `Bearer ${key}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ── Input sanitiser ───────────────────────────────────────────────────────────
function sanitize(str, maxLen = 512) {
  if (typeof str !== "string") return "";
  return str.slice(0, maxLen).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── API routes ────────────────────────────────────────────────────────────────
function createApiServer() {
  const app = express();

  app.use(cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  }));
  app.use(express.json({ limit: "64kb" }));
  app.use(_rateLimit(120));
  app.use(authMiddleware);

  // ── Health & diagnostics ──────────────────────────────────────────────────
  app.get("/health", (req, res) => {
    const hs = health.snapshot();
    if (!botApi) return res.json({ status: botStatus, botName: config.bot.name, version: config.bot.version, ...hs });
    res.json({
      status:      "online",
      botName:     config.bot.name,
      version:     config.bot.version,
      uptime:      Math.floor((Date.now() - startTime) / 1000),
      groupCount:  groupsCache.size,
      lockedCount: lockedThreads.size,
      ...hs,
    });
  });

  app.get("/diagnostics", (req, res) => {
    res.json(diagnostics.report());
  });

  app.post("/diagnostics/snapshot", async (req, res) => {
    const file = await diagnostics.createSnapshot("api_request");
    res.json({ success: true, file: file ? require("path").basename(file) : null });
  });

  // ── Groups ────────────────────────────────────────────────────────────────
  app.get("/groups", (req, res) => {
    const groups = [];
    for (const [threadID, info] of groupsCache.entries()) {
      const muteExpiry = mutedThreads.get(threadID);
      const stats      = groupStats.get(threadID) || {};
      const ar         = autoReplies.get(threadID);
      groups.push({
        threadID, name: info.name || threadID,
        memberCount:  info.memberCount || 0,
        isLocked:     lockedThreads.has(threadID),
        isMuted:      muteExpiry != null && Date.now() < muteExpiry,
        muteExpiresAt: muteExpiry || null,
        lastSeen:     info.lastSeen || 0,
        messageCount: stats.messageCount || 0,
        commandCount: stats.commandCount || 0,
        hasAutoReply: !!(ar && ar.enabled),
      });
    }
    groups.sort((a, b) => b.lastSeen - a.lastSeen);
    res.json(groups);
  });

  app.get("/groups/:threadID/info", async (req, res) => {
    const { threadID } = req.params;
    if (!botApi) return res.status(503).json({ error: "Bot not connected" });
    try {
      const info       = await botApi.getThreadInfo(threadID);
      const cached     = groupsCache.get(threadID) || {};
      const stats      = groupStats.get(threadID) || {};
      const muteExpiry = mutedThreads.get(threadID);
      const ar         = autoReplies.get(threadID);
      res.json({
        threadID,
        name:          info.name || cached.name || threadID,
        memberCount:   (info.participantIDs || []).length,
        adminCount:    (info.adminIDs || []).length,
        isLocked:      lockedThreads.has(threadID),
        isMuted:       muteExpiry != null && Date.now() < muteExpiry,
        muteExpiresAt: muteExpiry || null,
        lastSeen:      cached.lastSeen || 0,
        messageCount:  stats.messageCount || 0,
        commandCount:  stats.commandCount || 0,
        hasAutoReply:  !!(ar && ar.enabled),
        autoReplyMsg:  ar ? ar.message : null,
        emoji:         info.emoji || null,
        color:         info.color || null,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/groups/:threadID/stats",   (req, res) => res.json(groupStats.get(req.params.threadID) || {}));

  app.post("/groups/:threadID/lock", (req, res) => {
    const { threadID } = req.params;
    if (req.body.locked) lockedThreads.add(threadID);
    else                 lockedThreads.delete(threadID);
    logActivity(`Group ${threadID} ${req.body.locked ? "locked" : "unlocked"} via dashboard`);
    res.json({ success: true, isLocked: lockedThreads.has(threadID) });
  });

  app.post("/groups/:threadID/mute", (req, res) => {
    const { threadID } = req.params;
    const minutes      = parseInt(req.body.minutes) || 0;
    if (minutes <= 0) {
      mutedThreads.delete(threadID);
      logActivity(`Group ${threadID} unmuted via dashboard`);
      return res.json({ success: true, isMuted: false });
    }
    const expiresAt = Date.now() + minutes * 60000;
    mutedThreads.set(threadID, expiresAt);
    logActivity(`Group ${threadID} muted ${minutes}min via dashboard`);
    res.json({ success: true, isMuted: true, expiresAt });
  });

  app.post("/groups/:threadID/rename", async (req, res) => {
    const { threadID } = req.params;
    const name         = sanitize(req.body.name, 100);
    if (!name)    return res.status(400).json({ error: "name required" });
    if (!botApi)  return res.status(503).json({ error: "Bot not connected" });
    try {
      await botApi.gcname(name, threadID);
      const cached = groupsCache.get(threadID) || {};
      groupsCache.set(threadID, { ...cached, name });
      logActivity(`Group ${threadID} renamed to "${name}" via dashboard`);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/groups/:threadID/message", async (req, res) => {
    const { threadID } = req.params;
    const message      = sanitize(req.body.message, 2000);
    if (!message) return res.status(400).json({ error: "message required" });
    if (!botApi)  return res.status(503).json({ error: "Bot not connected" });
    try {
      await botApi.sendMessage(message, threadID);
      logActivity(`Message sent to ${threadID} via dashboard`);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/groups/:threadID/members", async (req, res) => {
    if (!botApi) return res.status(503).json({ error: "Bot not connected" });
    try {
      const info      = await botApi.getThreadInfo(req.params.threadID);
      const ids       = info.participantIDs || [];
      const adminSet  = new Set((info.adminIDs || []).map(a => a.id));
      const userInfos = ids.length > 0 ? await botApi.getUserInfo(ids) : {};
      res.json(ids.map(id => ({ userID: id, name: userInfos[id]?.name || id, isAdmin: adminSet.has(id) })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/groups/:threadID/kick", async (req, res) => {
    const userID = sanitize(req.body.userID, 50);
    if (!userID)  return res.status(400).json({ error: "userID required" });
    if (!botApi)  return res.status(503).json({ error: "Bot not connected" });
    try {
      await botApi.gcmember("remove", userID, req.params.threadID);
      logActivity(`User ${userID} kicked from ${req.params.threadID} via dashboard`);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Auto-reply ────────────────────────────────────────────────────────────
  app.get("/groups/:threadID/autoreply", (req, res) => {
    const ar = autoReplies.get(req.params.threadID);
    if (!ar) return res.json({ enabled: false, message: "", cooldownMinutes: 30 });
    res.json({ enabled: ar.enabled, message: ar.message, cooldownMinutes: Math.round(ar.cooldownMs / 60000) });
  });

  app.put("/groups/:threadID/autoreply", (req, res) => {
    const { threadID }     = req.params;
    const message          = sanitize(req.body.message, 2000);
    const { enabled, cooldownMinutes } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });
    const cooldownMs = Math.max(60000, (parseInt(cooldownMinutes) || 30) * 60000);
    const existing   = autoReplies.get(threadID) || { lastSent: new Map() };
    autoReplies.set(threadID, { message, enabled: !!enabled, cooldownMs, lastSent: existing.lastSent });
    logActivity(`Auto-reply ${enabled ? "enabled" : "updated"} for ${threadID}`);
    res.json({ success: true });
  });

  app.delete("/groups/:threadID/autoreply", (req, res) => {
    autoReplies.delete(req.params.threadID);
    logActivity(`Auto-reply removed for ${req.params.threadID}`);
    res.json({ success: true });
  });

  // ── Pending ───────────────────────────────────────────────────────────────
  app.get("/pending", async (req, res) => {
    if (!botApi) return res.status(503).json({ error: "Bot not connected" });
    try {
      const threads = await botApi.getThreadList(20, null, ["PENDING"]);
      res.json((threads || []).map(t => ({
        threadID:    t.threadID,
        name:        t.name || t.threadID,
        memberCount: (t.participantIDs || []).length,
        snippet:     t.snippet || "",
        timestamp:   t.timestamp || 0,
      })));
    } catch { res.json([]); }
  });

  app.post("/pending/:threadID/accept", async (req, res) => {
    if (!botApi) return res.status(503).json({ error: "Bot not connected" });
    try {
      const msg = sanitize(req.body.message || ".", 500);
      await botApi.sendMessage(msg, req.params.threadID);
      logActivity(`Accepted message request from ${req.params.threadID}`);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Broadcast ─────────────────────────────────────────────────────────────
  app.post("/broadcast", async (req, res) => {
    const message  = sanitize(req.body.message, 2000);
    const targets  = Array.isArray(req.body.threadIDs) ? req.body.threadIDs : [...groupsCache.keys()];
    if (!message) return res.status(400).json({ error: "message required" });
    if (!botApi)  return res.status(503).json({ error: "Bot not connected" });
    let sent = 0, failed = 0;
    for (const tid of targets) {
      try { await botApi.sendMessage(message, tid); sent++; } catch { failed++; }
      await delay(1200);
    }
    logActivity(`Broadcast: ${sent} sent, ${failed} failed`);
    res.json({ success: true, sent, failed });
  });

  // ── Restart ───────────────────────────────────────────────────────────────
  app.post("/restart", async (req, res) => {
    res.json({ success: true, message: "Restarting in 2 seconds..." });
    logActivity("Restart triggered via dashboard API");
    try {
      if (botApi) {
        const state = botApi.getAppState();
        if (Array.isArray(state) && state.length > 0) {
          const { SessionManager } = require("./utils/session");
          const s = new SessionManager(require("path").resolve(__dirname, config.appStatePath), process.env.GITHUB_PERSONAL_ACCESS_TOKEN, "marwanbou540-gif/messenger-bot");
          s.save(state);
        }
      }
    } catch {}
    setTimeout(() => process.exit(0), 2000);
  });

  // ── Logs & audit ──────────────────────────────────────────────────────────
  app.get("/activity",   (req, res) => res.json(activityLog.slice(-100).reverse()));
  app.get("/violations", (req, res) => res.json(lockViolations.slice(-100).reverse()));

  return app;
}

function startApiServer() {
  const app  = createApiServer();
  const port = process.env.PORT || (config.dashboard && config.dashboard.port) || 3001;
  app.listen(port, () => logger.success("Dashboard", `API server listening on port ${port}`));
}

module.exports = { setBotApi, setBotStatus, logActivity, logViolation, startApiServer };
