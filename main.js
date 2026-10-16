const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, screen, Tray, Menu, nativeImage, clipboard, protocol, session, net } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("url");
const { runClaude, killProc, friendlyError } = require("./lib/claude");
const { TOOLS, AUTO_ALLOWED, describeDenial } = require("./lib/permissions");
const { ScreenMemory } = require("./lib/memory");
const { TaskStore, extractTaskBlocks, scanSchema } = require("./lib/tasks");
const { WidgetStore, BUILD_SCHEMA, buildPrompt, checkJs } = require("./lib/widgets");

// Custom widgets load from overlay://app/... (shared frame files) and overlay://widget/<id>/index.html.
protocol.registerSchemesAsPrivileged([{ scheme: "overlay", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const SYSTEM = `You are Claude, running on the user's Windows PC from a small widget at the top of their screen.

Work autonomously. When a request takes several steps, carry them all out without stopping to check in: read files, search, look things up, and keep going until it's done. Don't ask "should I continue?" for routine steps.

Some actions need the user's approval: shell commands that change things, creating or editing files, and opening web pages. When one of these is denied, that is expected: the widget automatically shows the user an Allow button for exactly that action, and if they allow it you'll be asked to retry. So finish everything else you can, then say in one short line what you're waiting on (e.g. "Waiting for your OK to create notes.txt."). Don't explain permission settings, don't suggest starting a new session or running it themselves, and never try to get around a block another way.

Screenshots: when the user's message lists screenshot paths, open them with the Read tool before answering.

Task list: the user has a task list widget. To add tasks to it, put a fenced code block with the language "tasks" in your reply, one task per line as "category | title | due", where category is homework, email, unfinished or other, and due is an optional YYYY-MM-DD date. The widget removes the block and adds the tasks. Add tasks when the user asks, or when you notice something they clearly need to do later. Don't add duplicates of their open tasks.

Notes: the user keeps personal notes in a notes widget. They are the user's own writing; you only see them when they're included in a message. Never rewrite or "submit" them.

Style: concise and direct. Use short markdown (bullets, code blocks) when it helps.`;

// Main widget sizes (include a little transparent margin for the shadow). The pill's width follows its content.
const WIDGET = { pill: [160, 58], bar: [680, 150], chat: [680, 620], edit: [680, 400] };

// Panels: hidden until Ctrl+Shift+Space, movable and resizable, reopen where you left them.
// Custom widgets Claude builds become panels too. Settings is a panel that only opens when you ask.
const PANELS = {
  tasks: { file: "tasks.html", size: [360, 440], min: [260, 200], label: "Tasks" },
  notes: { file: "notes.html", size: [380, 460], min: [260, 200], label: "Notes" },
  settings: { file: "settings.html", size: [800, 600], min: [620, 420], label: "Settings", standalone: true },
};
const DEFAULT_THEME = { accent: "#d97757", opacity: 0.95 };
const DEFAULT_HOTKEYS = { toggle: "CommandOrControl+Shift+Space", capture: "CommandOrControl+Shift+S" };

const DEFAULT_SHORTCUTS = [
  { id: "recap", label: "What did I just do?", action: "recap" },
  { id: "explain", label: "Explain my screen", prompt: "Explain what's on my screen.", screenshot: true, autoSend: true },
  { id: "answer", label: "Answer this", prompt: "Answer the question shown on my screen. Give the answer first, then a short explanation of why.", screenshot: true, autoSend: true },
  { id: "summarize", label: "Summarize", prompt: "Summarize what's on my screen in 3-5 bullets.", screenshot: true, autoSend: true },
  { id: "fix", label: "Fix my writing", prompt: "Fix the grammar and improve the clarity of this text. Return only the improved text:\n\n{clipboard}", screenshot: false, autoSend: true },
  { id: "translate", label: "Translate", prompt: "Translate this to English (or to Spanish if it's already English):\n\n{clipboard}", screenshot: false, autoSend: true },
  { id: "code", label: "Explain code", prompt: "Explain this code clearly and point out any bugs:\n\n{clipboard}", screenshot: false, autoSend: true },
  { id: "scan", label: "Find tasks", action: "scan" },
];
const DEFAULT_PILL = { label: "Claude", clock: false, taskCount: false, nextTask: false, position: "center" };

const AUTO_SCAN_EVERY_MS = 40 * 60_000;

let widget, tray;
const panels = {};     // name -> BrowserWindow
let memory, tasks, widgets;
let building = false;
const widgetIdBySender = new Map(); // webContents id -> custom widget id
let sessionId = null;  // Claude Code session for the current chat; null = next message starts a new one
let chatProc = null;   // the running chat `claude` process, if any
let stopped = false;
let capturing = false;
let scanning = false;
let pendingApprovals = new Map(); // id -> approval card from the last reply
let declinedNote = "";            // tells Claude next turn what the user declined
let notesScannedText = "";        // notes as of the last automatic scan, to skip unchanged notes

// ---------- config ----------
const userData = () => app.getPath("userData");
const workDir = () => path.join(userData(), "claude-chat");
const chatShotsDir = () => path.join(workDir(), "screenshots");
const configPath = () => path.join(userData(), "config.json");
const notesPath = () => path.join(userData(), "notes.md");

function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(configPath(), "utf8")); } catch {}
  return {
    memoryEnabled: true, autoScan: true, autoAllow: [], panelBounds: {}, panelEnabled: {}, mainHidden: false, ...cfg,
    pill: { ...DEFAULT_PILL, ...cfg.pill }, theme: { ...DEFAULT_THEME, ...cfg.theme }, hotkeys: { ...DEFAULT_HOTKEYS, ...cfg.hotkeys },
  };
}
function saveConfig(patch) {
  fs.writeFileSync(configPath(), JSON.stringify({ ...loadConfig(), ...patch }, null, 2));
}
function getShortcuts() {
  const cfg = loadConfig();
  if (!cfg.shortcuts) return DEFAULT_SHORTCUTS;
  if (cfg.shortcutsVersion !== 2) {
    // v1 had emoji icons and no recap/scan tiles.
    let list = cfg.shortcuts.map(({ icon, ...s }) => s);
    if (!list.some((s) => s.action === "recap")) list.unshift(DEFAULT_SHORTCUTS[0]);
    if (!list.some((s) => s.action === "scan")) list.push(DEFAULT_SHORTCUTS[DEFAULT_SHORTCUTS.length - 1]);
    saveConfig({ shortcuts: list, shortcutsVersion: 2 });
    return list;
  }
  return cfg.shortcuts;
}
const readNotes = () => { try { return fs.readFileSync(notesPath(), "utf8"); } catch { return ""; } };

