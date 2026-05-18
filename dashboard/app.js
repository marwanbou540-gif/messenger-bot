"use strict";
// ── DOM helpers ───────────────────────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (!c && c !== 0) continue;
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return e;
}
function fmtUptime(s) {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m ${s%60}s`;
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
}
function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("ar");
}
function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("ar");
}
function fmtMem(mb) { return mb >= 1024 ? `${(mb/1024).toFixed(1)}GB` : `${mb}MB`; }

// ── Auth ──────────────────────────────────────────────────────────────────────
let _token = sessionStorage.getItem("token") || "";
let _base  = "";  // API base URL — empty = same origin

function getToken()  { return _token; }
function setToken(t) { _token = t; sessionStorage.setItem("token", t); }
function clearToken(){ _token = ""; sessionStorage.removeItem("token"); }

async function API(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (_token) headers["Authorization"] = `Bearer ${_token}`;
  const r = await fetch(_base + path, { headers, ...opts });
  if (r.status === 401) { showLogin(); throw new Error("Unauthorized"); }
  return r;
}
async function apiFetch(path, opts)  { return (await API(path, opts)).json(); }
async function apiPost(path, body)   { return apiFetch(path, { method: "POST", body: JSON.stringify(body || {}) }); }
async function apiPut(path, body)    { return apiFetch(path, { method: "PUT",  body: JSON.stringify(body || {}) }); }
async function apiDel(path)          { return apiFetch(path, { method: "DELETE" }); }

// ── Toast ─────────────────────────────────────────────────────────────────────
let _toastTimer = null;
function toast(msg, type = "ok") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast show ${type}-t`;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.className = "toast"; }, 3000);
}

// ── Login / Logout ────────────────────────────────────────────────────────────
async function doLogin() {
  const key = $("#loginKey").value.trim();
  const btn = $("#loginBtn");
  btn.disabled = true; btn.textContent = "جاري التحقق...";
  try {
    const r = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ key }) });
    if (r.success) {
      setToken(r.token);
      showApp();
    } else {
      $("#loginError").textContent = "مفتاح خاطئ";
    }
  } catch {
    $("#loginError").textContent = "تعذر الاتصال بالخادم";
  } finally {
    btn.disabled = false; btn.textContent = "دخول";
  }
}
document.addEventListener("keydown", e => { if (e.key === "Enter" && $("#loginScreen").style.display !== "none") doLogin(); });

function doLogout() { clearToken(); showLogin(); }

function showLogin() {
  $("#loginScreen").style.display = "flex";
  $("#app").style.display = "none";
  stopPolling();
}

function showApp() {
  $("#loginScreen").style.display = "none";
  $("#app").style.display = "flex";
  buildTabs();
  loadTab("overview");
  startPolling();
  connectSSE();
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TAB_LIST = [
  { id: "overview",   label: "📊 نظرة عامة" },
  { id: "groups",     label: "👥 المجموعات" },
  { id: "commands",   label: "📜 الأوامر" },
  { id: "broadcast",  label: "📣 بث جماعي" },
  { id: "humansim",   label: "🧠 محاكاة بشرية" },
  { id: "features",   label: "🎛️ المميزات" },
  { id: "cookies",    label: "🍪 الجلسة" },
  { id: "activity",   label: "📋 سجل النشاط" },
  { id: "violations", label: "🛡️ المخالفات" },
  { id: "diagnostics",label: "🔍 التشخيص" },
];

let _currentTab = "";
const TABS = {};

function buildTabs() {
  const bar = $("#tabBar");
  bar.innerHTML = "";
  for (const t of TAB_LIST) {
    const btn = el("button", { class: "tab-btn", onclick: () => loadTab(t.id) }, t.label);
    btn.dataset.tab = t.id;
    bar.appendChild(btn);
  }
}

async function loadTab(name) {
  if (_currentTab === name) return;
  // cleanup previous tab
  const prev = $("#content");
  if (prev._cleanup) { prev._cleanup(); prev._cleanup = null; }

  _currentTab = name;
  $$(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === name));

  const root = $("#content");
  root.innerHTML = `<div class="loading"><div class="spinner"></div> جاري التحميل...</div>`;
  if (TABS[name]) {
    try { await TABS[name](root); }
    catch (e) { root.innerHTML = `<div class="card"><p style="color:var(--err)">خطأ: ${e.message}</p></div>`; }
  }
}

