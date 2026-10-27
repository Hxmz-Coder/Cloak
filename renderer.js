const $ = (id) => document.getElementById(id);
const body = document.body, log = $("log"), input = $("input");

let mode = "pill";
let shortcuts = [];
let pendingShot = null;
let busy = false;
let pinned = false;
let capturing = false;
let editingId = null;
let collapseTimer = null;
let awayTimer = null;

// ---------- helpers ----------
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
// Tiny markdown: code fences, inline code, bold, italics.
function md(s) {
  return String(s).split(/```(?:\w+)?\n?/).map((p, i) => {
    if (i % 2) return `<pre><code>${esc(p)}</code></pre>`;
    return esc(p)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, "$1<i>$2</i>");
  }).join("").replace(/\n+(<pre>)/g, "$1").replace(/(<\/pre>)\n+/g, "$1");
}
const hasChat = () => log.children.length > 0;
const THINKING = '<span class="thinking">thinking<span>.</span><span>.</span><span>.</span></span>';

// ---------- widget states: pill -> bar (hover) -> chat / edit ----------
function setMode(m) {
  if (m === "pill" && nCur) m = "notify"; // a notification is showing: the pill stays grown until it's done
  if (m === mode) return;
  mode = m;
  body.dataset.mode = m;
  sendSize();
  if (m === "chat") log.scrollTop = log.scrollHeight;
  updateStatus();
}
let lastSize = "";
function sendSize() {
  lastSize = "";
  requestAnimationFrame(fit);
}
// Pill: only as wide as what it shows. Bar: header + one row of shortcuts. Chat/edit: fixed sizes.
function fit() {
  let size;
  if (mode === "pill") size = body.classList.contains("dot-style") ? 58 : Math.ceil($("pillInfo").getBoundingClientRect().width) + 64;
  else if (mode === "notify") size = $("island").offsetHeight + 16;
  else if (mode === "bar") size = 44 + $("tiles").offsetHeight + (body.classList.contains("has-shot") ? 42 : 0) + 16;
  const key = `${mode}:${size}`;
  if (key !== lastSize) { lastSize = key; window.overlay.setMode(mode, size); }
}
window.addEventListener("resize", () => requestAnimationFrame(fit));

function expand() {
  clearTimeout(collapseTimer);
  // If there's a conversation, show it straight away.
  if (mode === "pill") setMode(hasChat() ? "chat" : "bar");
}
function collapse() {
  if (pinned || mode === "edit" || mode === "notify" || capturing) return;
  if (input.value.trim() && document.activeElement === input) return; // don't lose a half-typed question
  setMode("pill");
}
function hoverCollapse() {
  // While you're typing in the widget, only clicking elsewhere (blur) tucks it away.
  if (document.hasFocus() && (document.activeElement === input || (mode === "chat" && busy))) return;
  collapse();
}
function openAndFocus(m) {
  setMode(m);
  window.overlay.focus();
  setTimeout(() => input.focus(), 30);
}

$("shell").addEventListener("mouseenter", expand);
$("shell").addEventListener("click", () => { if (mode === "pill") expand(); });
document.documentElement.addEventListener("mouseleave", () => {
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(hoverCollapse, 450);
});
document.documentElement.addEventListener("mouseenter", () => clearTimeout(collapseTimer));
window.overlay.onBlur(() => collapse());
// The show/hide shortcut opens the bar (with the panels); pressing it again puts everything away.
window.overlay.onOpenBar(() => openAndFocus(hasChat() ? "chat" : "bar"));
window.overlay.onCollapse(() => { setPinned(false); setMode("pill"); });

// ---------- what the pill shows (customizable in Settings > Top widget) ----------
let pillCfg = { label: "Claude", style: "island" };
let taskCache = [];
let widgetStatus = {}; // custom widget id -> short status text it published

const fmtTime = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
function pillExtrasHtml(cfg) {
  const open = taskCache.filter((t) => !t.done);
  const parts = [];
  if (cfg.nextTask && open.length) {
    // soonest due date (and time) first, then oldest
    const key = (t) => (t.due || "9999") + (t.time || "99:99");
    const next = [...open].sort((a, b) => key(a).localeCompare(key(b)) || a.created - b.created)[0];
    parts.push(`<span class="next">${esc(next.title)}${next.time ? ` · ${fmtTime(next.time)}` : ""}</span>`);
  }
  for (const id of cfg.widgets || []) if (widgetStatus[id]) parts.push(`<span class="next">${esc(widgetStatus[id])}</span>`);
  if (cfg.taskCount) parts.push(`<span>${open.length} task${open.length === 1 ? "" : "s"}</span>`);
  if (cfg.date) parts.push(`<span>${new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</span>`);
  if (cfg.clock) parts.push(`<span>${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>`);
  return parts.join('<span style="opacity:.4">·</span>');
}
// The pill shows exactly what you chose in Settings > Top widget, nothing else. Anything that needs your
// attention (answers, deadlines, new tasks, widget alerts) is a notification instead (see below).
function updateStatus() {
  const s = $("status");
  body.classList.toggle("dot-style", pillCfg.style === "dot");
  s.innerHTML = esc(pillCfg.label ?? "Claude");
  $("pillExtra").innerHTML = pillExtrasHtml(pillCfg);
  $("pillMode").textContent = pillCfg.showMode !== false && activeModeInfo.id !== "general" ? activeModeInfo.name : "";
  $("pillInfo").classList.toggle("blank", !s.innerHTML && !$("pillExtra").innerHTML && !$("pillMode").textContent);
  if (mode === "pill") requestAnimationFrame(fit);
}
setInterval(updateStatus, 15_000); // keeps the time and date current

// ---------- modes ----------
let activeModeInfo = { id: "general", name: "General" };
function showMode(m) {
  activeModeInfo = { id: m.id, name: m.name };
  $("modeName").textContent = m.name;
  if (m.shortcuts) { shortcuts = m.shortcuts; renderTiles(); }
  updateStatus();
}
window.overlay.onModeChanged(showMode);
$("modeBtn").onclick = () => window.overlay.modesMenu();

window.overlay.onTasksChanged((list) => { taskCache = list; updateStatus(); });
window.overlay.onWidgetStatus(({ id, text }) => { widgetStatus[id] = text; updateStatus(); });

// Settings: the sliders button. Right-click the small widget to switch modes (the menu also has Settings).
$("settingsBtn").onclick = () => window.overlay.openSettings();
$("shell").addEventListener("contextmenu", (e) => { if (mode === "pill") { e.preventDefault(); window.overlay.modesMenu(); } });
window.overlay.onPillChanged((p) => { pillCfg = p; updateStatus(); sendSize(); });
window.overlay.onShortcutsChanged((list) => { shortcuts = list; renderTiles(); });

// After you've been away, highlight "What did I just do?" in the bar for a while (the pill doesn't change).
window.overlay.onWelcomeBack(() => {
  body.classList.add("away");
  document.querySelector('.tile[data-action="recap"]')?.classList.add("suggest");
  clearTimeout(awayTimer);
  awayTimer = setTimeout(clearAway, 10 * 60_000);
});
function clearAway() {
  body.classList.remove("away");
  document.querySelectorAll(".tile.suggest").forEach((t) => t.classList.remove("suggest"));
}

// ---------- widget buttons (Tasks, Notes, and widgets Claude built) ----------
const ICONS = {
  tasks: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/></svg>',
  notes: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h5"/></svg>',
  listen: '<svg viewBox="0 0 24 24"><path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 11v2"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7h6l2 2h10v10H3z"/></svg>',
  all: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>',
};
const MAX_DIRECT = 3; // more widgets than this: the rest go in the folder
function renderWidgetButtons(panels) {
  const box = $("wbtns");
  box.innerHTML = "";
  const direct = panels.length > MAX_DIRECT + 1 ? panels.slice(0, MAX_DIRECT) : panels;
  for (const p of direct) {
    const b = document.createElement("button");
    b.className = `icon-btn wb${p.visible ? " on" : ""}${p.active ? " rec" : ""}`;
    b.title = p.label;
    b.innerHTML = ICONS[p.name] || `<span class="letter">${esc(p.label.trim().charAt(0).toUpperCase())}</span>`;
    b.onclick = () => window.overlay.togglePanel(p.name);
    box.appendChild(b);
  }
  if (direct.length < panels.length) {
    const f = document.createElement("button");
    f.className = `icon-btn wb${panels.slice(MAX_DIRECT).some((p) => p.visible) ? " on" : ""}`;
    f.title = `${panels.length - direct.length} more widgets`;
    f.innerHTML = ICONS.folder;
    f.onclick = () => window.overlay.widgetsMenu();
    box.appendChild(f);
  }
  const all = document.createElement("button");
  all.className = "icon-btn";
  all.title = panels.some((p) => p.visible) ? "Hide all widgets" : "Open all widgets";
  all.innerHTML = ICONS.all;
  all.onclick = () => window.overlay.toggleAllPanels();
  box.appendChild(all);
}
window.overlay.onPanelsChanged(renderWidgetButtons);

// ---------- chat ----------
function add(cls, html) {
  const el = document.createElement("div");
  el.className = `msg ${cls}`;
  el.innerHTML = html;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}
function setShot(b64) {
  pendingShot = b64;
  body.classList.toggle("has-shot", !!b64);
  if (b64) $("attachImg").src = `data:image/png;base64,${b64}`;
  if (mode === "bar") sendSize();
}
function setBusy(b) {
  busy = b;
  body.classList.toggle("busy", b);
  updateStatus();
}

// The reply being written right now: text streams in, and a line under it says what Claude is doing.
let live = null; // { el, text }
window.overlay.onChatEvent((ev) => {
  if (!live) return;
  if (ev.type === "text") {
    live.text += ev.text;
    live.activity = "";
  } else if (ev.type === "tool") {
    live.activity = `${ev.label}…`;
  } else if (ev.type === "message" && live.text && !live.text.endsWith("\n")) {
    live.text += "\n\n"; // a new step after a tool: keep earlier text, start a new paragraph
  }
  live.el.innerHTML = (live.text ? md(live.text) : THINKING) + `<span class="activity">${esc(live.activity || "")}</span>`;
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  if (nearBottom) log.scrollTop = log.scrollHeight;
});

// Runs one turn: shows your message (if any), Claude's reply as it streams, then the final reply.
async function turn(userHtml, call) {
  if (busy) return;
  setMode("chat");
  if (userHtml) add("user", userHtml);
  const el = add("bot", THINKING);
  live = { el, text: "", activity: "" };
  setBusy(true);
  const res = await call();
  live = null;
  setBusy(false);
  showReply(el, res);
  const watching = mode === "chat" && document.hasFocus();
  if (res.ok && !res.stopped) window.overlay.chatFinished({ watching, text: res.text, approvals: res.approvals?.length || 0 });
}

function showReply(el, res) {
  if (!res.ok) { el.innerHTML = `<span class="err">${md(res.error)}</span>`; return; }
  if (res.stopped) { el.innerHTML = el.querySelector(".activity") ? el.innerHTML.replace(/<span class="activity">.*<\/span>$/, "") + "<br><i>stopped</i>" : "<i>stopped</i>"; return; }
  el.innerHTML = md(res.text || (res.approvals?.length ? "I need your OK before I go on." : "Done."));
  const meta = document.createElement("div");
  meta.className = "meta";
  const copy = document.createElement("button");
  copy.textContent = "Copy";
  copy.onclick = () => { window.overlay.writeClipboard(res.text || ""); copy.textContent = "Copied"; };
  meta.appendChild(copy);
  if (res.tasksAdded?.length) {
    const t = document.createElement("span");
    t.className = "added";
    t.textContent = `Added ${res.tasksAdded.length} task${res.tasksAdded.length > 1 ? "s" : ""} to your list`;
    meta.appendChild(t);
  }
  if (res.remembered?.length) {
    const r = document.createElement("span");
    r.className = "added";
    r.textContent = `Remembered: ${res.remembered.join(" · ")}`;
    r.title = "See or change what it remembers in Settings > Memory";
    meta.appendChild(r);
  }
  el.appendChild(meta);
  if (res.approvals?.length) showApprovals(res.approvals);
  log.scrollTop = log.scrollHeight;
}

// Card listing actions Claude was blocked from taking, with Allow / Decline.
function showApprovals(list) {
  const card = document.createElement("div");
  card.className = "approve";
  card.innerHTML = `<h4>Claude wants to do ${list.length > 1 ? "these" : "this"}</h4>` + list.map((a) => `
    <div class="item" data-id="${esc(a.id)}">
      <b>${esc(a.title)}</b><code>${esc(a.detail)}</code>
      ${a.alwaysLabel ? `<label><input type="checkbox" class="always" /> ${esc(a.alwaysLabel.replace(/`/g, ""))}</label>` : ""}
    </div>`).join("") +
    `<div class="row"><button class="btn primary allow">Allow</button><button class="btn decline">Decline</button></div>`;
  log.appendChild(card);
  log.scrollTop = log.scrollHeight;
  const ids = list.map((a) => a.id);
  card.querySelector(".allow").onclick = () => {
    const always = [...card.querySelectorAll(".item")].filter((i) => i.querySelector(".always")?.checked).map((i) => i.dataset.id);
    card.classList.add("resolved");
    card.querySelector("h4").textContent = "Allowed";
    turn(null, () => window.overlay.approve({ ids, always }));
  };
  card.querySelector(".decline").onclick = () => {
    card.classList.add("resolved");
    card.querySelector("h4").textContent = "Declined";
    window.overlay.decline({ ids });
  };
}