// ---------- main widget ----------
function placeWidget(mode, size) {
  let [w, h] = WIDGET[mode] || WIDGET.pill;
  if (mode === "bar" && size) h = Math.min(size, 360);
  if (mode === "pill" && size) w = Math.max(90, Math.min(size, 560));
  const { workArea } = screen.getPrimaryDisplay();
  const pos = loadConfig().pill.position;
  const x = pos === "left" ? workArea.x + 12 : pos === "right" ? workArea.x + workArea.width - w - 12 : workArea.x + (workArea.width - w) / 2;
  widget.setBounds({ x: Math.round(x), y: workArea.y, width: w, height: h });
}

function makeWindow(file, size) {
  const win = new BrowserWindow({
    width: size[0], height: size[1], frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true);
  win.loadFile(file);
  win.on("blur", () => { if (!capturing) win.webContents.send("blurred"); });
  return win;
}

// Custom widgets: sandboxed (no Node.js), separate session with no network, only the overlay:// pages.
function makeWidgetWindow(id, size) {
  const win = new BrowserWindow({
    width: size[0], height: size[1], frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, "widget-preload.js"), contextIsolation: true, sandbox: true, partition: "persist:widgets" },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  widgetIdBySender.set(win.webContents.id, id);
  win.loadURL(`overlay://widget/${id}/index.html`);
  return win;
}

function setupWidgetSession() {
  const ses = session.fromPartition("persist:widgets");
  const APP_FILES = new Set(["theme.css", "panel.css", "panel.js", "theme.js"]);
  ses.protocol.handle("overlay", (req) => {
    const u = new URL(req.url);
    const parts = decodeURIComponent(u.pathname).split("/").filter(Boolean);
    if (u.host === "app" && parts.length === 1 && APP_FILES.has(parts[0])) return net.fetch(pathToFileURL(path.join(__dirname, parts[0])).toString());
    if (u.host === "widget" && parts.length === 2 && /^[a-z0-9-]+$/.test(parts[0]) && parts[1] === "index.html") {
      const file = widgets.indexFile(parts[0]);
      if (fs.existsSync(file)) return net.fetch(pathToFileURL(file).toString());
    }
    return new Response("Not found", { status: 404 });
  });
  // No network for widgets, and no camera/mic/location/etc.
  ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(overlay|data|devtools):/i.test(d.url) }));
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
}

function showWidget(focus) {
  if (loadConfig().mainHidden) saveConfig({ mainHidden: false });
  if (focus) { widget.show(); widget.focus(); } else widget.showInactive();
}
function focusWidget() { showWidget(true); }

