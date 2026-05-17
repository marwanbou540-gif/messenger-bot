"use strict";

const fs      = require("fs");
const https   = require("https");
const path    = require("path");
const { login } = require("@neoaz07/nkxfca");
const logger    = require("./utils/logger");
const antiSpam  = require("./utils/antiSpam");
const config    = require("./config.json");

const APP_STATE_PATH  = path.resolve(__dirname, config.appStatePath);
const COMMANDS_DIR    = path.resolve(__dirname, "commands");
const GH_TOKEN        = process.env.GITHUB_PERSONAL_ACCESS_TOKEN || "";
const GH_REPO         = "marwanbou540-gif/messenger-bot";

// ── Push appstate.json back to GitHub so cookies survive Railway restarts ─────
let _ghAppStateSha = "";   // cached to skip extra fetch requests

async function pushAppStateToGitHub(filePath) {
  if (!GH_TOKEN) return;   // silently skip if env var not set on Railway
  const content = fs.readFileSync(filePath, "utf8");

  // Fetch current file SHA if not cached
  if (!_ghAppStateSha) {
    const res = await new Promise((resolve, reject) => {
      https.get({
        hostname: "api.github.com",
        path: `/repos/${GH_REPO}/contents/appstate.json`,
        headers: { "Authorization": `token ${GH_TOKEN}`, "User-Agent": "bot-appstate", "Accept": "application/vnd.github.v3+json" }
      }, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => resolve(JSON.parse(d))); }).on("error", reject);
    });
    _ghAppStateSha = res.sha || "";
  }

  const body = JSON.stringify({
    message: "chore: auto-update appstate.json [skip ci]",
    content: Buffer.from(content).toString("base64"),
    sha: _ghAppStateSha,
  });

  const result = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.github.com",
      path: `/repos/${GH_REPO}/contents/appstate.json`,
      method: "PUT",
      headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3+json", "User-Agent": "bot-appstate", "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => resolve(JSON.parse(d))); });
    req.on("error", reject); req.write(body); req.end();
  });

  // Update cached SHA from the response
  if (result.content && result.content.sha) _ghAppStateSha = result.content.sha;
}

function saveAndPushAppState(label) {
  try {
    const state = (typeof label === "object") ? label : null;
    // Called with api object when triggering save
  } catch {}
}

// ── Load appstate from disk ───────────────────────────────────────────────────
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

