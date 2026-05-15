"use strict";

const config = require("../config.json");

const LEVELS = { info: "INFO", warn: "WARN", error: "ERROR", debug: "DEBUG", success: "OK" };

function timestamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function colorize(level, text) {
  const codes = { INFO: "\x1b[36m", WARN: "\x1b[33m", ERROR: "\x1b[31m", DEBUG: "\x1b[90m", OK: "\x1b[32m" };
  const reset = "\x1b[0m";
  return `${codes[level] || ""}${text}${reset}`;
}

function log(level, tag, ...args) {
  if (!config.features.logMessages && level === "DEBUG") return;
  const label = LEVELS[level] || level.toUpperCase();
  const prefix = colorize(label, `[${timestamp()}] [${label}] [${tag}]`);
  console.log(prefix, ...args);
}

module.exports = {
  info:    (tag, ...a) => log("info",    tag, ...a),
  warn:    (tag, ...a) => log("warn",    tag, ...a),
  error:   (tag, ...a) => log("error",   tag, ...a),
  debug:   (tag, ...a) => log("debug",   tag, ...a),
  success: (tag, ...a) => log("success", tag, ...a),
};