// ---------- panels (tasks, notes, settings, custom widgets) ----------
function panelSpec(name) {
  if (PANELS[name]) return PANELS[name];
  const meta = widgets.meta(name);
  return meta && { custom: true, size: meta.size, min: [220, 150], label: meta.name };
}
function defaultBounds(name) {
  const { workArea } = screen.getPrimaryDisplay();
  const [w, h] = panelSpec(name)?.size || [380, 440];
  if (name === "settings") return { x: Math.round(workArea.x + (workArea.width - w) / 2), y: workArea.y + 90, width: w, height: h };
  if (name === "tasks" || name === "notes") {
    const x = workArea.x + workArea.width - w - 16 - (name === "notes" ? PANELS.tasks.size[0] + 12 : 0);
    return { x, y: workArea.y + 64, width: w, height: h };
  }
  // Custom widgets: start on the left, cascading so new ones don't stack exactly.
  const n = Object.keys(panels).filter((k) => !PANELS[k]).length;
  return { x: workArea.x + 24 + (n % 5) * 28, y: workArea.y + 64 + (n % 5) * 28, width: w, height: h };
}
function savedBounds(name) {
  const b = loadConfig().panelBounds[name];
  if (!b) return defaultBounds(name);
  // Only reuse it if it's still on a connected screen (e.g. after unplugging a monitor).
  const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
    b.x + 40 < a.x + a.width && b.x + b.width - 40 > a.x && b.y >= a.y - 10 && b.y + 30 < a.y + a.height);
  return onScreen ? b : defaultBounds(name);
}
function createPanel(name) {
  const spec = panelSpec(name);
  if (!spec) return null;
  const win = spec.custom ? makeWidgetWindow(name, spec.size) : makeWindow(spec.file, spec.size);
  win.setBounds(savedBounds(name));
  let saveTimer;
  const remember = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (win.isDestroyed() || !win.isVisible()) return;
      saveConfig({ panelBounds: { ...loadConfig().panelBounds, [name]: win.getBounds() } });
    }, 400);
  };
  win.on("move", remember);
  win.on("resize", remember);
  panels[name] = win;
  return win;
}
function destroyPanel(name) {
  const win = panels[name];
  if (!win) return;
  widgetIdBySender.delete(win.webContents.id);
  win.destroy();
  delete panels[name];
}
// Panels that Ctrl+Shift+Space brings up: Tasks, Notes and your custom widgets, unless you turned one off.
const hotkeyPanels = () => Object.keys(panels).filter((n) => !panelSpec(n)?.standalone && loadConfig().panelEnabled[n] !== false);
const anyPanelVisible = () => Object.keys(panels).some((n) => !panelSpec(n)?.standalone && panels[n].isVisible());
function showPanel(name, focus) {
  const w = panels[name] || createPanel(name);
  if (!w) return;
  w.setBounds(savedBounds(name));
  if (focus) { w.show(); w.focus(); } else w.showInactive();
  w.webContents.send("panel-shown");
}
function hidePanel(name) { panels[name]?.hide(); }
function togglePanel(name) { panels[name]?.isVisible() ? hidePanel(name) : showPanel(name); }

// Ctrl+Shift+Space: bring everything up (including anything you minimized), or put it all away.
function toggleAll() {
  if (anyPanelVisible()) {
    Object.keys(panels).filter((n) => !panelSpec(n)?.standalone).forEach(hidePanel);
    widget.webContents.send("collapse");
    return;
  }
  for (const name of hotkeyPanels()) showPanel(name);
  focusWidget();
  widget.webContents.send("open-bar");
}

function openSettings(section) {
  showPanel("settings", true);
  if (!section) return;
  const wc = panels.settings.webContents;
  // The first time, the page is still loading and would miss the message.
  if (wc.isLoading()) wc.once("did-finish-load", () => wc.send("settings-section", section));
  else wc.send("settings-section", section);
}

// ---------- screenshots for chat ----------
async function captureScreen() {
  capturing = true;
  const wereVisible = Object.entries(panels).filter(([, w]) => w.isVisible()).map(([n]) => n);
  widget.hide();
  wereVisible.forEach(hidePanel);
  await new Promise((r) => setTimeout(r, 220)); // let the widgets disappear before capturing
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const scale = Math.min(1, 1568 / Math.max(display.size.width, display.size.height));
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) },
    });
    const src = sources.find((s) => s.display_id === String(display.id)) || sources[0];
    return src ? src.thumbnail.toPNG().toString("base64") : null;
  } finally {
    wereVisible.forEach((n) => panels[n].showInactive());
    focusWidget();
    capturing = false;
  }
}

function clearChatScreenshots() {
  fs.rmSync(chatShotsDir(), { recursive: true, force: true });
  fs.mkdirSync(chatShotsDir(), { recursive: true });
}

