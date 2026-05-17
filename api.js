"use strict";

const express = require("express");
const cors    = require("cors");
const config  = require("./config.json");
const logger  = require("./utils/logger");
const {
  lockedThreads, mutedThreads, groupsCache,
  activityLog, lockViolations, autoReplies, groupStats,
} = require("./state");

let botApi    = null;
let startTime = Date.now();

function setBotApi(api) { botApi = api; startTime = Date.now(); }

let botStatus = "connecting"; // connecting | online | offline
function setBotStatus(s) { botStatus = s; }

function logActivity(msg) {
  activityLog.push({ time: Date.now(), message: msg });
  if (activityLog.length > 300) activityLog.shift();
}

function logViolation({ threadID, threadName, senderID, messagePreview }) {
  lockViolations.push({ time: Date.now(), threadID, threadName, senderID, messagePreview });
  if (lockViolations.length > 200) lockViolations.shift();
}

function authMiddleware(req, res, next) {
  const key = config.dashboard && config.dashboard.apiKey;
  if (!key) return next();
  if (req.headers["authorization"] !== "Bearer " + key) { res.status(401).json({ error: "Unauthorized" }); return; }
  next();
}

function createApiServer() {
  const app = express();
  app.use(cors({ origin: "*" }));
  app.use(express.json());
  app.use(authMiddleware);

  /* ── Health ── */
  app.get("/health", (req, res) => {
    if (!botApi) return res.json({ status: botStatus, botName: config.bot.name, version: config.bot.version });
    return res.json({
      status:     "online",
      botName:    config.bot.name,
      version:    config.bot.version,
      uptime:     Math.floor((Date.now() - startTime) / 1000),
      groupCount: groupsCache.size,
      lockedCount: lockedThreads.size,
    });
  });

  /* ── Groups list ── */
  app.get("/groups", (req, res) => {
    const groups = [];
    for (const [threadID, info] of groupsCache.entries()) {
      const muteExpiry = mutedThreads.get(threadID);
      const stats      = groupStats.get(threadID) || {};
      const ar         = autoReplies.get(threadID);
      groups.push({
        threadID, name: info.name || threadID,
        memberCount: info.memberCount || 0,
        isLocked: lockedThreads.has(threadID),
        isMuted: muteExpiry != null && Date.now() < muteExpiry,
        muteExpiresAt: muteExpiry || null,
        lastSeen: info.lastSeen || 0,
        messageCount: stats.messageCount || 0,
        commandCount: stats.commandCount || 0,
        hasAutoReply: !!(ar && ar.enabled),
      });
    }
    groups.sort((a, b) => b.lastSeen - a.lastSeen);
    res.json(groups);
  });

  /* ── Group detail info ── */
  app.get("/groups/:threadID/info", async (req, res) => {
    const { threadID } = req.params;
    if (!botApi) { res.status(503).json({ error: "Bot not connected" }); return; }
    try {
      const info       = await botApi.getThreadInfo(threadID);
      const cached     = groupsCache.get(threadID) || {};
      const stats      = groupStats.get(threadID) || {};
      const muteExpiry = mutedThreads.get(threadID);
      const ar         = autoReplies.get(threadID);
      res.json({
        threadID,
        name:         info.name || cached.name || threadID,
        memberCount:  (info.participantIDs || []).length,
        adminCount:   (info.adminIDs || []).length,
        isLocked:     lockedThreads.has(threadID),
        isMuted:      muteExpiry != null && Date.now() < muteExpiry,
        muteExpiresAt: muteExpiry || null,
        lastSeen:     cached.lastSeen || 0,
        messageCount: stats.messageCount || 0,
        commandCount: stats.commandCount || 0,
        hasAutoReply: !!(ar && ar.enabled),
        autoReplyMessage: ar ? ar.message : null,
        emoji: info.emoji || null,
        color: info.color || null,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── Group stats ── */
  app.get("/groups/:threadID/stats", (req, res) => {
    const stats = groupStats.get(req.params.threadID) || { messageCount: 0, commandCount: 0, lastMessageAt: 0 };
    res.json(stats);
  });

  /* ── Lock ── */
  app.post("/groups/:threadID/lock", (req, res) => {
    const { threadID } = req.params;
    if (req.body.locked) lockedThreads.add(threadID);
    else                 lockedThreads.delete(threadID);
    logActivity("Group " + threadID + " " + (req.body.locked ? "locked" : "unlocked") + " via dashboard");
    res.json({ success: true, isLocked: lockedThreads.has(threadID) });
  });

  /* ── Mute ── */
  app.post("/groups/:threadID/mute", (req, res) => {
    const { threadID } = req.params;
    const minutes      = parseInt(req.body.minutes) || 0;
    if (minutes <= 0) {
      mutedThreads.delete(threadID);
      logActivity("Group " + threadID + " unmuted via dashboard");
      res.json({ success: true, isMuted: false });
    } else {
      const expiresAt = Date.now() + minutes * 60000;
      mutedThreads.set(threadID, expiresAt);
      logActivity("Group " + threadID + " muted for " + minutes + " min via dashboard");
      res.json({ success: true, isMuted: true, expiresAt });
    }
  });

  /* ── Rename ── */
  app.post("/groups/:threadID/rename", async (req, res) => {
    const { threadID } = req.params;
    const { name }     = req.body;
    if (!name)    { res.status(400).json({ error: "name required" }); return; }
    if (!botApi)  { res.status(503).json({ error: "Bot not connected" }); return; }
    try {
      await botApi.setTitle(name, threadID);
      const cached = groupsCache.get(threadID) || {};
      groupsCache.set(threadID, { ...cached, name });
      logActivity("Group " + threadID + " renamed to \"" + name + "\" via dashboard");
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── Send message ── */
  app.post("/groups/:threadID/message", async (req, res) => {
    const { threadID } = req.params;
    const { message }  = req.body;
    if (!message) { res.status(400).json({ error: "message required" }); return; }
    if (!botApi)  { res.status(503).json({ error: "Bot not connected" }); return; }
    try {
      await botApi.sendMessage(message, threadID);
      logActivity("Message sent to " + threadID + " via dashboard");
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── Members ── */
  app.get("/groups/:threadID/members", async (req, res) => {
    const { threadID } = req.params;
    if (!botApi) { res.status(503).json({ error: "Bot not connected" }); return; }
    try {
      const info       = await botApi.getThreadInfo(threadID);
      const ids        = info.participantIDs || [];
      const adminSet   = new Set((info.adminIDs || []).map(a => a.id));
      const userInfos  = ids.length > 0 ? await botApi.getUserInfo(ids) : {};
      res.json(ids.map(id => ({ userID: id, name: userInfos[id] ? userInfos[id].name : id, isAdmin: adminSet.has(id) })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── Kick ── */
  app.post("/groups/:threadID/kick", async (req, res) => {
    const { threadID } = req.params;
    const { userID }   = req.body;
    if (!userID)  { res.status(400).json({ error: "userID required" }); return; }
    if (!botApi)  { res.status(503).json({ error: "Bot not connected" }); return; }
    try {
      await botApi.gcmember("remove", userID, threadID);
      logActivity("User " + userID + " kicked from " + threadID + " via dashboard");
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── Auto-reply: get ── */
  app.get("/groups/:threadID/autoreply", (req, res) => {
    const ar = autoReplies.get(req.params.threadID);
    if (!ar) res.json({ enabled: false, message: "", cooldownMinutes: 30 });
    else     res.json({ enabled: ar.enabled, message: ar.message, cooldownMinutes: Math.round(ar.cooldownMs / 60000) });
  });

  /* ── Auto-reply: set ── */
  app.put("/groups/:threadID/autoreply", (req, res) => {
    const { threadID }       = req.params;
    const { message, enabled, cooldownMinutes } = req.body;
    if (!message) { res.status(400).json({ error: "message required" }); return; }
    const cooldownMs = Math.max(1, parseInt(cooldownMinutes) || 30) * 60000;
    const existing   = autoReplies.get(threadID) || { lastSent: new Map() };
    autoReplies.set(threadID, { message, enabled: !!enabled, cooldownMs, lastSent: existing.lastSent });
    logActivity((enabled ? "Auto-reply enabled" : "Auto-reply updated") + " for " + threadID + " via dashboard");
    res.json({ success: true });
  });

  /* ── Auto-reply: delete ── */
  app.delete("/groups/:threadID/autoreply", (req, res) => {
    autoReplies.delete(req.params.threadID);
    logActivity("Auto-reply removed for " + req.params.threadID + " via dashboard");
    res.json({ success: true });
  });

  /* ── Pending message requests ── */
  app.get("/pending", async (req, res) => {
    if (!botApi) { res.status(503).json({ error: "Bot not connected" }); return; }
    try {
      const threads = await botApi.getThreadList(20, null, ["PENDING"]);
      const result  = (threads || []).map(t => ({
        threadID:    t.threadID,
        name:        t.name || t.threadID,
        memberCount: (t.participantIDs || []).length,
        snippet:     t.snippet || "",
        timestamp:   t.timestamp || 0,
      }));
      res.json(result);
    } catch (e) { res.json([]); } // return empty list if unsupported
  });

  /* ── Accept pending request ── */
  app.post("/pending/:threadID/accept", async (req, res) => {
    const { threadID } = req.params;
    if (!botApi) { res.status(503).json({ error: "Bot not connected" }); return; }
    try {
      // Accepting by sending a message moves thread from PENDING to INBOX
      await botApi.sendMessage(req.body.message || ".", threadID);
      logActivity("Accepted message request from " + threadID + " via dashboard");
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── Broadcast ── */
  app.post("/broadcast", async (req, res) => {
    const { message, threadIDs } = req.body;
    const targets = threadIDs || [...groupsCache.keys()];
    if (!message) { res.status(400).json({ error: "message required" }); return; }
    if (!botApi)  { res.status(503).json({ error: "Bot not connected" }); return; }
    let sent = 0, failed = 0;
    for (const tid of targets) {
      try { await botApi.sendMessage(message, tid); sent++; } catch { failed++; }
    }
    logActivity("Broadcast sent to " + sent + " groups, " + failed + " failed — via dashboard");
    res.json({ success: true, sent, failed });
  });

  /* ── Restart ── */
  app.post("/restart", async (req, res) => {
    res.json({ success: true, message: "Restarting in 2 seconds..." });
    logActivity("Bot restart triggered via dashboard API");
    // Save appstate before exiting
    try {
      const fs   = require("fs");
      const path = require("path");
      const cfg  = require("./config.json");
      if (botApi) {
        const state = botApi.getAppState();
        if (Array.isArray(state) && state.length > 0) {
          fs.writeFileSync(path.resolve(__dirname, cfg.appStatePath), JSON.stringify(state, null, 2));
        }
      }
    } catch {}
    setTimeout(() => process.exit(0), 2000);
  });

  /* ── Activity & violations ── */
  app.get("/activity",   (req, res) => res.json(activityLog.slice(-100).reverse()));
  app.get("/violations", (req, res) => res.json(lockViolations.slice(-100).reverse()));

  return app;
}

function startApiServer() {
  const app  = createApiServer();
  const port = (config.dashboard && config.dashboard.port) || 3001;
  app.listen(port, () => logger.success("Dashboard", "API server listening on port " + port));
}

module.exports = { setBotApi, setBotStatus, logActivity, logViolation, startApiServer };