// ── Periodic appstate saver (local + GitHub) ──────────────────────────────────
function startAppStateSaver(api) {
  if (!config.features.autoSaveAppState) return;
  const interval = config.features.autoSaveIntervalMs || 300000;
  setInterval(() => {
    try {
      const state = api.getAppState();
      if (Array.isArray(state) && state.length > 0) {
        fs.writeFileSync(APP_STATE_PATH, JSON.stringify(state, null, 2));
        logger.debug("AppState", "Session cookies saved locally.");
        pushAppStateToGitHub(APP_STATE_PATH)
          .then(() => logger.debug("AppState", "Cookies pushed to GitHub."))
          .catch(e  => logger.warn("AppState", `GitHub push failed: ${e.message}`));
      }
    } catch (e) {
      logger.warn("AppState", `Failed to save appstate: ${e.message}`);
    }
  }, interval);
  logger.info("AppState", `Auto-save enabled every ${interval / 1000}s (local + GitHub).`);
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
    return api.sendMessage("\u274C \u0647\u0630\u0627 \u0627\u0644\u0623\u0645\u0631 \u0644\u0644\u0645\u062c\u0645\u0648\u0639\u0627\u062a \u0641\u0642\u0637.", threadID);
  }

  if (cmd.adminOnly) {
    const botAdm = isBotAdmin(senderID);
    if (!botAdm) {
      const threadAdm = cachedIsThreadAdmin !== null
        ? cachedIsThreadAdmin
        : await isThreadAdmin(api, senderID, threadID);
      if (!threadAdm) {
        return api.sendMessage("\uD83D\uDD12 \u0647\u0630\u0627 \u0627\u0644\u0623\u0645\u0631 \u064a\u062a\u0637\u0644\u0628 \u0635\u0644\u0627\u062d\u064a\u0629 \u0645\u0634\u0631\u0641.", threadID);
      }
    }
  }

  if (config.features.antiSpam) {
    if (antiSpam.isOnCooldown(senderID, cmd.name)) {
      const remaining = (antiSpam.getRemainingCooldown(senderID, cmd.name) / 1000).toFixed(1);
      return api.sendMessage(`\u23F3 \u0627\u0646\u062a\u0638\u0631 ${remaining} \u062b\u0627\u0646\u064a\u0629 \u0642\u0628\u0644 \u0627\u0633\u062a\u062e\u062f\u0627\u0645 \u0647\u0630\u0627 \u0627\u0644\u0623\u0645\u0631 \u0645\u062c\u062f\u062f\u0627\u064b.`, threadID);
    }
    antiSpam.setCooldown(senderID, cmd.name);
  }

  logger.info("Command", `[${threadID}] ${senderID} \u2192 ${prefix}${cmd.name} ${args.join(" ")}`);
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

  if (logMessageType === "log:thread-name") {
    const locked = lockedNames.get(threadID);
    if (locked) {
      const newName = logMessageData?.name || logMessageData?.threadName || "";
      if (newName && newName !== locked) {
        try {
          await api.gcname(locked, threadID);
          api.sendMessage(
            `\uD83D\uDD12 \u062a\u0645 \u0627\u0633\u062a\u0639\u0627\u062f\u0629 \u0627\u0633\u0645 \u0627\u0644\u0645\u062c\u0645\u0648\u0639\u0629 \u0625\u0644\u0649:\n\u00ab${locked}\u00bb\n\n\u0627\u0644\u0627\u0633\u0645 \u0645\u0642\u0641\u0644 \u0648\u0644\u0627 \u064a\u0645\u0643\u0646 \u062a\u063a\u064a\u064a\u0631\u0647.`,
            threadID
          );
        } catch (e) {
          logger.error("LockName", `Failed to revert group name: ${e.message}`);
        }
      }
    }
  }

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
      setBotStatus("offline \u2014 login failed, retrying\u2026");
      logger.info("Bot", "Retrying in 30 seconds...");
      setTimeout(startBot, 30000);
      return;
    }

    const botID = api.getCurrentUserID();
    logger.success("Bot", `Logged in! Bot ID: ${botID}`);
    logger.info("Bot", `Prefix: "${config.prefix}" | Commands: ${[...new Set(commands.values())].length}`);

    // Save fresh cookies locally + push to GitHub immediately after login
    try {
      const freshState = api.getAppState();
      if (Array.isArray(freshState) && freshState.length > 0) {
        fs.writeFileSync(APP_STATE_PATH, JSON.stringify(freshState, null, 2));
        logger.success("AppState", "Session cookies refreshed and saved locally.");
        pushAppStateToGitHub(APP_STATE_PATH)
          .then(() => logger.success("AppState", "Fresh cookies pushed to GitHub."))
          .catch(e  => logger.warn("AppState", `GitHub push after login failed: ${e.message}`));
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
          logger.success("AppState", "Cookies updated locally after re-login.");
          pushAppStateToGitHub(APP_STATE_PATH)
            .then(() => logger.success("AppState", "Re-login cookies pushed to GitHub."))
            .catch(e  => logger.warn("AppState", `GitHub push after re-login failed: ${e.message}`));
        }
      } catch {}
    };

    api.onReLoginFailure = (e) => {
      logger.error("Bot", "Auto re-login failed permanently:", e.message);
      setBotStatus("offline \u2014 re-login failed");
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
process.on("SIGTERM", () => { logger.info("Bot", "Shutting down..."); process.exit(0); });
process.on("uncaughtException", (e) => {
  logger.error("Bot", "Uncaught exception:", e.message);
  logger.error("Bot", e.stack);
});
process.on("unhandledRejection", (reason) => {
  logger.warn("Bot", "Unhandled rejection:", reason?.message || reason);
});

startApiServer();
startBot();