// ── Topbar polling ────────────────────────────────────────────────────────────
let _pollingInterval = null;
let _lastOverview    = null;

function startPolling() {
  pollTopbar();
  _pollingInterval = setInterval(pollTopbar, 5000);
}
function stopPolling() {
  if (_pollingInterval) { clearInterval(_pollingInterval); _pollingInterval = null; }
}

async function pollTopbar() {
  try {
    const d = await apiFetch("/overview");
    _lastOverview = d;
    const status = d.status || "unknown";
    const pill = $("#pillStatus");
    if (pill) {
      pill.textContent = status === "online" ? "🟢 متصل" : `🔴 ${status}`;
      pill.className = `pill ${status === "online" ? "ok" : "err"}`;
    }
    const pg = $("#pillGroups");
    if (pg) pg.textContent = `${d.groupCount || 0} مجموعة`;
    const pu = $("#pillUptime");
    if (pu) pu.textContent = d.uptime ? fmtUptime(d.uptime) : "—";
    const pm = $("#pillMem");
    if (pm) pm.textContent = `RAM: ${d.health ? fmtMem(d.health.memMB) : "—"}`;
  } catch {}
}

// ── SSE live feed ─────────────────────────────────────────────────────────────
let _sse = null;
const _sseHandlers = [];

function connectSSE() {
  if (_sse) _sse.close();
  const headers = _token ? `?token=${encodeURIComponent(_token)}` : "";
  _sse = new EventSource(_base + "/stream" + headers);
  _sse.onmessage = e => {
    try {
      const d = JSON.parse(e.data);
      for (const h of _sseHandlers) h(d);
    } catch {}
  };
  _sse.onerror = () => {
    setTimeout(connectSSE, 5000);
  };
}