async function submit(textOverride, image) {
  if (busy) { window.overlay.stop(); return; }
  const text = (textOverride ?? input.value).trim();
  const shot = image ?? pendingShot;
  if (!text && !shot) return;
  if (text && !textOverride) lastSent = text;
  input.value = ""; setShot(null);
  const userHtml = (shot ? `<img class="shot" src="data:image/png;base64,${shot}" />` : "") + esc(text || "What's on my screen?");
  await turn(userHtml, () => window.overlay.ask({ text, image: shot }));
}

async function recap() {
  clearAway();
  window.overlay.focus();
  await turn(esc("What did I just do?"), () => window.overlay.recap());
}

async function findTasks() {
  window.overlay.focus();
  await turn(esc("Find tasks from what I've been doing"), async () => {
    const r = await window.overlay.scanTasks();
    if (r.error) return { ok: false, error: r.error };
    return { ok: true, text: r.added.length
      ? `Added ${r.added.length} task${r.added.length > 1 ? "s" : ""}:\n${r.added.map((t) => `- ${t}`).join("\n")}`
      : "I didn't spot anything new that needs doing." };
  });
}

window.overlay.onRunPrompt((text) => { openAndFocus("chat"); submit(text); });
window.overlay.onOpenChat(() => openAndFocus("chat"));
// Claude or ChatGPT (Settings > General). Switching starts a new chat.
function setAiName(name) { input.placeholder = `Ask ${name || "Claude"}, or tell it what to do…`; }
window.overlay.onAiChanged((name) => { setAiName(name); log.innerHTML = ""; });