// ---------- chat with Claude ----------
async function chatTurn(prompt, extraAllowed = []) {
  const cfg = loadConfig();
  const context = `[Widget context. Now: ${todayLine()}, ${new Date().toLocaleTimeString()}. Open tasks:\n${tasks.summary()}]` +
    (declinedNote ? `\n[Widget: ${declinedNote}]` : "");
  declinedNote = "";
  const full = `${context}\n\n${prompt}`;
  const opts = {
    cwd: workDir(),
    tools: TOOLS,
    allowedTools: [...AUTO_ALLOWED, ...cfg.autoAllow, ...extraAllowed],
    addDirs: [os.homedir()],
    systemPromptFile: path.join(workDir(), "system-prompt.txt"),
  };

  stopped = false;
  let run = runClaude({ ...opts, prompt: full, resume: sessionId });
  chatProc = run.proc;
  let res = await run.done;
  // If the saved session can't be resumed (e.g. it was deleted), start a fresh chat instead of failing.
  const failText = res.error || (res.json?.is_error ? res.json.result : "");
  if (sessionId && !stopped && /no conversation found/i.test(failText || "")) {
    sessionId = null;
    run = runClaude({ ...opts, prompt: full, resume: null });
    chatProc = run.proc;
    res = await run.done;
  }
  chatProc = null;
  if (stopped) return { ok: true, stopped: true };
  if (res.error) return { ok: false, error: friendlyError(res.error) };

  const { json } = res;
  if (json.session_id) sessionId = json.session_id;
  if (json.is_error) return { ok: false, error: friendlyError(json.result || `Claude Code returned an error (${json.subtype}).`) };

  let text = json.result || "";
  if (json.subtype === "error_max_turns") text += "\n\n_(Stopped after too many steps. Say \"continue\" to keep going.)_";
  const { text: cleaned, items } = extractTaskBlocks(text);
  const added = items.length ? tasks.add(items, "claude") : [];
  if (added.length) announceTasks(added.length);

  pendingApprovals = new Map();
  const approvals = (json.permission_denials || []).map(describeDenial);
  for (const a of approvals) pendingApprovals.set(a.id, a);
  return { ok: true, text: approvals.length ? tidyBlockedText(cleaned) : cleaned, approvals, tasksAdded: added.map((t) => t.title) };
}

// The CLI tells Claude "no prompt could be shown", and Claude tends to repeat that. The widget's Allow
// card *is* the prompt, so drop those sentences when a card is shown.
function tidyBlockedText(text) {
  const noise = /approval prompt|can'?t show|cannot show|no way to show|unable to show|denied automatically|automatically denied|permission (settings|mode)|new session|run (it|them|this) yourself|didn'?t try another way/i;
  const kept = text.split("\n").map((line) =>
    line.split(/(?<=[.!?])\s+/).filter((s) => !noise.test(s)).join(" ")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return kept || "Waiting for your OK on the action below.";
}

function recapPrompt(minutes = 30) {
  const timeline = memory.timeline(minutes);
  const shots = memory.recentShots(minutes, 4, workDir());
  if (!timeline && !shots.length) return null;
  return `What did I just do? Using my recent activity below, give me a quick recap of what I was working on and exactly where I left off, then suggest the next step. Keep it short.

Window activity (last ${minutes} minutes):
${timeline || "(none recorded)"}

Screenshots, oldest to newest (open each with Read):
${shots.map((s) => `${s.time}: ${s.path}`).join("\n") || "(none)"}`;
}

// e.g. "Thursday, 2026-10-15"
function todayLine() {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${d.toLocaleDateString("en-US", { weekday: "long" })}, ${iso}`;
}

// ---------- finding tasks (activity and/or notes) ----------
// sources: { activity: bool, notes: bool }
async function scanTasks({ activity = true, notes = true } = {}) {
  if (scanning) return { added: [], error: "Already looking for tasks." };
  const memOn = loadConfig().memoryEnabled;
  const timeline = activity && memOn ? memory.timeline(60) : "";
  const shots = activity && memOn ? memory.recentShots(60, 3, workDir()) : [];
  const notesText = notes ? readNotes().trim() : "";
  if (!timeline && !shots.length && !notesText) {
    return { added: [], error: activity && !memOn
      ? "Screen memory is off and your notes are empty, so there's nothing to look through."
      : notes && !activity ? "Your notes are empty." : "Not enough recent activity yet. Try again in a few minutes." };
  }
  scanning = true;
  broadcast("scan-state", true);
  try {
    const parts = [
      `Today is ${todayLine()}. Turn relative days ("this Friday", "tomorrow", "next week") into a due date (YYYY-MM-DD).`,
      `My current open tasks (don't add these again, even reworded):\n${tasks.summary()}`,
    ];
    if (notesText) {
      // Notes are the user's own to-do scratchpad: be inclusive.
      parts.push(`Find every task in my notes below. Treat each line or bullet as a task if it's something I need to do, an assignment, test or deadline to prepare for, someone to contact or reply to, something to buy, or a reminder. When in doubt, include it. Skip lines that are only information or loose ideas (e.g. "bio: mitochondria = powerhouse", "idea: start a study group?"). Write each title as a short action, keeping my wording where possible.

My notes (my own writing; just read them, don't change them):
"""
${notesText.slice(0, 12000)}
"""`);
    }
    if (timeline || shots.length) {
      parts.push(`${notesText ? "Also find" : "Find"} things I still need to do from my recent activity: homework or assignments, emails or messages that need a reply, and work I started but didn't finish. For activity, only include clear, specific items you have real evidence for.

Window activity (last 60 minutes):
${timeline || "(none)"}

Screenshots, oldest to newest (open each with Read):
${shots.map((s) => `${s.time}: ${s.path}`).join("\n") || "(none)"}`);
    }
    parts.push("It's fine to return an empty list.");
    const run = runClaude({
      cwd: workDir(), prompt: parts.join("\n\n"), tools: shots.length ? "Read" : "", allowedTools: shots.length ? ["Read"] : [],
      jsonSchema: scanSchema(notesText ? 25 : 8), effort: notesText ? "medium" : "low", persist: false,
    });
    const res = await run.done;
    if (res.error) return { added: [], error: friendlyError(res.error) };
    if (res.json.is_error) return { added: [], error: friendlyError(res.json.result) };
    let found = res.json.structured_output?.tasks;
    if (!found) { try { found = JSON.parse(res.json.result).tasks; } catch { found = []; } }
    const added = tasks.add(found || [], "claude");
    if (added.length) announceTasks(added.length);
    if (notesText) notesScannedText = notesText;
    return { added: added.map((t) => t.title) };
  } finally {
    scanning = false;
    broadcast("scan-state", false);
  }
}

