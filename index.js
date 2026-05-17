"use strict";

const fs      = require("fs");
const path    = require("path");
const { login } = require("@neoaz07/nkxfca");
const logger    = require("./utils/logger");
const antiSpam  = require("./utils/antiSpam");
const config    = require("./config.json");

const APP_STATE_PATH  = path.resolve(__dirname, config.appStatePath);
const COMMANDS_DIR    = path.resolve(__dirname, "commands");

function loadAppState() {
  if (!fs.existsSync(APP_STATE_PATH)) {
    logger.error("Bot", `appstate.json not found at: ${APP_STATE_PATH}`);
    logger.error("Bot", "Please export your Facebook cookies and save them as appstate.json");
    process.exit(1);
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(APP_STATE_PATH, "utf8"));
  } catch (e) {
    logger.error("Bot", `Failed to parse appstate.json: ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(raw) || raw.length === 0 || raw[0]._README) {
    logger.error("Bot", "appstate.json contains placeholder data.");
    process.exit(1);
  }
  return raw;
}

function loadCommands() {
  const commands = new Map();
  if (!fs.existsSync(COMMANDS_DIR)) return commands;
  const files = fs.readdirSync(COMMANDS_DIR).filter(f => f.endsWith(".js"));
  for (const file of files) {
    try {
      const cmd = require(path.join(COMMANDS_DIR, file));
      if (!cmd.name || typeof cmd.execute !== "function") continue;
      commands.set(cmd.name.toLowerCase(), cmd);
      if (Array.isArray(cmd.aliases)) {
        for (const alias of cmd.aliases) commands.set(alias.toLowerCase(), cmd);
      }
      logger.debug("Commands", `Loaded: ${cmd.name}`);
    } catch (e) {
      logger.warn("Commands", `Failed to load ${file}: ${e.message}`);
    }
  }
  logger.success("Commands", `${[...new Set(commands.values())].length} commands loaded.`);
  return commands;
}

function startAppStateSaver(api) {
  if (!config.features.autoSaveAppState) return;
  const interval = config.features.autoSaveIntervalMs || 300000;
  setInterval(() => {
    try {
      const state = api.getAppState();
      if (Array.isArray(state) && state.length > 0) {
        fs.writeFileSync(APP_STATE_PATH, JSON.stringify(state, null, 2));
        logger.debug("AppState", "Session cookies saved.");
      }
    } catch (e) {
      logger.warn("AppState", `Failed to save appstate: ${e.message}`);
    }
  }, interval);
  logger.info("AppState", `Auto-save enabled every ${interval / 1000}s.`);
}

function isBotAdmin(senderID) {
  return config.bot.adminIDs.includes(senderID);
}

async function isThreadAdmin(api, senderID, threadID) {
  try {
    const info     = await api.getThreadInfo(threadID);
    const adminIDs = (info.adminIDs || []).map(a => a.id);
    if (info.name && groupsCache.has(threadID)) {
      const cached = groupsCache.get(threadID);
      groupsCache.set(threadID, {
        ...cached,
        name:        info.name,
        memberCount: info.participantIDs ? info.participantIDs.length : cached.memberCount,
      });
    }
    return adminIDs.includes(senderID);
  } catch {
    return false;
  }
}

const { lockedThreads, mutedThreads, groupsCache, autoReplies, groupStats } = require("./state");
const { setBotApi, setBotStatus, logActivity, logViolation, startApiServer } = require("./api");

function formatMsg(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

async function handleMessage(api, event, commands) {
  const { type, body, threadID, senderID, messageID } = event;
  if (type !== "message") return;
  if (!body) return;

  const botID = api.getCurrentUserID();
  if (senderID === botID) return;

  const isGroup =
    event.isGroup === true ||
    (Array.isArray(event.participantIDs) && event.participantIDs.length > 2) ||
    (event.isGroup !== false && threadID && senderID && threadID !== senderID);

  if (isGroup) {
    const cached = groupsCache.get(threadID) || {};
    groupsCache.set(threadID, {
      name:        cached.name || null,
      memberCount: event.participantIDs ? event.participantIDs.length : (cached.memberCount || 0),
      lastSeen:    Date.now(),
    });
    const stats = groupStats.get(threadID) || { messageCount: 0, commandCount: 0, lastMessageAt: 0 };
    stats.messageCount++;
    stats.lastMessageAt = Date.now();
    groupStats.set(threadID, stats);

    const ar = autoReplies.get(threadID);
    if (ar && ar.enabled && ar.message && !body.startsWith(config.prefix)) {
      const now      = Date.now();
      const lastSent = ar.lastSent.get(senderID) || 0;
      if (now - lastSent >= ar.cooldownMs) {
        ar.lastSent.set(senderID, now);
        api.sendMessage(ar.message, threadID).catch(() => {});
      }
    }
  }

  if (mutedThreads.has(threadID)) {
    const until = mutedThreads.get(threadID);
    if (Date.now() < until) return;
    mutedThreads.delete(threadID);
  }

  // Cache thread-admin result to avoid a duplicate getThreadInfo call for adminOnly commands
  let cachedIsThreadAdmin = null;
  if (lockedThreads.has(threadID)) {
    const botAdm = isBotAdmin(senderID);
    if (!botAdm) {
      cachedIsThreadAdmin = await isThreadAdmin(api, senderID, threadID);
      if (!cachedIsThreadAdmin) {
        const cached = groupsCache.get(threadID);
        logViolation({
          threadID,
          threadName:     (cached && cached.name) || threadID,
          senderID,
          messagePreview: body.slice(0, 80),
        });
        return;
      }
    } else {
      cachedIsThreadAdmin = true;
    }
  }

  const prefix = config.prefix;
  if (!body.startsWith(prefix)) return;

  const trimmed = body.slice(prefix.length).trim();
  const args    = trimmed.split(/\s+/);
  const name    = args.shift().toLowerCase();
  if (!name) return;

  const cmd = commands.get(name);
  if (!cmd) {
    const suggestion = formatMsg(config.messages.commandNotFound, { cmd: name, prefix });
    return api.sendMessage(suggestion, threadID).catch(() => {});
  }

  if (cmd.groupOnly && !isGroup) {
    return api.sendMessage("❌ هذا الأمر للمجموعات فقط.", threadID);
  }

  // Reuse cached admin check to avoid a second getThreadInfo API call
  if (cmd.adminOnly) {
    const botAdm = isBotAdmin(senderID);
    if (!botAdm) {
      const threadAdm = cachedIsThreadAdmin !== null
        ? cachedIsThreadAdmin
        : await isThreadAdmin(api, senderID, threadID);
      if (!threadAdm) {
        return api.sendMessage("🔒 هذا الأمر يتطلب صلاحية مشرف.", threadID);
      }
    }
  }

  if (config.features.antiSpam) {
    if (antiSpam.isOnCooldown(senderID, cmd.name)) {
      const remaining = (antiSpam.getRemainingCooldown(senderID, cmd.name) / 1000).toFixed(1);
      return api.sendMessage(`⏳ انتظر ${remaining} ثانية قبل استخدام هذا الأمر مجدداً.`, threadID);
    }
    antiSpam.setCooldown(senderID, cmd.name);
  }

  logger.info("Command", `[${threadID}] ${senderID} → ${prefix}${cmd.name} ${args.join(" ")}`);
  if (isGroup) {
    const cs = groupStats.get(threadID) || { messageCount: 0, commandCount: 0, lastMessageAt: 0 };
    cs.commandCount++;
    groupStats.set(threadID, cs);
  }

  try {
    await cmd.execute({ api, event: { ...event, isGroup }, args, commands, mutedThreads, lockedThreads });
  } catch (e) {
    logger.error("Command", `Error in ${prefix}${cmd.name}:`, e.message);
    api.sendMessage(config.messages.errorOccurred, threadID).catch(() => {});
  }
}

const { lockedNames } = require("./utils/lockedNames");

async function handleEvent(api, event) {
  const { type, threadID, logMessageData, logMessageType } = event;
  if (type !== "event") return;

  // Revert group name if it is locked
  if (logMessageType === "log:thread-name") {
    const locked = lockedNames.get(threadID);
    if (locked) {
      const newName = logMessageData?.name || logMessageData?.threadName || "";
      if (newName && newName !== locked) {
        try {
          await api.gcname(locked, threadID);
          api.sendMessage(
            `🔒 تم استعادة اسم المجموعة إلى:\n«${locked}»\n\nالاسم مقفل ولا يمكن تغييره.`,
            threadID
          );
        } catch (e) {
          logger.error("LockName", `Failed to revert group name: ${e.message}`);
        }
      }
    }
  }

  // Greet new members
  if (logMessageType === "log:subscribe" && config.features.greetNewMembers) {
    const addedIDs = logMessageData?.addedParticipants?.map(p => p.userFbId || p.id) || [];
    const botID    = api.getCurrentUserID();
    for (const uid of addedIDs) {
      if (uid === botID) continue;
      try {
        const info = await api.getUserInfo([uid]);
        const name = info[uid]?.name || uid;
        const msg  = formatMsg(config.messages.greet, { name });
        api.sendMessage(msg, threadID).catch(() => {});
      } catch {}
    }
  }

  // Farewell leaving members
  if (logMessageType === "log:unsubscribe" && config.features.farewellMembers) {
    const leftIDs = logMessageData?.leftParticipantFbId
      ? [logMessageData.leftParticipantFbId]
      : [];
    for (const uid of leftIDs) {
      try {
        const info = await api.getUserInfo([uid]);
        const name = info[uid]?.name || uid;
        const msg  = formatMsg(config.messages.farewell, { name });
        api.sendMessage(msg, threadID).catch(() => {});
      } catch {}
    }
  }
}

function startBot() {
  const appState = loadAppState();
  const commands = loadCommands();

  logger.info("Bot", `Starting ${config.bot.name} v${config.bot.version}...`);

  const credentials = { appState };
  if (config.credentials.email && config.credentials.password) {
    credentials.email    = config.credentials.email;
    credentials.password = config.credentials.password;
    logger.info("Bot", "Email/password credentials loaded for auto re-login.");
  }

  login(credentials, config.loginOptions, (err, api) => {
    if (err) {
      logger.error("Bot", "Login failed:", err.error || err.message || String(err));
      if (err.error === "login-approval" || String(err).includes("checkpoint")) {
        logger.error("Bot", "Account requires human verification.");
      }
      setBotStatus("offline — login failed, retrying…");
      logger.info("Bot", "Retrying in 30 seconds...");
      setTimeout(startBot, 30000);
      return;
    }

    const botID = api.getCurrentUserID();
    logger.success("Bot", `Logged in! Bot ID: ${botID}`);
    logger.info("Bot", `Prefix: "${config.prefix}" | Commands: ${[...new Set(commands.values())].length}`);

    try {
      const freshState = api.getAppState();
      if (Array.isArray(freshState) && freshState.length > 0) {
        fs.writeFileSync(APP_STATE_PATH, JSON.stringify(freshState, null, 2));
        logger.success("AppState", "Session cookies refreshed and saved.");
      }
    } catch (e) {
      logger.warn("AppState", "Could not save initial appstate:", e.message);
    }

    startAppStateSaver(api);
    setBotApi(api);
    setBotStatus("online");

    api.onReLoginSuccess = () => {
      logger.success("Bot", "Auto re-login succeeded! Session restored.");
      try {
        const freshState = api.getAppState();
        if (Array.isArray(freshState) && freshState.length > 0) {
          fs.writeFileSync(APP_STATE_PATH, JSON.stringify(freshState, null, 2));
          logger.success("AppState", "Cookies updated after re-login.");
        }
      } catch {}
    };

    api.onReLoginFailure = (e) => {
      logger.error("Bot", "Auto re-login failed permanently:", e.message);
      setBotStatus("offline — re-login failed");
      logger.info("Bot", "Restarting bot process in 60s...");
      setTimeout(() => { process.exit(1); }, 60000);
    };

    api.listenMqtt(async (mqttErr, event) => {
      if (mqttErr) {
        logger.warn("MQTT", "Listen error:", mqttErr.message || mqttErr);
        return;
      }
      if (!event) return;
      try {
        if (event.type === "message") {
          await handleMessage(api, event, commands);
        } else if (event.type === "event") {
          await handleEvent(api, event);
        }
      } catch (e) {
        logger.error("Bot", "Unhandled event error:", e.message);
      }
    });

    logger.success("Bot", "Listening for messages via MQTT...");
  });
}

process.on("SIGINT",  () => { logger.info("Bot", "Shutting down..."); process.exit(0); });
process.on("SIGTERM", () => { logger.info("Bot", "Received SIGTERM, shutting down..."); process.exit(0); });
process.on("uncaughtException", (e) => {
  logger.error("Bot", "Uncaught exception:", e.message);
  logger.error("Bot", e.stack);
});
process.on("unhandledRejection", (reason) => {
  logger.warn("Bot", "Unhandled rejection:", reason?.message || reason);
});

startApiServer();
startBot();