// ---------- notifications ----------
// Main sends them (deadlines, check-ins, answers, widget alerts...). One at a time: the pill grows into a card,
// or, while the chat bar is open, a banner drops in over its top row. Click opens where it came from.
const N_ICONS = {
  deadline: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>',
  checkin: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L19 7"/></svg>',
  digest: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  answer: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  approval: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4v5c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V7z"/><path d="M12 9v4M12 16.5v.5"/></svg>',
  found: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/></svg>',
  widget: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/></svg>',
  listen: '<svg viewBox="0 0 24 24"><path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 11v2"/></svg>',
  built: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><path d="M17 13v8M13 17h8"/></svg>',
};
const nQueue = [];
let nCur = null, nTimer = null, nLeft = 0, nStarted = 0;
const nDuration = (n) => (n.kind === "listen" ? 20_000 : n.sticky ? 25_000 : n.urgent ? 10_000 : 7_000);

window.overlay.onNotify((n) => {
  // A newer one about the same thing (e.g. another answer) replaces the waiting one.
  const same = nQueue.findIndex((q) => q.kind === n.kind && q.title === n.title);
  if (same >= 0) { window.overlay.notifyDismiss(nQueue[same].id); nQueue.splice(same, 1); }
  nQueue.push(n);
  if (!nCur) nextNotification(); else $("nMore").textContent = `+${nQueue.length}`;
});