function autoScan() {
  const cfg = loadConfig();
  if (!cfg.autoScan || scanning) return;
  const busy = cfg.memoryEnabled && memory.readActivity().filter((e) => e.t > Date.now() - AUTO_SCAN_EVERY_MS).length >= 3;
  const notesChanged = readNotes().trim() !== notesScannedText;
  if (busy || notesChanged) scanTasks({ activity: busy, notes: notesChanged }).catch(() => {});
}

// Claude added tasks: tell the pill (the task panel stays hidden until you open it).
function announceTasks(n) { widget?.webContents.send("tasks-added", n); }
function broadcast(ch, data) {
  for (const w of [widget, ...Object.values(panels)]) if (w && !w.isDestroyed()) w.webContents.send(ch, data);
}

// ---------- IPC ----------
ipcMain.on("set-mode", (_e, mode, size) => placeWidget(mode, size));
ipcMain.on("focus", () => focusWidget());
ipcMain.on("hide-widget", () => { saveConfig({ mainHidden: true }); widget.hide(); });
ipcMain.on("toggle-panel", (_e, name) => togglePanel(name));
ipcMain.on("hide-panel", (e) => {
  const name = Object.keys(panels).find((n) => panels[n].webContents === e.sender);
  if (name) hidePanel(name);
});
ipcMain.on("focus-panel", (e) => BrowserWindow.fromWebContents(e.sender)?.focus());
ipcMain.on("panel-resize", (e, width, height) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const name = Object.keys(panels).find((n) => panels[n] === win);
  if (!name) return;
  const [mw, mh] = panelSpec(name).min;
  const b = win.getBounds();
  win.setBounds({ ...b, width: Math.max(mw, Math.round(width)), height: Math.max(mh, Math.round(height)) });
});
ipcMain.handle("capture", () => captureScreen());
ipcMain.handle("read-clipboard", () => clipboard.readText());
ipcMain.on("write-clipboard", (_e, text) => clipboard.writeText(text));
ipcMain.handle("get-config", () => {
  const cfg = loadConfig();
  return { shortcuts: getShortcuts(), memoryEnabled: cfg.memoryEnabled, pill: cfg.pill };
});
ipcMain.handle("set-pill", (_e, pill) => {
  saveConfig({ pill: { ...DEFAULT_PILL, ...pill } });
  broadcast("pill-changed", loadConfig().pill);
  return true;
});
ipcMain.handle("set-shortcuts", (_e, shortcuts) => {
  saveConfig({ shortcuts, shortcutsVersion: 2 });
  broadcast("shortcuts-changed", shortcuts);
  return true;
});
ipcMain.handle("reset-shortcuts", () => {
  saveConfig({ shortcuts: DEFAULT_SHORTCUTS, shortcutsVersion: 2 });
  broadcast("shortcuts-changed", DEFAULT_SHORTCUTS);
  return DEFAULT_SHORTCUTS;
});

