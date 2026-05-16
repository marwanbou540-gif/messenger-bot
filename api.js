"use strict";

const express = require("express");
const cors    = require("cors");
const config  = require("./config.json");
const logger  = require("./utils/logger");
const { lockedThreads, mutedThreads, groupsCache, activityLog } = require("./state");

let botApi      = null;
let startTime   = Date.now();

function setBotApi(api) {
  botApi    = api;
  startTime = Date.now();
}

function logActivity(msg) {
  activityLog.push({ time: Date.now(), message: msg });
  if (activityLog.length > 300) activityLog.shift();
}

function authMiddleware(req, res, next) {
  const key = config.dashboard && config.dashboard.apiKey;
  if (!key) return next();
  const auth = req.headers["authorization"] || "";
  if (auth !== "Bearer " + key) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

function createApiServer() {
  const app = express();
  app.use(cors({ origin: "*" }));
  app.use(express.json());
  app.use(authMiddleware);

  // GET /health
  app.get("/health", (req, res) => {
    res.json({
      status: "online",
      botName: config.bot.name,
      version: config.bot.version,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      groupCount: groupsCache.size,
      lockedCount: lockedThreads.size,
    });
  });

  // GET /groups
  app.get("/groups", (req, res) => {
    const groups = [];
    for (const [threadID, info] of groupsCache.entries()) {
      const muteExpiry = mutedThreads.get(threadID);
      groups.push({
        threadID,
        name: info.name || threadID,
        memberCount: info.memberCount || 0,
        isLocked: lockedThreads.has(threadID),
        isMuted: muteExpiry != null && Date.now() < muteExpiry,
        lastSeen: info.lastSeen || 0,
      });
    }
    groups.sort((a, b) => b.lastSeen - a.lastSeen);
    res.json(groups);
  });

  // POST /groups/:threadID/lock
  app.post("/groups/:threadID/lock", (req, res) => {
    const threadID = req.params.threadID;
    const locked   = req.body.locked;
    if (locked) {
      lockedThreads.add(threadID);
    } else {
      lockedThreads.delete(threadID);
    }
    logActivity("Group " + threadID + " " + (locked ? "locked" : "unlocked") + " via dashboard");
    res.json({ success: true, isLocked: lockedThreads.has(threadID) });
  });

  // POST /groups/:threadID/message
  app.post("/groups/:threadID/message", async (req, res) => {
    const threadID = req.params.threadID;
    const message  = req.body.message;
    if (!message) { res.status(400).json({ error: "message required" }); return; }
    if (!botApi)  { res.status(503).json({ error: "Bot not connected" }); return; }
    try {
      await botApi.sendMessage(message, threadID);
      logActivity("Message sent to " + threadID + " via dashboard");
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /groups/:threadID/members
  app.get("/groups/:threadID/members", async (req, res) => {
    const threadID = req.params.threadID;
    if (!botApi) { res.status(503).json({ error: "Bot not connected" }); return; }
    try {
      const info         = await botApi.getThreadInfo(threadID);
      const participantIDs = info.participantIDs || [];
      const adminIDSet   = new Set((info.adminIDs || []).map(a => a.id));
      const userInfos    = participantIDs.length > 0
        ? await botApi.getUserInfo(participantIDs)
        : {};
      const members = participantIDs.map(id => ({
        userID:  id,
        name:    userInfos[id] ? userInfos[id].name : id,
        isAdmin: adminIDSet.has(id),
      }));
      res.json(members);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /groups/:threadID/kick
  app.post("/groups/:threadID/kick", async (req, res) => {
    const threadID = req.params.threadID;
    const userID   = req.body.userID;
    if (!userID)  { res.status(400).json({ error: "userID required" }); return; }
    if (!botApi)  { res.status(503).json({ error: "Bot not connected" }); return; }
    try {
      await botApi.gcmember("remove", userID, threadID);
      logActivity("User " + userID + " kicked from " + threadID + " via dashboard");
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /broadcast
  app.post("/broadcast", async (req, res) => {
    const message   = req.body.message;
    const threadIDs = req.body.threadIDs || [...groupsCache.keys()];
    if (!message) { res.status(400).json({ error: "message required" }); return; }
    if (!botApi)  { res.status(503).json({ error: "Bot not connected" }); return; }
    let sent = 0, failed = 0;
    for (const threadID of threadIDs) {
      try {
        await botApi.sendMessage(message, threadID);
        sent++;
      } catch { failed++; }
    }
    logActivity("Broadcast sent to " + sent + " groups, " + failed + " failed — via dashboard");
    res.json({ success: true, sent, failed });
  });

  // GET /activity
  app.get("/activity", (req, res) => {
    res.json(activityLog.slice(-100).reverse());
  });

  return app;
}

function startApiServer() {
  const app  = createApiServer();
  const port = (config.dashboard && config.dashboard.port) || 3001;
  app.listen(port, () => {
    logger.success("Dashboard", "API server listening on port " + port);
  });
}

module.exports = { setBotApi, logActivity, startApiServer };