function nextNotification() {
  clearTimeout(nTimer);
  nCur = nQueue.shift() || null;
  if (!nCur) {
    body.classList.remove("notifying", "urgent");
    if (mode === "notify") setMode("pill");
    window.overlay.notifyIdle();
    return;
  }
  const isl = $("island");
  isl.dataset.kind = nCur.kind;
  $("nIcon").innerHTML = N_ICONS[nCur.kind] || N_ICONS.widget;
  $("nTitle").textContent = nCur.title;
  $("nBody").textContent = nCur.body || "";
  $("nMore").textContent = nQueue.length ? `+${nQueue.length}` : "";
  $("nActions").innerHTML = (nCur.actions || []).map((a, i) => `<button class="btn${i ? "" : " primary"}" data-act="${esc(a.id)}">${esc(a.label)}</button>`).join("");
  // restart the entrance animation and the countdown bar
  body.classList.remove("notifying", "urgent");
  void isl.offsetWidth;
  body.classList.add("notifying");
  body.classList.toggle("urgent", !!nCur.urgent);
  nLeft = nDuration(nCur);
  const bar = $("nBar");
  bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = ""; bar.style.animationDuration = `${nLeft}ms`;
  if (mode === "pill") setMode("notify"); else sendSize();
  if (nCur.sound) chime(nCur.urgent);
  runTimer();
}
function runTimer() { clearTimeout(nTimer); nStarted = Date.now(); nTimer = setTimeout(() => finish("timeout"), nLeft); }
function finish(how, action) {
  if (!nCur) return;
  if (how === "open") window.overlay.notifyOpen(nCur.id);
  else if (how === "action") window.overlay.notifyAction(nCur.id, action);
  else window.overlay.notifyDismiss(nCur.id);
  nextNotification();
}
// Hovering pauses it, so it doesn't vanish while you read.
$("island").addEventListener("mouseenter", () => { clearTimeout(nTimer); nLeft -= Date.now() - nStarted; });
$("island").addEventListener("mouseleave", () => { if (nCur) { nLeft = Math.max(nLeft, 2500); runTimer(); } });
$("island").addEventListener("click", (e) => {
  e.stopPropagation();
  if (e.target.closest("#nClose")) return finish("dismiss");
  const act = e.target.closest("[data-act]");
  if (act) return finish("action", act.dataset.act);
  finish("open");
});