// ---------- settings ----------
ipcMain.on("open-settings", (_e, section) => openSettings(section));
ipcMain.handle("get-theme", () => loadConfig().theme);
ipcMain.handle("set-theme", (_e, theme) => {
  const t = { ...DEFAULT_THEME, ...loadConfig().theme, ...theme };
  saveConfig({ theme: t });
  broadcast("theme", t);
  return t;
});
ipcMain.handle("get-settings", () => {
  const cfg = loadConfig();
  return {
    theme: cfg.theme, pill: cfg.pill, shortcuts: getShortcuts(), hotkeys: cfg.hotkeys,
    memoryEnabled: cfg.memoryEnabled, autoScan: cfg.autoScan, autoAllow: cfg.autoAllow,
    openAtLogin: app.getLoginItemSettings(loginItemArgs()).openAtLogin,
    panels: panelList(), building,
  };
});
// Simple on/off and list settings.
ipcMain.handle("set-setting", (_e, key, value) => {
  if (key === "memoryEnabled" || key === "autoScan") saveConfig({ [key]: !!value });
  else if (key === "autoAllow" && Array.isArray(value)) saveConfig({ autoAllow: value.map(String) });
  else if (key === "openAtLogin") app.setLoginItemSettings({ ...loginItemArgs(), openAtLogin: !!value });
  else return false;
  buildTray();
  return true;
});
ipcMain.handle("set-hotkey", (_e, which, accel) => {
  if (!DEFAULT_HOTKEYS[which]) return { ok: false, error: "Unknown shortcut." };
  const next = { ...loadConfig().hotkeys, [which]: accel || DEFAULT_HOTKEYS[which] };
  const failed = registerHotkeys(next);
  if (failed.includes(which)) {
    registerHotkeys(loadConfig().hotkeys); // put the old ones back
    return { ok: false, error: "That shortcut is taken by another app or Windows. Try a different one." };
  }
  saveConfig({ hotkeys: next });
  buildTray();
  return { ok: true, hotkeys: next };
});
ipcMain.handle("clear-memory", () => { memory.clear(); return true; });
ipcMain.handle("reset-positions", () => {
  saveConfig({ panelBounds: {} });
  for (const n of Object.keys(panels)) panels[n].setBounds(defaultBounds(n));
  return true;
});

function loginItemArgs() {
  // When run unpackaged (electron.exe <folder>), Windows needs the folder as an argument to start the right app.
  return app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] };
}

function panelList() {
  const cfg = loadConfig();
  const list = ["tasks", "notes"].map((name) => ({ name, label: PANELS[name].label, builtin: true }));
  for (const m of widgets.list()) list.push({ name: m.id, label: m.name, description: m.description, builtin: false, canUndo: widgets.canUndo(m.id), updated: m.updated });
  return list.map((p) => ({ ...p, enabled: cfg.panelEnabled[p.name] !== false, visible: !!panels[p.name]?.isVisible() }));
}
ipcMain.handle("panel-enabled", (_e, name, on) => {
  saveConfig({ panelEnabled: { ...loadConfig().panelEnabled, [name]: !!on } });
  return panelList();
});
ipcMain.handle("panel-show", (_e, name) => { showPanel(name); return panelList(); });

// ---------- custom widgets ----------
ipcMain.handle("widget-delete", (_e, id) => {
  if (PANELS[id] || !widgets.meta(id)) return panelList();
  destroyPanel(id);
  widgets.remove(id);
  const cfg = loadConfig();
  const { [id]: _b, ...bounds } = cfg.panelBounds;
  const { [id]: _en, ...enabled } = cfg.panelEnabled;
  saveConfig({ panelBounds: bounds, panelEnabled: enabled });
  return panelList();
});
ipcMain.handle("widget-undo", (_e, id) => {
  if (widgets.undo(id)) panels[id]?.reload();
  return panelList();
});

// Claude writes (or changes) a widget from your description, then it's installed and shown.
ipcMain.handle("widget-build", async (_e, { request, id }) => {
  if (building) return { ok: false, error: "Claude is already building a widget. Wait for it to finish." };
  if (!String(request || "").trim()) return { ok: false, error: "Describe the widget first." };
  if (id && !widgets.meta(id)) return { ok: false, error: "That widget no longer exists." };
  building = true;
  const progress = (msg) => panels.settings?.webContents.send("build-progress", msg);
  try {
    const existing = id ? { meta: widgets.meta(id), source: widgets.source(id) } : null;
    let prompt = buildPrompt(String(request).trim(), existing);
    for (let attempt = 1; attempt <= 2; attempt++) {
      progress(attempt === 1 ? (id ? "Claude is changing the widget…" : "Claude is designing and coding your widget…") : "Fixing a problem in the code…");
      const res = await runClaude({ cwd: workDir(), prompt, tools: "", jsonSchema: BUILD_SCHEMA, effort: "high", persist: false }).done;
      if (res.error) return { ok: false, error: friendlyError(res.error) };
      if (res.json.is_error) return { ok: false, error: friendlyError(res.json.result) };
      let build = res.json.structured_output;
      if (!build) { try { build = JSON.parse(res.json.result); } catch {} }
      if (!build?.html && !build?.js) return { ok: false, error: "Claude didn't return a widget. Try describing it again." };
      const syntaxError = checkJs(build.js || "");
      if (syntaxError && attempt === 1) {
        prompt += `\n\n## Your previous attempt had a JavaScript syntax error\n${syntaxError}\nReturn the complete widget again with this fixed.`;
        continue;
      }
      if (syntaxError) return { ok: false, error: `The widget's code has an error Claude couldn't fix: ${syntaxError}` };
      const fullRequest = existing ? `${existing.meta.request}\nChange: ${request}` : request;
      const meta = widgets.save({ ...build, request: fullRequest }, id);
      if (id) panels[id]?.reload();
      else showPanel(meta.id);
      progress("");
      return { ok: true, widget: meta, panels: panelList() };
    }
  } finally {
    building = false;
  }
});