function subscribeSSE(fn) {
  _sseHandlers.push(fn);
  return () => { const i = _sseHandlers.indexOf(fn); if (i >= 0) _sseHandlers.splice(i, 1); };
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: OVERVIEW
// ══════════════════════════════════════════════════════════════════════════════
TABS.overview = async (root) => {
  root.innerHTML = "";
  const d = await apiFetch("/overview");

  const statusColor = d.status === "online" ? "ok" : "err";
  const hs = d.health || {};

  root.appendChild(el("div", { class: "grid cols-4" },
    statCard("الحالة", d.status === "online" ? "متصل ✅" : d.status, ""),
    statCard("المجموعات", d.groupCount || 0, "مجموعة نشطة"),
    statCard("وقت التشغيل", fmtUptime(d.uptime || 0), "منذ آخر تشغيل"),
    statCard("الرسائل", d.totalMessages || 0, "إجمالي الرسائل"),
  ));

  const grid2 = el("div", { class: "grid page-cols", style: "margin-top:20px" });

  // Health card
  const hc = el("div", { class: "card" });
  hc.appendChild(el("h2", {}, "📊 صحة النظام"));
  hc.appendChild(infoRow("الذاكرة المستخدمة", hs.memMB ? fmtMem(hs.memMB) : "—"));
  hc.appendChild(infoRow("CPU", hs.cpuPct !== undefined ? `${hs.cpuPct}%` : "—"));
  hc.appendChild(infoRow("تأخير حلقة الأحداث", hs.loopLagMs !== undefined ? `${hs.loopLagMs.toFixed(0)}ms` : "—"));
  hc.appendChild(infoRow("المجموعات المقفولة", d.lockedCount || 0));
  hc.appendChild(infoRow("المجموعات المكتومة", d.mutedCount || 0));
  hc.appendChild(infoRow("الأوامر المُنفَّذة", d.totalCommands || 0));

  // Mem bar
  if (hs.memMB) {
    const pct = Math.min(100, (hs.memMB / 700) * 100);
    const barColor = pct > 85 ? "var(--err)" : pct > 55 ? "var(--warn)" : "var(--ok)";
    const bar = el("div", { class: "progress-bar" });
    bar.appendChild(el("div", { class: "progress-fill", style: `width:${pct}%;background:linear-gradient(90deg,${barColor},var(--blue))` }));
    hc.appendChild(bar);
  }
  grid2.appendChild(hc);

  // Human sim card
  const hs2 = d.humanSim || {};
  const hsc = el("div", { class: "card" });
  hsc.appendChild(el("h2", {}, "🧠 محاكاة بشرية"));
  const dotClass = hs2.running ? "hs-dot running" : "hs-dot";
  const simStatus = el("div", { class: "humansim-status" },
    el("div", { class: dotClass }),
    el("span", {}, hs2.running ? "نشط — يحاكي سلوك إنساني" : "متوقف")
  );
  hsc.appendChild(simStatus);
  if (hs2.stats) {
    hsc.appendChild(infoRow("إشارات التواجد", hs2.stats.presenceSent || 0));
    hsc.appendChild(infoRow("محاكاة الكتابة", hs2.stats.typingSimulated || 0));
    hsc.appendChild(infoRow("قراءة المحادثات", hs2.stats.threadsRead || 0));
    hsc.appendChild(infoRow("آخر نشاط", fmtTime(hs2.stats.lastActionAt)));
  }
  const goBtn = el("button", { class: "btn ghost", style: "margin-top:12px", onclick: () => loadTab("humansim") }, "⚙️ إعدادات المحاكاة");
  hsc.appendChild(goBtn);
  grid2.appendChild(hsc);

  root.appendChild(grid2);

  // Recent activity
  const ac = el("div", { class: "card", style: "margin-top:20px" });
  ac.appendChild(el("h2", {}, "🕐 النشاط الأخير"));
  const logDiv = el("div", { class: "log-stream" });
  const activities = d.recentActivity || [];
  if (activities.length === 0) {
    logDiv.appendChild(el("div", { class: "log-line DEFAULT" }, "لا يوجد نشاط حديث"));
  } else {
    for (const a of activities) {
      logDiv.appendChild(el("div", { class: "log-line OK" }, `[${fmtTime(a.time)}] ${a.message}`));
    }
  }
  ac.appendChild(logDiv);
  root.appendChild(ac);

  // SSE live updates for activity
  const unsub = subscribeSSE(msg => {
    if (msg.type === "activity") {
      const line = el("div", { class: "log-line OK" }, `[${fmtTime(msg.data.time)}] ${msg.data.message}`);
      logDiv.insertBefore(line, logDiv.firstChild);
    }
  });
  root._cleanup = unsub;
};

// ══════════════════════════════════════════════════════════════════════════════
// TAB: GROUPS
// ══════════════════════════════════════════════════════════════════════════════
TABS.groups = async (root) => {
  root.innerHTML = "";
  const groups = await apiFetch("/groups");

  const card = el("div", { class: "card" });
  card.appendChild(el("h2", {}, `👥 المجموعات (${groups.length})`));

  if (groups.length === 0) {
    card.appendChild(el("div", { class: "empty" }, el("div", { class: "empty-icon" }, "👥"), "لا توجد مجموعات في الكاش"));
    root.appendChild(card);
    return;
  }

  const search = el("div", { class: "search-bar" }, el("input", { type: "text", placeholder: "ابحث باسم المجموعة…",
    oninput: function() {
      const q = this.value.toLowerCase();
      $$(".group-card-wrap", card).forEach(w => {
        w.style.display = w.dataset.name.includes(q) ? "" : "none";
      });
    }
  }));
  card.appendChild(search);

  for (const g of groups) {
    const wrap = el("div", { class: "group-card-wrap", style: "margin-bottom:8px" });
    wrap.dataset.name = (g.name || "").toLowerCase();

    const gc = el("div", { class: "group-card" });
    gc.appendChild(el("div", { class: "group-icon" }, "💬"));

    const info = el("div", { class: "group-info" });
    const nameLine = el("div", { class: "group-name" }, g.name || g.threadID);
    const meta = el("div", { class: "group-meta" });
    const badges = [];
    if (g.isLocked) badges.push("🔒 مقفول");
    if (g.isMuted)  badges.push("🔇 مكتوم");
    if (g.hasAutoReply) badges.push("💬 رد تلقائي");
    meta.textContent = `${g.memberCount} عضو · ${g.messageCount} رسالة · ${g.commandCount} أمر${badges.length ? " · " + badges.join(" · ") : ""}`;
    info.appendChild(nameLine);
    info.appendChild(meta);
    gc.appendChild(info);

    const actions = el("div", { class: "group-actions" });

    // Lock toggle
    const lockBtn = el("button", { class: `btn ${g.isLocked ? "danger" : "ghost"}`, onclick: async () => {
      const r = await apiPost(`/groups/${g.threadID}/lock`, { locked: !g.isLocked });
      if (r.success) { toast(r.isLocked ? "تم قفل المجموعة" : "تم فتح المجموعة", "ok"); await loadTab("groups"); }
      else toast("فشل", "err");
    }}, g.isLocked ? "🔒 فتح" : "🔓 قفل");

    // Send message
    const msgBtn = el("button", { class: "btn ghost", onclick: () => {
      const msg = prompt(`رسالة إلى ${g.name || g.threadID}:`);
      if (!msg) return;
      apiPost(`/groups/${g.threadID}/message`, { message: msg })
        .then(r => r.success ? toast("تم الإرسال", "ok") : toast("فشل الإرسال", "err"));
    }}, "📨 إرسال");

    actions.appendChild(lockBtn);
    actions.appendChild(msgBtn);
    gc.appendChild(actions);
    wrap.appendChild(gc);
    card.appendChild(wrap);
  }

  root.appendChild(card);
};

// ══════════════════════════════════════════════════════════════════════════════
// TAB: COMMANDS
// ══════════════════════════════════════════════════════════════════════════════
TABS.commands = async (root) => {
  root.innerHTML = "";
  const cmds = await apiFetch("/commands");

  const card = el("div", { class: "card" });
  card.appendChild(el("h2", {}, `📜 الأوامر (${cmds.length})`));

  const tbl = el("table", { class: "tbl" });
  const thead = el("thead");
  thead.appendChild(el("tr", {},
    el("th", {}, "الاسم"),
    el("th", {}, "الوصف"),
    el("th", {}, "المستعارات"),
    el("th", {}, "الصلاحيات"),
  ));
  tbl.appendChild(thead);

  const tbody = el("tbody");
  for (const c of cmds) {
    const perms = [];
    if (c.adminOnly) perms.push(el("span", { class: "badge warn" }, "مشرف"));
    if (c.groupOnly) perms.push(el("span", { class: "badge blue" }, "مجموعات"));
    if (!perms.length) perms.push(el("span", { class: "badge ok" }, "الجميع"));

    const tr = el("tr", {},
      el("td", {}, el("code", { style: "color:var(--cyan);font-family:'JetBrains Mono',monospace;font-size:12px" }, `-${c.name}`)),
      el("td", { style: "color:var(--text-dim);font-size:12px" }, c.description || "—"),
      el("td", { style: "color:var(--text-faint);font-size:11px;font-family:'JetBrains Mono',monospace" }, c.aliases.map(a => `-${a}`).join(", ") || "—"),
      el("td", {}, ...perms),
    );
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  card.appendChild(tbl);
  root.appendChild(card);
};

// ══════════════════════════════════════════════════════════════════════════════
// TAB: BROADCAST
// ══════════════════════════════════════════════════════════════════════════════
TABS.broadcast = async (root) => {
  root.innerHTML = "";
  const card = el("div", { class: "card" });
  card.appendChild(el("h2", {}, "📣 بث رسالة لجميع المجموعات"));

  const msgArea = el("textarea", { placeholder: "اكتب الرسالة هنا…" });
  card.appendChild(el("div", { class: "form-group" }, el("label", {}, "الرسالة"), msgArea));

  const resultDiv = el("div", { style: "margin-top:12px;font-size:13px;color:var(--text-dim)" });
  card.appendChild(resultDiv);

  card.appendChild(el("div", { class: "btn-row", style: "margin-top:16px" },
    el("button", { class: "btn primary", onclick: async () => {
      const msg = msgArea.value.trim();
      if (!msg) { toast("أدخل رسالة أولاً", "warn"); return; }
      resultDiv.textContent = "⏳ جاري الإرسال…";
      const r = await apiPost("/broadcast", { message: msg });
      if (r.success) {
        resultDiv.textContent = `✅ تم الإرسال إلى ${r.sent} مجموعة · فشل ${r.failed}`;
        toast(`بث ناجح: ${r.sent} مجموعة`, "ok");
      } else {
        resultDiv.textContent = `❌ خطأ: ${r.error}`;
        toast(r.error, "err");
      }
    }}, "📣 إرسال لجميع المجموعات"),
  ));

  root.appendChild(card);
};

// ══════════════════════════════════════════════════════════════════════════════
// TAB: HUMAN SIMULATOR
// ══════════════════════════════════════════════════════════════════════════════
TABS.humansim = async (root) => {
  root.innerHTML = "";
  const data = await apiFetch("/humansim");
  const cfg  = data.config || {};
  const stats = data.stats || {};

  const card = el("div", { class: "card" });
  card.appendChild(el("h2", {}, "🧠 محاكاة السلوك البشري"));

  // Status indicator
  const dot = el("div", { class: data.running ? "hs-dot running" : "hs-dot" });
  card.appendChild(el("div", { class: "humansim-status" }, dot,
    el("span", { style: "font-weight:600" }, data.running ? "✅ نشط — يحاكي سلوك إنساني" : "⏸ متوقف")
  ));

  // Description
  const desc = el("div", { class: "card-section" });
  desc.appendChild(el("div", { class: "card-section-title" }, "ما هي المحاكاة البشرية؟"));
  desc.appendChild(el("p", { style: "font-size:13px;color:var(--text-dim);line-height:1.8" },
    "تجعل هذه الميزة حساب البوت يبدو لفيسبوك كمستخدم بشري حقيقي، عبر: إرسال إشارات التواجد بشكل دوري، محاكاة الكتابة في المجموعات، وقراءة المحادثات تلقائياً. هذا يقلل احتمال اكتشاف البوت وحجب الحساب."
  ));
  card.appendChild(desc);

  // Stats
  if (data.running) {
    const sc = el("div", { class: "card-section" });
    sc.appendChild(el("div", { class: "card-section-title" }, "إحصائيات الجلسة الحالية"));
    sc.appendChild(infoRow("إشارات التواجد المُرسَلة", stats.presenceSent || 0));
    sc.appendChild(infoRow("محاكاة الكتابة", stats.typingSimulated || 0));
    sc.appendChild(infoRow("المحادثات المقروءة", stats.threadsRead || 0));
    sc.appendChild(infoRow("آخر نشاط", stats.lastActionAt ? fmtDate(stats.lastActionAt) : "—"));
    sc.appendChild(infoRow("آخر نوع نشاط", stats.lastActionType || "—"));
    card.appendChild(sc);
  }

  // Config
  const cc = el("div", { class: "card-section" });
  cc.appendChild(el("div", { class: "card-section-title" }, "إعدادات المحاكاة"));

  const fields = [
    { key: "presenceIntervalMs", label: "فترة إشارة التواجد (ms)", val: cfg.presenceIntervalMs || 300000 },
    { key: "typingIntervalMs",   label: "فترة محاكاة الكتابة (ms)", val: cfg.typingIntervalMs  || 480000 },
    { key: "readIntervalMs",     label: "فترة قراءة المحادثات (ms)", val: cfg.readIntervalMs   || 180000 },
    { key: "jitterMs",           label: "التذبذب العشوائي (ms)",     val: cfg.jitterMs         || 30000  },
  ];

  const inputs = {};
  for (const f of fields) {
    const inp = el("input", { type: "number", value: f.val, min: "10000" });
    inputs[f.key] = inp;
    cc.appendChild(el("div", { class: "form-group", style: "margin-bottom:10px" }, el("label", {}, f.label), inp));
  }

  cc.appendChild(el("div", { class: "btn-row", style: "margin-top:12px" },
    el("button", { class: "btn primary", onclick: async () => {
      const body = {};
      for (const [k, inp] of Object.entries(inputs)) body[k] = parseInt(inp.value);
      body.enabled = true;
      const r = await apiPut("/humansim", body);
      if (r.success) { toast("تم حفظ إعدادات المحاكاة", "ok"); await loadTab("humansim"); }
      else toast(r.error || "فشل", "err");
    }}, "💾 حفظ الإعدادات"),
    el("button", { class: "btn ghost", onclick: async () => {
      await apiPut("/humansim", { enabled: false });
      toast("تم إيقاف المحاكاة", "warn");
      await loadTab("humansim");
    }}, "⏸ إيقاف"),
  ));

  card.appendChild(cc);
  root.appendChild(card);
};

// ══════════════════════════════════════════════════════════════════════════════
// TAB: FEATURES
// ══════════════════════════════════════════════════════════════════════════════
TABS.features = async (root) => {
  root.innerHTML = "";
  const cfg = await apiFetch("/config");
  const feats = cfg.features || {};

  const card = el("div", { class: "card" });
  card.appendChild(el("h2", {}, "🎛️ المميزات"));

  const toggles = [
    { key: "antiSpam",         label: "مكافحة الإزعاج", desc: "منع تكرار الأوامر بسرعة" },
    { key: "greetNewMembers",  label: "ترحيب بالأعضاء الجدد", desc: "إرسال رسالة ترحيب للمنضمين" },
    { key: "farewellMembers",  label: "وداع المغادرين", desc: "إرسال رسالة وداع للمغادرين" },
    { key: "logMessages",      label: "تسجيل الرسائل", desc: "تسجيل إحصائيات الرسائل" },
    { key: "autoSaveAppState", label: "حفظ الجلسة تلقائياً", desc: "حفظ ورفع الكوكيز كل 15 دقيقة" },
  ];

  const state = { ...feats };
  for (const t of toggles) {
    const tog = el("label", { class: "toggle" });
    const inp = el("input", { type: "checkbox" });
    if (state[t.key]) inp.checked = true;
    inp.addEventListener("change", () => { state[t.key] = inp.checked; });
    tog.appendChild(inp);
    tog.appendChild(el("span", { class: "toggle-slider" }));

    const row = el("div", { class: "toggle-row" },
      el("div", {},
        el("div", { class: "toggle-label" }, t.label),
        el("div", { class: "toggle-desc" }, t.desc),
      ),
      tog,
    );
    card.appendChild(row);
  }

  // Cooldown
  const cdWrap = el("div", { class: "form-group", style: "margin-top:16px" });
  cdWrap.appendChild(el("label", {}, "مهلة مكافحة الإزعاج (ms)"));
  const cdInp = el("input", { type: "number", value: feats.antiSpamCooldownMs || 3000, min: "500" });
  cdWrap.appendChild(cdInp);
  card.appendChild(cdWrap);

  card.appendChild(el("div", { class: "btn-row", style: "margin-top:16px" },
    el("button", { class: "btn primary", onclick: async () => {
      state.antiSpamCooldownMs = parseInt(cdInp.value) || 3000;
      const r = await apiPut("/config/features", state);
      if (r.success) toast("تم حفظ المميزات", "ok");
      else toast(r.error || "فشل", "err");
    }}, "💾 حفظ"),
  ));

  root.appendChild(card);
};

// ══════════════════════════════════════════════════════════════════════════════
// TAB: COOKIES / SESSION
// ══════════════════════════════════════════════════════════════════════════════
TABS.cookies = async (root) => {
  root.innerHTML = "";
  const info = await apiFetch("/appstate/info");

  const card = el("div", { class: "card" });
  card.appendChild(el("h2", {}, "🍪 إدارة الجلسة (AppState)"));

  // Current info
  const cs = el("div", { class: "card-section" });
  cs.appendChild(el("div", { class: "card-section-title" }, "الجلسة الحالية"));
  cs.appendChild(infoRow("الحالة", info.exists ? "✅ موجودة" : "❌ مفقودة"));
  cs.appendChild(infoRow("عدد الكوكيز", info.cookieCount || 0));
  cs.appendChild(infoRow("الحجم", info.sizeBytes ? `${(info.sizeBytes/1024).toFixed(1)} KB` : "—"));
  cs.appendChild(infoRow("آخر تعديل", info.modifiedAt ? fmtDate(info.modifiedAt) : "—"));
  card.appendChild(cs);

  // Upload
  const uc = el("div", { class: "card-section" });
  uc.appendChild(el("div", { class: "card-section-title" }, "رفع جلسة جديدة"));
  uc.appendChild(el("p", { style: "font-size:12px;color:var(--text-dim);margin-bottom:12px" },
    "الصق محتوى ملف appstate.json هنا. سيتم التحقق من صحته ورفعه إلى GitHub تلقائياً."
  ));
  const area = el("textarea", { placeholder: '[{"key":"c_user","value":"…",…}]', style: "min-height:160px" });
  uc.appendChild(area);

  const resultDiv = el("div", { style: "margin-top:8px;font-size:13px;min-height:20px" });
  uc.appendChild(resultDiv);

  uc.appendChild(el("div", { class: "btn-row", style: "margin-top:12px" },
    el("button", { class: "btn primary", onclick: async () => {
      const content = area.value.trim();
      if (!content) { toast("الصق محتوى الجلسة أولاً", "warn"); return; }
      try {
        const r = await apiPost("/appstate/upload", { content: JSON.parse(content) });
        if (r.success) {
          resultDiv.textContent = `✅ تم رفع ${r.cookieCount} كوكي بنجاح`;
          toast("تم رفع الجلسة ودفعها إلى GitHub", "ok");
        } else {
          resultDiv.textContent = `❌ ${r.error}`;
          toast(r.error, "err");
        }
      } catch (e) {
        resultDiv.textContent = `❌ JSON غير صحيح: ${e.message}`;
        toast("JSON غير صحيح", "err");
      }
    }}, "⬆️ رفع الجلسة"),
  ));
  card.appendChild(uc);
  root.appendChild(card);
};

// ══════════════════════════════════════════════════════════════════════════════
// TAB: ACTIVITY LOG
// ══════════════════════════════════════════════════════════════════════════════
TABS.activity = async (root) => {
  root.innerHTML = "";
  const entries = await apiFetch("/activity");

  const card = el("div", { class: "card" });
  card.appendChild(el("h2", {}, "📋 سجل النشاط"));

  const log = el("div", { class: "log-stream" });
  if (!entries.length) log.appendChild(el("div", { class: "log-line DEFAULT" }, "لا يوجد نشاط"));
  for (const e of entries) {
    log.appendChild(el("div", { class: "log-line OK" }, `[${fmtTime(e.time)}] ${e.message}`));
  }
  card.appendChild(log);

  const unsub = subscribeSSE(msg => {
    if (msg.type === "activity") {
      const line = el("div", { class: "log-line OK" }, `[${fmtTime(msg.data.time)}] ${msg.data.message}`);
      log.insertBefore(line, log.firstChild);
    }
  });
  root._cleanup = unsub;
  root.appendChild(card);
};

// ══════════════════════════════════════════════════════════════════════════════
// TAB: VIOLATIONS
// ══════════════════════════════════════════════════════════════════════════════
TABS.violations = async (root) => {
  root.innerHTML = "";
  const entries = await apiFetch("/violations");

  const card = el("div", { class: "card" });
  card.appendChild(el("h2", {}, `🛡️ المخالفات (${entries.length})`));

  if (!entries.length) {
    card.appendChild(el("div", { class: "empty" },
      el("div", { class: "empty-icon" }, "🛡️"),
      "لا توجد مخالفات مسجلة",
    ));
    root.appendChild(card);
    return;
  }

  const tbl = el("table", { class: "tbl" });
  tbl.appendChild(el("thead", {}, el("tr", {},
    el("th", {}, "الوقت"), el("th", {}, "المجموعة"), el("th", {}, "المُرسِل"), el("th", {}, "معاينة الرسالة")
  )));
  const tbody = el("tbody");
  for (const v of entries) {
    tbody.appendChild(el("tr", {},
      el("td", { style: "font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text-dim)" }, fmtTime(v.time)),
      el("td", { style: "font-size:12px" }, v.threadName || v.threadID),
      el("td", { style: "font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--cyan)" }, v.senderID),
      el("td", { style: "font-size:12px;color:var(--text-dim)" }, v.messagePreview || "—"),
    ));
  }
  tbl.appendChild(tbody);
  card.appendChild(tbl);
  root.appendChild(card);
};

// ══════════════════════════════════════════════════════════════════════════════
// TAB: DIAGNOSTICS
// ══════════════════════════════════════════════════════════════════════════════
TABS.diagnostics = async (root) => {
  root.innerHTML = "";
  const diag = await apiFetch("/diagnostics");
  const hs   = await apiFetch("/health");

  const card = el("div", { class: "card" });
  card.appendChild(el("h2", {}, "🔍 التشخيص والأداء"));

  card.appendChild(el("div", { class: "grid cols-3", style: "margin-bottom:16px" },
    statCard("الذاكرة", hs.memMB ? fmtMem(hs.memMB) : "—", "RSS"),
    statCard("CPU", hs.cpuPct !== undefined ? `${hs.cpuPct}%` : "—", "نسبة المعالج"),
    statCard("تأخير الحلقة", hs.loopLagMs !== undefined ? `${hs.loopLagMs.toFixed(0)}ms` : "—", "event loop lag"),
  ));

  if (diag.errors && diag.errors.length > 0) {
    const ec = el("div", { class: "card-section" });
    ec.appendChild(el("div", { class: "card-section-title" }, `الأخطاء الأخيرة (${diag.errors.length})`));
    const log = el("div", { class: "log-stream", style: "max-height:300px" });
    for (const e of diag.errors.slice(-20)) {
      log.appendChild(el("div", { class: "log-line ERROR" }, `[${fmtTime(e.time)}] [${e.source}] ${e.message}`));
    }
    ec.appendChild(log);
    card.appendChild(ec);
  } else {
    card.appendChild(el("div", { class: "card-section" },
      el("div", { class: "card-section-title" }, "الأخطاء"),
      el("p", { style: "color:var(--ok);font-size:13px" }, "✅ لا توجد أخطاء مسجلة")
    ));
  }

  card.appendChild(el("div", { class: "btn-row", style: "margin-top:16px" },
    el("button", { class: "btn ghost", onclick: async () => {
      const r = await apiPost("/diagnostics/snapshot");
      if (r.success) toast(`تم إنشاء Snapshot: ${r.file || "ok"}`, "ok");
      else toast("فشل", "err");
    }}, "📸 إنشاء Snapshot"),
    el("button", { class: "btn danger", onclick: async () => {
      if (!confirm("هل تريد إعادة تشغيل البوت؟")) return;
      const r = await apiPost("/restart");
      if (r.success) toast("جاري إعادة التشغيل…", "warn");
      else toast("فشل", "err");
    }}, "🔄 إعادة تشغيل البوت"),
  ));

  root.appendChild(card);
};

// ── Helper builders ───────────────────────────────────────────────────────────
function statCard(label, value, sub) {
  return el("div", { class: "stat" },
    el("div", { class: "label" }, label),
    el("div", { class: "value" }, String(value)),
    sub ? el("div", { class: "sub" }, sub) : null,
  );
}

function infoRow(label, value) {
  return el("div", { class: "info-row" },
    el("span", { class: "info-label" }, label),
    el("span", { class: "info-value" }, String(value)),
  );
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  if (_token) {
    // Verify token is still valid
    try {
      await apiFetch("/health");
      showApp();
    } catch {
      showLogin();
    }
  } else {
    showLogin();
  }
}

boot();