// A short two-note chime (Settings > Notifications can turn it off).
let audio = null;
function chime(urgent) {
  try {
    audio ||= new AudioContext();
    const t = audio.currentTime;
    (urgent ? [880, 1175, 1568] : [988, 1319]).forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.12);
      g.gain.linearRampToValueAtTime(0.07, t + i * 0.12 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.45);
      o.connect(g).connect(audio.destination);
      o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.5);
    });
  } catch {}
}

async function capture() {
  capturing = true;
  try { return await window.overlay.capture(); } finally { capturing = false; }
}

let lastSent = "";
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  // Up in an empty box: your last message back, to fix or send again.
  if (e.key === "ArrowUp" && !input.value && lastSent) { e.preventDefault(); input.value = lastSent; }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (mode === "edit") closeEditor();
  else { setPinned(false); setMode("pill"); }
});
function setPinned(p) { pinned = p; $("pinBtn").classList.toggle("on", p); }
$("send").onclick = () => submit();
$("shotBtn").onclick = async () => { const s = await capture(); if (s) setShot(s); openAndFocus(mode === "pill" ? "bar" : mode); };
$("hideBtn").onclick = () => { setPinned(false); setMode("pill"); window.overlay.hideWidget(); };
$("clearShot").onclick = () => setShot(null);
$("pinBtn").onclick = () => setPinned(!pinned);
// New chat: the + in the header, or the link above the conversation.
async function newChat() {
  if (busy) return;
  await window.overlay.reset();
  log.innerHTML = "";
  setMode("bar");
  input.focus();
}
$("newChat").onclick = newChat;
$("newChatBtn").onclick = newChat;
window.overlay.onTriggerCapture(async () => {
  const s = await capture();
  if (s) setShot(s);
  openAndFocus(hasChat() ? "chat" : "bar");
});