// The API custom widgets call (see widget-preload.js). The widget is identified by which window is calling.
const askLog = new Map(); // widget id -> recent ask timestamps
ipcMain.handle("widget-api", async (e, name, ...args) => {
  const id = widgetIdBySender.get(e.sender.id);
  if (!id) throw new Error("Not a widget.");
  switch (name) {
    case "storage.get": return widgets.readData(id)[String(args[0])] ?? null;
    case "storage.set": widgets.writeData(id, String(args[0]), args[1]); return true;
    case "storage.all": return widgets.readData(id);
    case "tasks.list": return tasks.list();
    case "tasks.add": return tasks.add([args[0] || {}], "me");
    case "tasks.update": tasks.update(String(args[0]), args[1] || {}); return true;
    case "tasks.remove": tasks.remove(String(args[0])); return true;
    case "notes.get": return readNotes();
    case "ask": {
      // Keep a misbehaving widget from burning through your usage.
      const recent = (askLog.get(id) || []).filter((t) => t > Date.now() - 3600_000);
      if (recent.length >= 30) throw new Error("This widget has asked Claude too many times this hour.");
      askLog.set(id, [...recent, Date.now()]);
      const res = await runClaude({ cwd: workDir(), prompt: String(args[0] || "").slice(0, 20000), tools: "", effort: "low", persist: false }).done;
      if (res.error) throw new Error(friendlyError(res.error));
      if (res.json.is_error) throw new Error(friendlyError(res.json.result));
      return res.json.result || "";
    }
    default: throw new Error(`Unknown widget API: ${name}`);
  }
});
ipcMain.on("widget-open-chat", (e, prompt) => {
  if (!widgetIdBySender.has(e.sender.id) || !prompt) return;
  focusWidget();
  widget.webContents.send("run-prompt", prompt.slice(0, 4000));
});

ipcMain.handle("reset", () => {
  sessionId = null;
  pendingApprovals = new Map();
  declinedNote = "";
  clearChatScreenshots();
  return true;
});
ipcMain.handle("stop", () => { if (chatProc) { stopped = true; killProc(chatProc); } return true; });

ipcMain.handle("ask", async (_e, { text, image }) => {
  let prompt = text || "What's on my screen?";
  if (image) {
    const name = `shot-${Date.now()}.png`;
    fs.writeFileSync(path.join(chatShotsDir(), name), Buffer.from(image, "base64"));
    prompt = `[I attached a screenshot of my screen: ./screenshots/${name}]\n\n${prompt}`;
  }
  return chatTurn(prompt);
});

ipcMain.handle("recap", async () => {
  if (!loadConfig().memoryEnabled) return { ok: false, error: "Screen memory is off. Turn it on from the tray icon so I can keep track of what you're doing." };
  const prompt = recapPrompt(30);
  if (!prompt) return { ok: false, error: "I don't have any recent activity yet. Screen memory needs a few minutes of use first." };
  return chatTurn(prompt);
});

// ids: approval ids to allow; always: subset to remember as standing rules.
ipcMain.handle("approve", async (_e, { ids, always = [] }) => {
  const chosen = ids.map((id) => pendingApprovals.get(id)).filter(Boolean);
  if (!chosen.length) return { ok: false, error: "Those actions are no longer pending. Ask again." };
  const remember = chosen.filter((a) => always.includes(a.id) && a.alwaysRule).map((a) => a.alwaysRule);
  if (remember.length) saveConfig({ autoAllow: [...new Set([...loadConfig().autoAllow, ...remember])] });
  const list = chosen.map((a) => `- ${a.title}: ${a.detail}`).join("\n");
  return chatTurn(
    `[Widget: the user approved these blocked actions, and permissions now allow them:\n${list}\nRetry them now and carry on with the task.]`,
    chosen.map((a) => a.rule),
  );
});
ipcMain.handle("decline", (_e, { ids }) => {
  const chosen = ids.map((id) => pendingApprovals.get(id)).filter(Boolean);
  for (const a of chosen) pendingApprovals.delete(a.id);
  if (chosen.length) declinedNote = `the user declined: ${chosen.map((a) => `${a.title} (${a.detail})`).join("; ")}. Don't retry those.`;
  return true;
});

