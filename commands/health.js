"use strict";

module.exports = {
  name: "health",
  aliases: ["status", "healthcheck"],
  description: "Show bot MQTT connection and session health.",
  usage: "health",
  category: "Info",

  async execute({ api, event }) {
    let status;
    try {
      status = api.getHealthStatus();
    } catch {
      return api.sendMessage("❌ Could not retrieve health status.", event.threadID);
    }

    const mqtt   = status.mqtt   || {};
    const token  = status.token  || {};
    const rate   = status.rateLimiter || {};

    const connected  = mqtt.connected  ? "🟢 Connected"  : "🔴 Disconnected";
    const reconnects = mqtt.reconnects ?? "N/A";
    const reqMin     = rate.requestsInLastMinute ?? "N/A";
    const maxMin     = rate.maxRequestsPerMinute ?? "N/A";
    const concurrent = rate.maxConcurrentRequests ?? "N/A";

    const msg =
      `╔══ 💊 Health Status ══╗\n` +
      `║ MQTT      : ${connected}\n` +
      `║ Reconnects: ${reconnects}\n` +
      `╠══ 📡 Rate Limiter ══╣\n` +
      `║ Req/min   : ${reqMin} / ${maxMin}\n` +
      `║ Concurrent: ${concurrent}\n` +
      `╠══ 🔑 Token ══╣\n` +
      `║ Refreshes : ${token.refreshCount ?? "N/A"}\n` +
      `║ Failures  : ${token.failureCount ?? "N/A"}\n` +
      `╚═══════════════════════╝`;

    api.sendMessage(msg, event.threadID);
  },
};