// ---------- shortcut buttons: one line; the mouse wheel scrolls it sideways ----------
function tileKind(sc) {
  if (sc.action === "recap") return "memory";
  if (sc.action === "scan") return "tasks";
  if (sc.screenshot) return "screen";
  if ((sc.prompt || "").includes("{clipboard}")) return "clip";
  return "";
}
const tilesBox = $("tiles");
tilesBox.addEventListener("wheel", (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { tilesBox.scrollLeft += e.deltaY; e.preventDefault(); }
}, { passive: false });
const markEnd = () => tilesBox.classList.toggle("at-end", tilesBox.scrollLeft + tilesBox.clientWidth >= tilesBox.scrollWidth - 4);
tilesBox.addEventListener("scroll", markEnd);
function renderTiles() {
  tilesBox.innerHTML = "";
  for (const sc of shortcuts) {
    const b = document.createElement("button");
    b.className = `tile ${tileKind(sc)}`;
    if (sc.action) b.dataset.action = sc.action;
    b.title = (sc.action ? "" : sc.prompt + "\n\n") + "Right-click to edit";
    b.innerHTML = `<i></i>${esc(sc.label)}`;
    b.onclick = () => runShortcut(sc);
    b.oncontextmenu = (e) => { e.preventDefault(); if (!sc.action) openEditor(sc); };
    tilesBox.appendChild(b);
  }
  const addBtn = document.createElement("button");
  addBtn.className = "tile add";
  addBtn.textContent = "+ Add";
  addBtn.title = "Add a shortcut button";
  addBtn.onclick = () => openEditor(null);
  tilesBox.appendChild(addBtn);
  if (body.classList.contains("away")) tilesBox.querySelector('[data-action="recap"]')?.classList.add("suggest");
  requestAnimationFrame(markEnd);
  sendSize();
}

async function runShortcut(sc) {
  if (sc.action === "recap") return recap();
  if (sc.action === "scan") return findTasks();
  let prompt = sc.prompt;
  if (prompt.includes("{clipboard}")) prompt = prompt.replaceAll("{clipboard}", await window.overlay.readClipboard());
  const shot = sc.screenshot ? await capture() : null;
  if (sc.autoSend === false) {
    input.value = prompt;
    if (shot) setShot(shot);
    openAndFocus(hasChat() ? "chat" : "bar");
    return;
  }
  window.overlay.focus();
  submit(prompt, shot);
}

function openEditor(sc) {
  editingId = sc ? sc.id : null;
  $("edTitle").textContent = sc ? "Edit shortcut" : "New shortcut";
  $("edLabel").value = sc?.label || "";
  $("edPrompt").value = sc?.prompt || "";
  $("edShot").checked = !!sc?.screenshot;
  $("edAuto").checked = sc ? sc.autoSend !== false : true;
  $("edDelete").style.display = sc ? "" : "none";
  setMode("edit");
  window.overlay.focus();
  setTimeout(() => $("edLabel").focus(), 30);
}
function closeEditor() { editingId = null; setMode(hasChat() ? "chat" : "bar"); }

$("edSave").onclick = async () => {
  const label = $("edLabel").value.trim(), prompt = $("edPrompt").value.trim();
  if (!label || !prompt) { (label ? $("edPrompt") : $("edLabel")).focus(); return; }
  const data = { label, prompt, screenshot: $("edShot").checked, autoSend: $("edAuto").checked };
  if (editingId) shortcuts = shortcuts.map((s) => (s.id === editingId ? { ...s, ...data } : s));
  else {
    // keep "Find tasks" last
    const scanAt = shortcuts.findIndex((s) => s.action === "scan");
    const item = { id: "w" + Date.now(), ...data };
    if (scanAt >= 0) shortcuts.splice(scanAt, 0, item); else shortcuts.push(item);
  }
  await window.overlay.setShortcuts(shortcuts);
  renderTiles();
  closeEditor();
};
$("edCancel").onclick = closeEditor;
$("edDelete").onclick = async () => {
  shortcuts = shortcuts.filter((s) => s.id !== editingId);
  await window.overlay.setShortcuts(shortcuts);
  renderTiles();
  closeEditor();
};
$("edReset").onclick = async () => {
  shortcuts = await window.overlay.resetShortcuts();
  renderTiles();
  closeEditor();
};

// ---------- startup ----------
(async () => {
  const cfg = await window.overlay.getConfig();
  shortcuts = cfg.shortcuts;
  activeModeInfo = cfg.mode || activeModeInfo;
  $("modeName").textContent = activeModeInfo.name;
  pillCfg = cfg.pill;
  setAiName(cfg.aiName);
  widgetStatus = cfg.widgetStatus || {};
  taskCache = await window.overlay.listTasks();
  // Bring back the conversation from last time.
  for (const m of await window.overlay.chatHistory()) {
    if (m.role === "user") { add("user", (m.image ? '<span class="tag-shot">screenshot</span>' : "") + esc(m.text)); lastSent = m.text; }
    else add("bot", md(m.text));
  }
  renderTiles();
  renderWidgetButtons(cfg.panels || []);
  updateStatus();
})();