ipcMain.handle("scan-tasks", (_e, sources) => scanTasks(sources));
ipcMain.handle("tasks-list", () => tasks.list());
ipcMain.handle("tasks-add", (_e, item) => tasks.add([item], "me"));
ipcMain.handle("tasks-update", (_e, id, patch) => tasks.update(id, patch));
ipcMain.handle("tasks-remove", (_e, id) => tasks.remove(id));
ipcMain.handle("tasks-clear-done", () => tasks.clearDone());
ipcMain.on("task-help", (_e, task) => {
  focusWidget();
  widget.webContents.send("run-prompt",
    `Help me with this task from my list: "${task.title}"${task.note ? ` (${task.note})` : ""}. Do as much of it as you can, then tell me what's left.`);
});

ipcMain.handle("notes-get", () => readNotes());
ipcMain.handle("notes-set", (_e, text) => { fs.writeFileSync(notesPath(), String(text)); return true; });

// ---------- tray ----------
const prettyKey = (a) => a.replace(/CommandOrControl/g, "Ctrl").replace(/\+/g, "+");
function registerHotkeys(keys) {
  globalShortcut.unregisterAll();
  const failed = [];
  const reg = (which, fn) => {
    try { if (!globalShortcut.register(keys[which], fn)) failed.push(which); } catch { failed.push(which); }
  };
  reg("toggle", toggleAll);
  reg("capture", () => widget.webContents.send("trigger-capture"));
  return failed;
}

function buildTray() {
  if (!tray) return;
  const cfg = loadConfig();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Show / hide everything    ${prettyKey(cfg.hotkeys.toggle)}`, click: toggleAll },
    { label: "Tasks", click: () => togglePanel("tasks") },
    { label: "Notes", click: () => togglePanel("notes") },
    { label: "Settings", click: () => openSettings() },
    { type: "separator" },
    { label: "Screen memory", type: "checkbox", checked: cfg.memoryEnabled, click: (i) => { saveConfig({ memoryEnabled: i.checked }); buildTray(); } },
    { label: "Find tasks automatically", type: "checkbox", checked: cfg.autoScan, click: (i) => { saveConfig({ autoScan: i.checked }); buildTray(); } },
    { label: "Clear screen memory", click: () => memory.clear() },
    { label: "Reset \"always allow\" choices", enabled: cfg.autoAllow.length > 0, click: () => { saveConfig({ autoAllow: [] }); buildTray(); } },
    { label: "Reset widget positions", click: () => { saveConfig({ panelBounds: {} }); for (const n of Object.keys(panels)) panels[n].setBounds(defaultBounds(n)); } },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]));
}

// ---------- startup ----------
app.whenReady().then(() => {
  fs.mkdirSync(workDir(), { recursive: true });
  fs.writeFileSync(path.join(workDir(), "system-prompt.txt"), SYSTEM);
  clearChatScreenshots();

  tasks = new TaskStore(path.join(userData(), "tasks.json"), (list) => broadcast("tasks-changed", list));
  memory = new ScreenMemory({
    dir: path.join(workDir(), "memory"),
    isEnabled: () => loadConfig().memoryEnabled,
    onWelcomeBack: (minutes) => widget.webContents.send("welcome-back", minutes),
  });
  memory.start();
  notesScannedText = readNotes().trim(); // only rescan notes after they change
  setInterval(autoScan, AUTO_SCAN_EVERY_MS);

  widget = makeWindow("index.html", WIDGET.pill);
  placeWidget("pill");
  widget.once("ready-to-show", () => { if (!loadConfig().mainHidden) widget.showInactive(); });
  widgets = new WidgetStore(path.join(userData(), "widgets"));
  setupWidgetSession();
  createPanel("tasks");
  createPanel("notes");
  for (const m of widgets.list()) createPanel(m.id);

  const failed = registerHotkeys(loadConfig().hotkeys);
  if (failed.length) registerHotkeys(DEFAULT_HOTKEYS); // a saved shortcut is taken now: fall back to the defaults

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 16, height: 16 }));
  tray.setToolTip("Claude widgets (Ctrl+Shift+Space)");
  tray.on("click", toggleAll);
  buildTray();
});

app.on("will-quit", () => { globalShortcut.unregisterAll(); memory?.stop(); killProc(chatProc); });
module.exports = { toggleAll }; // for test scripts
app.on("window-all-closed", (e) => e.preventDefault());
