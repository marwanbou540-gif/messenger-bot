"use strict";

const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const fs     = require("fs");
const os     = require("os");
const path   = require("path");
const config = require("../config.json");

// Register embedded font once at module load
const FONT_PATH = path.join(__dirname, "../assets/JetBrainsMono-Bold.ttf");
let fontReady = false;
try {
  GlobalFonts.registerFromPath(FONT_PATH, "JBMono");
  fontReady = true;
} catch (e) {
  // font file not found yet — will use fallback
}

function pad(n) { return String(n).padStart(2, "0"); }

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const F  = (size) => `bold ${size}px ${fontReady ? "JBMono" : "serif"}`;
const FM = (size) => `${size}px ${fontReady ? "JBMono" : "serif"}`;

async function buildCard(info) {
  const W = 800, H = 460;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // ── Background ────────────────────────────────────────────────────────────
  ctx.fillStyle = "#080812";
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = "#0f0f20";
  ctx.lineWidth   = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // Outer border gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#00e5ff"); bg.addColorStop(0.5, "#7c3aed"); bg.addColorStop(1, "#00e5ff");
  ctx.strokeStyle = bg; ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, W - 2, H - 2, 14); ctx.stroke();

  // ── Header bar ───────────────────────────────────────────────────────────
  ctx.fillStyle = "#0c0c22";
  roundRect(ctx, 2, 2, W - 4, 56, 12); ctx.fill();
  ctx.strokeStyle = "#1c1c38"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(2, 58); ctx.lineTo(W - 2, 58); ctx.stroke();

  // Status dot
  ctx.fillStyle = "#00ff88"; ctx.shadowColor = "#00ff88"; ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.arc(32, 30, 7, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(0,255,136,0.25)"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(32, 30, 13, 0, Math.PI * 2); ctx.stroke();

  // Bot name
  ctx.fillStyle = "#e8e8ff"; ctx.font = F(20); ctx.textAlign = "left";
  ctx.fillText(info.botName.toUpperCase(), 58, 37);

  // Version pill
  const vText = "v" + info.version;
  ctx.font = FM(13);
  const vW  = ctx.measureText(vText).width + 22;
  const vX  = W - vW - 16;
  ctx.fillStyle = "#12122e";
  roundRect(ctx, vX, 14, vW, 30, 7); ctx.fill();
  ctx.strokeStyle = "#00e5ff44"; ctx.lineWidth = 1;
  roundRect(ctx, vX, 14, vW, 30, 7); ctx.stroke();
  ctx.fillStyle = "#00e5ff"; ctx.textAlign = "center";
  ctx.fillText(vText, vX + vW / 2, 34);

  // ── Uptime section header ─────────────────────────────────────────────────
  ctx.fillStyle = "#383860"; ctx.font = FM(11); ctx.textAlign = "center";
  ctx.fillText("S Y S T E M   U P T I M E", W / 2, 82);
  // separator lines
  ctx.strokeStyle = "#1e1e40"; ctx.lineWidth = 1;
  const tw = ctx.measureText("S Y S T E M   U P T I M E").width;
  ctx.beginPath(); ctx.moveTo(W / 2 - tw / 2 - 24, 78); ctx.lineTo(W / 2 - tw / 2 - 6, 78); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W / 2 + tw / 2 + 6, 78); ctx.lineTo(W / 2 + tw / 2 + 24, 78); ctx.stroke();

  // ── Digit blocks ──────────────────────────────────────────────────────────
  const segs = [
    { v: pad(info.days),  l: "DAYS" },
    { v: pad(info.hours), l: "HRS"  },
    { v: pad(info.mins),  l: "MIN"  },
    { v: pad(info.secs),  l: "SEC"  },
  ];
  const DY = 94, DH = 82, DW = 112, GAP = 44;
  const DX0 = (W - segs.length * DW - (segs.length - 1) * GAP) / 2;

  segs.forEach((seg, i) => {
    const cx = DX0 + i * (DW + GAP);

    // Box
    ctx.fillStyle = "#09091c";
    roundRect(ctx, cx, DY, DW, DH, 10); ctx.fill();
    ctx.strokeStyle = "#18183a"; ctx.lineWidth = 1;
    roundRect(ctx, cx, DY, DW, DH, 10); ctx.stroke();

    // Top accent sweep
    const ag = ctx.createLinearGradient(cx, DY, cx + DW, DY);
    ag.addColorStop(0, "transparent"); ag.addColorStop(0.5, "#00e5ff88"); ag.addColorStop(1, "transparent");
    ctx.fillStyle = ag; ctx.fillRect(cx, DY, DW, 2);

    // Digit glow
    const dg = ctx.createLinearGradient(cx + DW / 2, DY, cx + DW / 2, DY + DH);
    dg.addColorStop(0, "#00eeff"); dg.addColorStop(1, "#007799");
    ctx.fillStyle = dg; ctx.shadowColor = "#00e5ff"; ctx.shadowBlur = 18;
    ctx.font = F(52); ctx.textAlign = "center";
    ctx.fillText(seg.v, cx + DW / 2, DY + 64);
    ctx.shadowBlur = 0;

    // Label
    ctx.fillStyle = "#383860"; ctx.font = FM(9);
    ctx.fillText(seg.l, cx + DW / 2, DY + DH + 15);

    // Colon separator
    if (i < 3) {
      const cx2 = cx + DW + GAP / 2;
      ctx.fillStyle = "#00ccee"; ctx.shadowColor = "#00e5ff"; ctx.shadowBlur = 10;
      ctx.font = F(32); ctx.fillText(":", cx2, DY + 52); ctx.shadowBlur = 0;
    }
  });

  // ── Stats row ─────────────────────────────────────────────────────────────
  const SY    = DY + DH + 42;
  const COLS  = ["#00e5ff", "#7c3aed", "#f59e0b", "#10b981"];
  const stats = [
    { label: "MEMORY",   value: info.memMB + " MB"   },
    { label: "GROUPS",   value: String(info.groups)   },
    { label: "COMMANDS", value: String(info.commands) },
    { label: "PLATFORM", value: info.platform         },
  ];
  const SW = 168, SH = 76, SGAP = 16;
  const SX0 = (W - stats.length * SW - (stats.length - 1) * SGAP) / 2;

  stats.forEach((s, i) => {
    const bx = SX0 + i * (SW + SGAP), col = COLS[i];

    ctx.fillStyle = "#080818";
    roundRect(ctx, bx, SY, SW, SH, 9); ctx.fill();
    ctx.strokeStyle = col + "55"; ctx.lineWidth = 1.5;
    roundRect(ctx, bx, SY, SW, SH, 9); ctx.stroke();

    // Top color sweep
    const sg = ctx.createLinearGradient(bx, SY, bx + SW, SY);
    sg.addColorStop(0, col + "cc"); sg.addColorStop(0.5, col + "33"); sg.addColorStop(1, "transparent");
    ctx.fillStyle = sg; ctx.fillRect(bx + 1, SY + 1, SW - 2, 3);

    // Label
    ctx.fillStyle = "#44446a"; ctx.font = FM(9); ctx.textAlign = "center";
    ctx.fillText(s.label, bx + SW / 2, SY + 20);

    // Value
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8;
    ctx.font = F(22);
    ctx.fillText(s.value, bx + SW / 2, SY + 52);
    ctx.shadowBlur = 0;
  });

  // ── Footer ────────────────────────────────────────────────────────────────
  ctx.fillStyle = "#252545"; ctx.font = FM(10); ctx.textAlign = "center";
  const now = new Date().toLocaleString("en-GB", { hour:"2-digit", minute:"2-digit", second:"2-digit", day:"numeric", month:"short", year:"numeric" });
  ctx.fillText("Node.js " + process.version + "  \u2022  " + now, W / 2, H - 14);

  return canvas.toBuffer("image/png");
}

module.exports = {
  name: "uptime",
  aliases: ["up"],
  description: "\u0639\u0631\u0636 \u0645\u0639\u0644\u0648\u0645\u0627\u062a \u0627\u0644\u0628\u0648\u062a \u0643\u0635\u0648\u0631\u0629 \u0631\u0642\u0645\u064a\u0629.",
  usage: "uptime",
  category: "General",

  async execute({ api, event, commands }) {
    const total = Math.floor(process.uptime());
    const days  = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const mins  = Math.floor((total % 3600) / 60);
    const secs  = total % 60;
    const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);

    let groups = 0;
    try { const { groupsCache } = require("../state"); groups = groupsCache.size; } catch {}
    const cmdCount = commands ? [...new Set(commands.values())].length : 0;

    const info = {
      botName: config.bot.name, version: config.bot.version,
      days, hours, mins, secs, memMB, groups,
      commands: cmdCount, platform: os.platform(),
    };

    const tmpFile = path.join(os.tmpdir(), "uptime_" + Date.now() + ".png");
    try {
      const buf = await buildCard(info);
      fs.writeFileSync(tmpFile, buf);
      await api.sendMessage({ body: "", attachment: fs.createReadStream(tmpFile) }, event.threadID);
    } catch (err) {
      api.sendMessage(
        "\u23f1\ufe0f Uptime: " + days + "d " + hours + "h " + mins + "m " + secs + "s\n\ud83d\udcbe RAM: " + memMB + " MB",
        event.threadID
      );
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  },
};
