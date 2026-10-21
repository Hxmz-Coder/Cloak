const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, screen, Tray, Menu, nativeImage, clipboard, protocol, session, net, safeStorage, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("url");
const { runClaude, friendlyError, findClaude, setAuth } = require("./lib/claude");
const { spawn, execFileSync } = require("child_process");
const { ChatSession } = require("./lib/chat");
const { TOOLS, AUTO_ALLOWED, describeDenial } = require("./lib/permissions");
const { ScreenMemory } = require("./lib/memory");
const { TaskStore, extractTaskBlocks, scanSchema } = require("./lib/tasks");
const { MemoryStore, extractMemoryBlocks } = require("./lib/memories");
const { Listener } = require("./lib/listen");
const { WidgetStore, BUILD_SCHEMA, buildPrompt, checkJs } = require("./lib/widgets");
const { GENERAL_SHORTCUTS, modePrompt, normalizeModes, defaultModeFor, MODE_SCHEMA, modeBuildPrompt } = require("./lib/modes");
const { DEFAULT_NOTIFY, NotifyState, taskNotifications } = require("./lib/notify");
const codex = require("./lib/codex");
const { openTerminal: openTerminalWindow } = require("./lib/terminal");

// Custom widgets load from overlay://app/... (shared frame files) and overlay://widget/<id>/index.html.
protocol.registerSchemesAsPrivileged([{ scheme: "overlay", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// Data lives in %APPDATA%\cloak. Earlier versions used %APPDATA%\overclaude (and before that
// %APPDATA%\claude-overlay); the newest one found is moved over once so everything carries across the rename.
app.setName("cloak");
// CLOAK_DATA_DIR points it at a different folder instead (e.g. a test or portable profile).
(() => {
  const custom = process.env.CLOAK_DATA_DIR || process.env.OVERCLAUDE_DATA_DIR;
  const dir = custom || path.join(app.getPath("appData"), "cloak");
  const old = ["overclaude", "claude-overlay"].map((n) => path.join(app.getPath("appData"), n)).find((p) => fs.existsSync(p));
  if (!custom && !fs.existsSync(dir) && old) {
    try {
      fs.cpSync(old, dir, { recursive: true, filter: (src) => !/[\\/](Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|Crashpad|blob_storage)([\\/]|$)/i.test(src) });
    } catch {}
  }
  app.setPath("userData", dir);
})();

// Only one copy runs at a time; starting it again just opens the one that's already running.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  if (!widget) return;
  showWidget(true);
  widget.webContents.send("open-bar");
});

const SYSTEM = `You are Claude, running on the user's Windows PC from a small widget at the top of their screen.

Work autonomously. When a request takes several steps, carry them all out without stopping to check in: read files, search, look things up, and keep going until it's done. Don't ask "should I continue?" for routine steps.

Some actions need the user's approval: shell commands that change things, creating or editing files, and opening web pages. When one of these is denied, that is expected: the widget automatically shows the user an Allow button for exactly that action, and if they allow it you'll be asked to retry. So finish everything else you can, then say in one short line what you're waiting on (e.g. "Waiting for your OK to create notes.txt."). Don't explain permission settings, don't suggest starting a new session or running it themselves, and never try to get around a block another way.

Screenshots: when the user's message lists screenshot paths, open them with the Read tool before answering.

Task list: the user has a task list widget. To add tasks to it, put a fenced code block with the language "tasks" in your reply, one task per line as "category | title | due | time", where category is homework, email, unfinished or other, due is an optional YYYY-MM-DD date, and time is an optional 24-hour HH:MM (only with a due date). Put dates and times in those fields, not in the title. Example: "homework | Study for biology quiz | 2026-10-17 | 16:00". The widget removes the block and adds the tasks. Add tasks when the user asks, or when you notice something they clearly need to do later. Don't add duplicates of their open tasks.

Memory: the user can ask you to remember things. What they've asked you to remember is listed in the widget context with each message; use it. To save something new (when they ask you to remember it, or tell you a lasting fact or preference about themselves), put a fenced code block with the language "memory" in your reply, one fact per line, each a complete sentence that makes sense on its own later (e.g. "The user's biology exam is on Friday, October 23 at 3 PM."). The widget removes the block and saves it. Mention briefly that you'll remember it. Never save passwords or other secrets.

Notes: the user keeps personal notes in a notes widget. They are the user's own writing; you only see them when they're included in a message. Never rewrite or "submit" them.

Style: concise and direct. Use short markdown (bullets, code blocks) when it helps.`;

// ---------- which AI: Claude (through Claude Code) or ChatGPT (through OpenAI's Codex CLI) ----------
// Settings > General. Everything else in Cloak works the same with either.
const provider = () => (loadConfig().provider === "chatgpt" ? "chatgpt" : "claude");
const aiName = () => (provider() === "chatgpt" ? "ChatGPT" : "Claude");
const runAI = (opts) => (provider() === "chatgpt" ? codex.runCodex(opts) : runClaude(opts));
const aiError = (t) => (provider() === "chatgpt" ? codex.friendlyCodexError(t) : friendlyError(t));
// Codex can't hand back the actions it was blocked from, so it's asked to request them (see lib/codex.js).
const CODEX_APPROVALS = `You start with read-only access: you can read files, search the web and run commands that only look at things. Don't try anything that changes something (creating, editing or deleting files, installing software, commands that modify the system). Instead, finish everything else you can, then end your reply with one line per change, exactly in this form:
APPROVAL NEEDED: <short description of the change, e.g. Create notes.txt in Documents>
The widget turns each of those lines into an Allow button. If the user allows it, you'll be asked to go ahead with write access. Never try to get around this another way.`;
function systemPrompt() {
  if (provider() !== "chatgpt") return SYSTEM;
  return SYSTEM.replace("You are Claude,", "You are ChatGPT,")
    .replace(/Some actions need the user's approval:[\s\S]*?never try to get around a block another way\./, CODEX_APPROVALS)
    .replace("open them with the Read tool before answering", "they're attached to the message as images; look at them before answering");
}
// Claude Code gets the instructions as a file argument; Codex reads AGENTS.md from its working folder.
function writeInstructions() {
  const text = systemPrompt() + modePrompt(activeMode());
  fs.writeFileSync(path.join(workDir(), "system-prompt.txt"), text);
  fs.writeFileSync(path.join(workDir(), "AGENTS.md"), text);
}
const CODEX_EFFORT = { fast: "low", balanced: "medium", smart: "high" };
function makeChat() {
  if (provider() === "chatgpt") {
    return new codex.CodexChat(() => {
      const cfg = loadConfig();
      return { cwd: workDir(), effort: CODEX_EFFORT[cfg.chatSpeed] || "medium", addDirs: [os.homedir()], alwaysWrite: cfg.autoAllow.includes(codex.WRITE_RULE) };
    });
  }
  return new ChatSession(chatOptions);
}

// Main widget sizes (include a little transparent margin for the shadow). The pill's width follows its content.
const WIDGET = { pill: [160, 58], bar: [680, 150], chat: [680, 620], edit: [680, 400], notify: [420, 110] };

// Panels: hidden until Ctrl+Shift+Space, movable and resizable, reopen where you left them.
// Custom widgets Claude builds become panels too. Settings is a panel that only opens when you ask.
const PANELS = {
  tasks: { file: "tasks.html", size: [360, 440], min: [260, 200], label: "Tasks" },
  notes: { file: "notes.html", size: [380, 460], min: [260, 200], label: "Notes" },
  listen: { file: "listen.html", size: [400, 540], min: [300, 320], label: "Listen" },
  settings: { file: "settings.html", size: [800, 600], min: [800, 600], label: "Settings", standalone: true, fixed: true },
  welcome: { file: "welcome.html", size: [760, 580], min: [760, 580], label: "Welcome", standalone: true, fixed: true },
};
const DEFAULT_THEME = { accent: "#d97757", opacity: 0.95 };
const DEFAULT_HOTKEYS = { toggle: "CommandOrControl+Shift+Space", capture: "CommandOrControl+Shift+S" };

const DEFAULT_PILL = { label: "Claude", style: "island", clock: false, date: false, taskCount: false, nextTask: false, widgets: [], showMode: true, position: "center" };

const AUTO_SCAN_EVERY_MS = 40 * 60_000;

let widget, tray;
const panels = {};     // name -> BrowserWindow
let memory, tasks, widgets, memories, listener;
let building = false;
const widgetIdBySender = new Map(); // webContents id -> custom widget id
const widgetStatus = {};            // custom widget id -> status line it offers the pill
let chat;             // the chat bar's always-running Claude (lib/chat.js)
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
// ---------- modes ----------
// Each mode has its own instructions and shortcut buttons (lib/modes.js). The shortcut list from before modes
// existed becomes the General mode's.
function getModes() {
  const cfg = loadConfig();
  if (!cfg.modes) {
    let legacy = cfg.shortcuts;
    if (legacy && cfg.shortcutsVersion !== 2) legacy = legacy.map(({ icon, ...s }) => s); // v1 had emoji icons
    const modes = normalizeModes(null, legacy);
    saveConfig({ modes, activeMode: cfg.activeMode || "general" });
    return modes;
  }
  return normalizeModes(cfg.modes);
}
function activeMode() {
  const modes = getModes();
  return modes.find((m) => m.id === loadConfig().activeMode) || modes[0];
}
const getShortcuts = (modeId) => (modeId ? getModes().find((m) => m.id === modeId) : activeMode())?.shortcuts || GENERAL_SHORTCUTS;
function saveModes(modes) {
  saveConfig({ modes });
  applyMode();
}
// Writes Claude's instructions for the active mode and tells every window. The chat restarts (keeping the
// conversation) the next time it's used, because its options include the mode.
function applyMode() {
  const mode = activeMode();
  writeInstructions();
  broadcast("mode-changed", { id: mode.id, name: mode.name, shortcuts: mode.shortcuts });
  chat?.warm();
}
function setActiveMode(id) {
  if (!getModes().some((m) => m.id === id)) return false;
  saveConfig({ activeMode: id });
  applyMode();
  buildTray();
  return true;
}
function modeMenuItems() {
  const cur = activeMode().id;
  return getModes().map((m) => ({ label: m.name, type: "radio", checked: m.id === cur, click: () => setActiveMode(m.id) }));
}
const readNotes = () => { try { return fs.readFileSync(notesPath(), "utf8"); } catch { return ""; } };

// ---------- main widget ----------
function placeWidget(mode, size) {
  let [w, h] = WIDGET[mode] || WIDGET.pill;
  if (mode === "bar" && size) h = Math.min(size, 360);
  if (mode === "pill" && size) w = Math.max(56, Math.min(size, 560));
  if (mode === "notify" && size) h = Math.max(70, Math.min(size, 240));
  const { workArea } = screen.getPrimaryDisplay();
  const pos = loadConfig().pill.position;
  const x = pos === "left" ? workArea.x + 12 : pos === "right" ? workArea.x + workArea.width - w - 12 : workArea.x + (workArea.width - w) / 2;
  widget.setBounds({ x: Math.round(x), y: workArea.y, width: w, height: h });
}

function makeWindow(file, size) {
  const win = new BrowserWindow({
    width: size[0], height: size[1], frame: false, transparent: true, resizable: false, // no native resize edge; panels resize from their own grip
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, autoplayPolicy: "no-user-gesture-required" }, // notification chime
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true);
  win.loadFile(path.join(__dirname, file)); // absolute, so it works whatever folder Cloak was started from
  win.on("blur", () => { if (!capturing) win.webContents.send("blurred"); });
  return win;
}

// Custom widgets: sandboxed (no Node.js), separate session with no network, only the overlay:// pages.
function makeWidgetWindow(id, size) {
  const win = new BrowserWindow({
    width: size[0], height: size[1], frame: false, transparent: true, resizable: false, // no native resize edge; panels resize from their own grip
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
// Tasks and Notes can be changed by Claude: its version lives in widgets/tasks (or notes) and takes over the panel.
const EDITABLE_BUILTINS = new Set(["tasks", "notes"]);
const isCustomized = (name) => EDITABLE_BUILTINS.has(name) && !!widgets?.meta(name);
function panelSpec(name) {
  if (PANELS[name] && !isCustomized(name)) return PANELS[name];
  const meta = widgets.meta(name);
  return meta && { custom: true, size: meta.size, min: [220, 150], label: meta.name };
}
function defaultBounds(name) {
  const { workArea } = screen.getPrimaryDisplay();
  const [w, h] = panelSpec(name)?.size || [380, 440];
  if (name === "settings" || name === "welcome") return { x: Math.round(workArea.x + (workArea.width - w) / 2), y: Math.round(workArea.y + Math.max(60, (workArea.height - h) / 2)), width: w, height: h };
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
  if (panelSpec(name)?.fixed) b.width = panelSpec(name).size[0], b.height = panelSpec(name).size[1]; // fixed-size windows keep their size
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
  if (name === "listen") win.webContents.setBackgroundThrottling(false); // keeps capturing while minimized
  // Closed some other way than our hide (e.g. Alt+F4): forget it, or the next click hits a destroyed window.
  const wcId = win.webContents.id;
  win.on("closed", () => {
    widgetIdBySender.delete(wcId);
    if (panels[name] === win) { delete panels[name]; notifyPanels(); }
  });
  panels[name] = win;
  return win;
}
function destroyPanel(name) {
  const win = panels[name];
  if (!win) return;
  delete panels[name];
  widgetIdBySender.delete(win.webContents.id);
  win.destroy();
  notifyPanels();
}
// Keeps the widget buttons in the chat bar in sync (which widgets exist, which are open).
let notifyTimer;
function notifyPanels() {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => widget?.webContents.send("panels-changed", panelList()), 50);
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
  notifyPanels();
}
function hidePanel(name) { panels[name]?.hide(); notifyPanels(); }
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
// Speed presets for chat (Settings > Claude & privacy).
const CHAT_SPEEDS = {
  fast: { model: "haiku", effort: "low" },
  balanced: { model: "sonnet", effort: "low" },
  smart: { model: "opus", effort: "medium" },
};
function chatOptions() {
  const cfg = loadConfig();
  return {
    cwd: workDir(),
    tools: TOOLS,
    allowedTools: [...AUTO_ALLOWED, ...cfg.autoAllow.filter((r) => r !== codex.WRITE_RULE)],
    addDirs: [os.homedir()],
    systemPromptFile: path.join(workDir(), "system-prompt.txt"),
    ...(CHAT_SPEEDS[cfg.chatSpeed] || CHAT_SPEEDS.balanced),
    mode: activeMode().id + ":" + activeMode().instructions, // a mode change restarts the chat with the new instructions
    auth: authSignature(),                                    // so does switching between subscription and API key
  };
}

// What Claude is doing, shown under the reply while it works.
const TOOL_LABELS = {
  Read: "Reading a file", Glob: "Looking through files", Grep: "Searching files", WebSearch: "Searching the web",
  WebFetch: "Opening a web page", Bash: "Running a command", Edit: "Editing a file", Write: "Writing a file",
};

// The conversation shown in the chat bar, kept across restarts.
const chatHistoryPath = () => path.join(userData(), "chat.json");
function loadHistory() {
  try { return JSON.parse(fs.readFileSync(chatHistoryPath(), "utf8")); } catch { return { sessionId: null, messages: [] }; }
}
function saveHistory(messages) {
  fs.writeFileSync(chatHistoryPath(), JSON.stringify({ sessionId: chat.sessionId, provider: provider(), messages: messages.slice(-200) }));
}

// display: what to show as your message in the chat (null for follow-ups like approvals).
async function chatTurn(prompt, { display = null, image = false, extraAllowed = [] } = {}) {
  const remembered = memories.context();
  const heard = listenContext(5);
  const context = `[Widget context. Mode: ${activeMode().name}. Now: ${todayLine()}, ${new Date().toLocaleTimeString()}. Open tasks:\n${tasks.summary()}` +
    (remembered ? `\nThings the user asked you to remember:\n${remembered}` : "") +
    (heard ? `\nListen is on. What's been playing on the user's computer (last few minutes, transcribed):\n${heard}` : "") + "]" +
    (declinedNote ? `\n[Widget: ${declinedNote}]` : "");
  declinedNote = "";
  const full = `${context}\n\n${prompt}`;
  const history = loadHistory().messages;
  if (display !== null) history.push({ role: "user", text: display, image, time: Date.now() });
  saveHistory(history);

  const onEvent = (ev) => {
    if (ev.type === "tool") ev.label = TOOL_LABELS[ev.name] || `Using ${ev.name}`;
    widget?.webContents.send("chat-event", ev);
  };
  let res = await chat.send(full, { onEvent, extraAllowed });
  // If the saved conversation can't be resumed (e.g. it was deleted), start a fresh one instead of failing.
  const failText = res.error || (res.json?.is_error ? res.json.result : "");
  if (/no conversation found|(thread|session|conversation)\b.*\bnot found/i.test(failText || "")) {
    chat.sessionId = null;
    chat.kill();
    res = await chat.send(full, { onEvent, extraAllowed });
  }
  if (res.stopped) return { ok: true, stopped: true };
  if (res.error) return { ok: false, error: aiError(res.error) };

  const { json } = res;
  if (json.is_error) return { ok: false, error: aiError(json.result || `${aiName()} returned an error (${json.subtype}).`) };

  let text = json.result || "";
  if (json.subtype === "error_max_turns") text += "\n\n_(Stopped after too many steps. Say \"continue\" to keep going.)_";
  const { text: noMemory, facts } = extractMemoryBlocks(text);
  const learned = facts.length ? memories.add(facts, "claude") : [];
  const { text: cleaned, items } = extractTaskBlocks(noMemory);
  const added = items.length ? tasks.add(items, "claude") : []; // the reply says so (and the answer notification, if you're away)

  pendingApprovals = new Map();
  const approvals = (json.permission_denials || []).map((d, i) => (d.codex ? codex.describeCodexRequest(d) : describeDenial(d, i)));
  for (const a of approvals) pendingApprovals.set(a.id, a);
  const shown = approvals.length ? tidyBlockedText(cleaned) : cleaned;
  history.push({ role: "bot", text: shown, time: Date.now() });
  saveHistory(history);
  return { ok: true, text: shown, approvals, tasksAdded: added.map((t) => t.title), remembered: learned.map((m) => m.text) };
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
    const run = runAI({
      cwd: workDir(), prompt: parts.join("\n\n"), tools: shots.length ? "Read" : "", allowedTools: shots.length ? ["Read"] : [],
      jsonSchema: scanSchema(notesText ? 25 : 8), effort: notesText ? "medium" : "low", persist: false,
    });
    const res = await run.done;
    if (res.error) return { added: [], error: aiError(res.error) };
    if (res.json.is_error) return { added: [], error: aiError(res.json.result) };
    let found = res.json.structured_output?.tasks;
    if (!found) { try { found = JSON.parse(res.json.result).tasks; } catch { found = []; } }
    const added = tasks.add(found || [], "claude");
    if (added.length) pushNotification({ kind: "found", title: `Added ${added.length} task${added.length > 1 ? "s" : ""}`,
      body: added.slice(0, 2).map((t) => t.title).join(", ") + (added.length > 2 ? ` +${added.length - 2} more` : ""), target: { type: "tasks", taskId: added[0].id } });
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

function broadcast(ch, data) {
  for (const w of [widget, ...Object.values(panels)]) if (w && !w.isDestroyed()) w.webContents.send(ch, data);
}

// ---------- notifications ----------
// They pop out of the top widget (renderer.js). Clicking one opens where it came from (its target).
const NOTIFY_SETTING = { deadline: "deadlines", checkin: "checkins", digest: "digest", answer: "answers", approval: "answers", found: "found", widget: "widgets", listen: "listen" };
const notifyCfg = () => ({ ...DEFAULT_NOTIFY, ...loadConfig().notify });
const shownNotes = new Map(); // id -> notification on screen or waiting
let notifySeq = 0, notifyState = null, shownForNotify = false;
// Returns true if it will be shown (false when that kind is off or notifications are paused).
function pushNotification(n) {
  const cfg = notifyCfg();
  const setting = NOTIFY_SETTING[n.kind];
  if (!n.test && (!cfg.enabled || cfg.pausedUntil > Date.now() || (setting && !cfg[setting]))) return false;
  if (!widget || widget.isDestroyed()) return false;
  const id = `n${++notifySeq}`;
  shownNotes.set(id, { ...n, id });
  if (shownNotes.size > 50) shownNotes.delete(shownNotes.keys().next().value);
  // The top widget is hidden: show it just for the notification (it hides again afterwards).
  if (!widget.isVisible()) { shownForNotify = true; widget.showInactive(); }
  const { target, ...shown } = n;
  widget.webContents.send("notify", { ...shown, id, sound: cfg.sound, time: Date.now() });
  return true;
}
function checkTaskNotifications() {
  const cfg = notifyCfg();
  if (!cfg.enabled || cfg.pausedUntil > Date.now()) return;
  const due = taskNotifications(tasks.list(), new Date(), notifyState, cfg);
  if (!due.length) return;
  notifyState.save();
  for (const n of due) pushNotification(n);
}
// Opens what a notification is about.
function openTarget(t) {
  if (!t) return;
  if (t.type === "chat") { focusWidget(); widget.webContents.send("open-chat"); }
  else if (t.type === "settings") openSettings(t.section);
  else if (t.type === "panel" && panelSpec(t.name)) showPanel(t.name, true);
  else if (t.type === "tasks") {
    showPanel("tasks", true);
    if (!t.taskId) return;
    const wc = panels.tasks.webContents;
    if (wc.isLoading()) wc.once("did-finish-load", () => wc.send("focus-task", t.taskId));
    else wc.send("focus-task", t.taskId);
  }
}
ipcMain.on("notify-open", (_e, id) => { const n = shownNotes.get(id); shownNotes.delete(id); if (n) openTarget(n.target); });
ipcMain.on("notify-dismiss", (_e, id) => shownNotes.delete(id));
ipcMain.on("notify-action", (_e, id, action) => {
  const n = shownNotes.get(id);
  shownNotes.delete(id);
  const taskId = n?.target?.taskId;
  if (action === "done" && taskId) tasks.update(taskId, { done: true });
  else if (action === "snooze" && taskId) notifyState.snooze(taskId);
  else if (action === "open" && n) openTarget(n.target);
});
// Nothing left to show: if the top widget was only shown for notifications, hide it again.
ipcMain.on("notify-idle", () => {
  if (shownForNotify && loadConfig().mainHidden && widget.isVisible()) widget.hide();
  shownForNotify = false;
});
// A chat reply finished. If you weren't looking at the chat, say so.
ipcMain.on("chat-finished", (_e, { watching, text, approvals }) => {
  if (watching) return;
  const preview = String(text || "").replace(/```[\s\S]*?```/g, "[code]").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  if (approvals) pushNotification({ kind: "approval", sticky: true, title: `${aiName()} needs your OK`, body: preview.slice(0, 120) || "Review the action in the chat.", target: { type: "chat" } });
  else pushNotification({ kind: "answer", title: `${aiName()} answered`, body: preview.slice(0, 120) || "Your answer is ready.", target: { type: "chat" } });
});
ipcMain.handle("set-notify", (_e, patch) => {
  const next = { ...notifyCfg(), ...patch };
  saveConfig({ notify: next });
  buildTray();
  return next;
});
ipcMain.handle("notify-test", () => pushNotification({ kind: "deadline", test: true, urgent: true, title: "Biology quiz", body: "Due in 15 min · this is a test notification",
  target: { type: "tasks" }, actions: [{ id: "open", label: "Open Tasks" }] }));
function pauseNotifications(minutes) {
  saveConfig({ notify: { ...notifyCfg(), pausedUntil: minutes ? Date.now() + minutes * 60_000 : 0 } });
  buildTray();
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
  if (!name || panelSpec(name).fixed) return;
  const [mw, mh] = panelSpec(name).min;
  const b = win.getBounds();
  win.setBounds({ ...b, width: Math.max(mw, Math.round(width)), height: Math.max(mh, Math.round(height)) });
});
// Resizing from any edge: when dragging the left/top edge, keep the opposite edge in place at the minimum size.
ipcMain.on("panel-set-bounds", (e, b) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const name = Object.keys(panels).find((n) => panels[n] === win);
  if (!name || panelSpec(name).fixed || !b) return;
  const [mw, mh] = panelSpec(name).min;
  const cur = win.getBounds();
  const width = Math.max(mw, Math.round(b.width)), height = Math.max(mh, Math.round(b.height));
  const x = b.anchorRight ? cur.x + cur.width - width : Math.round(b.x);
  const y = b.anchorBottom ? cur.y + cur.height - height : Math.round(b.y);
  win.setBounds({ x, y, width, height });
});
ipcMain.handle("capture", () => captureScreen());
ipcMain.handle("read-clipboard", () => clipboard.readText());
ipcMain.on("write-clipboard", (_e, text) => clipboard.writeText(text));
ipcMain.handle("get-config", () => {
  const cfg = loadConfig();
  const mode = activeMode();
  return { shortcuts: mode.shortcuts, mode: { id: mode.id, name: mode.name }, memoryEnabled: cfg.memoryEnabled, pill: cfg.pill, widgetStatus, panels: panelList(), aiName: aiName() };
});

// Folder button: every widget in a menu, plus open/hide all.
ipcMain.on("widgets-menu", () => {
  const list = panelList();
  Menu.buildFromTemplate([
    ...list.map((p) => ({ label: p.label, type: "checkbox", checked: p.visible, click: () => togglePanel(p.name) })),
    { type: "separator" },
    { label: "Open all", click: () => list.forEach((p) => showPanel(p.name)) },
    { label: "Hide all", click: () => list.forEach((p) => hidePanel(p.name)) },
    { type: "separator" },
    { label: "Manage widgets…", click: () => openSettings("widgets") },
  ]).popup({ window: widget });
});
// Open-all button: shows every widget, or hides them all if any are open. The chat bar stays as it is.
ipcMain.on("toggle-all-panels", () => {
  const list = panelList();
  if (list.some((p) => p.visible)) list.forEach((p) => hidePanel(p.name));
  else list.forEach((p) => showPanel(p.name));
});
ipcMain.handle("set-pill", (_e, pill) => {
  saveConfig({ pill: { ...DEFAULT_PILL, ...pill } });
  broadcast("pill-changed", loadConfig().pill);
  return true;
});
// Shortcut buttons belong to a mode (the active one unless another is named).
ipcMain.handle("set-shortcuts", (_e, shortcuts, modeId) => {
  const id = modeId || activeMode().id;
  saveModes(getModes().map((m) => (m.id === id ? { ...m, shortcuts } : m)));
  return true;
});
ipcMain.handle("reset-shortcuts", (_e, modeId) => {
  const id = modeId || activeMode().id;
  const defaults = (defaultModeFor(id) || defaultModeFor("general")).shortcuts;
  saveModes(getModes().map((m) => (m.id === id ? { ...m, shortcuts: defaults } : m)));
  return defaults;
});

// ---------- modes ----------
ipcMain.handle("get-modes", () => ({ modes: getModes(), active: activeMode().id }));
ipcMain.handle("set-active-mode", (_e, id) => setActiveMode(id));
ipcMain.on("modes-menu", () => {
  Menu.buildFromTemplate([
    { label: "Mode", enabled: false },
    ...modeMenuItems(),
    { type: "separator" },
    { label: "Edit modes…", click: () => openSettings("modes") },
    { label: "Settings…", click: () => openSettings() },
  ]).popup({ window: widget });
});
// Create or update a mode (name, description, instructions, shortcuts).
ipcMain.handle("save-mode", (_e, mode) => {
  const modes = getModes();
  const clean = {
    id: mode.id || `m${Date.now().toString(36)}`,
    name: String(mode.name || "New mode").trim().slice(0, 24) || "New mode",
    description: String(mode.description || "").slice(0, 200),
    instructions: String(mode.instructions || "").slice(0, 4000),
    shortcuts: Array.isArray(mode.shortcuts) ? mode.shortcuts : (modes.find((m) => m.id === mode.id)?.shortcuts || GENERAL_SHORTCUTS),
  };
  const existing = modes.find((m) => m.id === clean.id);
  saveModes(existing ? modes.map((m) => (m.id === clean.id ? { ...m, ...clean } : m)) : [...modes, clean]);
  return { modes: getModes(), active: activeMode().id, saved: clean.id };
});
ipcMain.handle("delete-mode", (_e, id) => {
  if (id === "general") return { modes: getModes(), active: activeMode().id };
  if (activeMode().id === id) saveConfig({ activeMode: "general" });
  saveModes(getModes().filter((m) => m.id !== id));
  return { modes: getModes(), active: activeMode().id };
});
// Built-in modes can be put back the way they shipped.
ipcMain.handle("restore-mode", (_e, id) => {
  const d = defaultModeFor(id);
  if (d) saveModes(getModes().map((m) => (m.id === id ? { ...d } : m)));
  return { modes: getModes(), active: activeMode().id };
});
// Claude designs a mode from a description: name, instructions and shortcut buttons.
ipcMain.handle("build-mode", async (_e, request) => {
  if (!String(request || "").trim()) return { ok: false, error: "Describe the mode first." };
  const res = await runAI({ cwd: workDir(), prompt: modeBuildPrompt(String(request).trim()), tools: "", jsonSchema: MODE_SCHEMA, effort: "medium", persist: false }).done;
  if (res.error) return { ok: false, error: aiError(res.error) };
  if (res.json.is_error) return { ok: false, error: aiError(res.json.result) };
  let m = res.json.structured_output;
  if (!m) { try { m = JSON.parse(res.json.result); } catch {} }
  if (!m?.name) return { ok: false, error: "Claude didn't return a mode. Try describing it again." };
  const shortcuts = [
    GENERAL_SHORTCUTS[0], // "What did I just do?"
    ...(m.shortcuts || []).slice(0, 6).map((s, i) => ({ id: `c${Date.now().toString(36)}${i}`, label: String(s.label).slice(0, 28), prompt: String(s.prompt), screenshot: !!s.screenshot, autoSend: true })),
    GENERAL_SHORTCUTS[GENERAL_SHORTCUTS.length - 1], // "Find tasks"
  ];
  const id = `m${Date.now().toString(36)}`;
  saveModes([...getModes(), { id, name: String(m.name).slice(0, 24), description: m.description || "", instructions: m.instructions || "", shortcuts }]);
  return { ok: true, id, modes: getModes(), active: activeMode().id };
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
    theme: cfg.theme, pill: cfg.pill, shortcuts: getShortcuts(), hotkeys: cfg.hotkeys, modes: getModes(), activeMode: activeMode().id,
    memoryEnabled: cfg.memoryEnabled, autoScan: cfg.autoScan, notesSync: cfg.notesSync !== false, autoAllow: cfg.autoAllow, chatSpeed: cfg.chatSpeed || "balanced", auth: authStatus(),
    openAtLogin: getOpenAtLogin(), notify: notifyCfg(),
    panels: panelList(), building, version: app.getVersion(),
  };
});
// Simple on/off and list settings.
ipcMain.handle("set-setting", (_e, key, value) => {
  if (key === "memoryEnabled" || key === "autoScan" || key === "notesSync") saveConfig({ [key]: !!value });
  else if (key === "autoAllow" && Array.isArray(value)) { saveConfig({ autoAllow: value.map(String) }); chat.warm(); }
  else if (key === "chatSpeed" && CHAT_SPEEDS[value]) { saveConfig({ chatSpeed: value }); chat.warm(); }
  else if (key === "openAtLogin") setOpenAtLogin(!!value);
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

// Start at sign-in: a "Cloak" value under HKCU\...\Run. Electron's setLoginItemSettings leaves paths with spaces
// unquoted (so Windows can't start it) and can't read its own entry back, so Cloak writes and reads the value itself.
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const APPROVED_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
const RUN_NAME = "Cloak";
const LEGACY_RUN_NAME = "electron.app.Electron"; // what earlier versions wrote when run unpackaged

function loginCommand() {
  // Unpackaged (electron.exe <folder>), Windows needs the folder as an argument to start the right app.
  return app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${app.getAppPath()}"`;
}
function reg(...args) {
  return execFileSync("reg.exe", args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
}
function readReg(key, name) {
  try { return reg("query", key, "/v", name).match(/REG_\w+\s+(.*)/)?.[1].trim() ?? null; } catch { return null; }
}
function deleteReg(key, name) {
  try { reg("delete", key, "/v", name, "/f"); } catch {}
}
function getOpenAtLogin() {
  if (readReg(RUN_KEY, RUN_NAME) === null) return false;
  // Turned off in Task Manager's Startup apps: the first byte is odd (03) when disabled.
  const approved = readReg(APPROVED_KEY, RUN_NAME);
  return !approved || !(parseInt(approved.slice(0, 2), 16) & 1);
}
function setOpenAtLogin(on) {
  deleteReg(APPROVED_KEY, RUN_NAME); // clears a Task Manager "disabled" so turning it on here really turns it on
  if (on) {
    try { writeRunValue(); } catch (e) { console.error("start at sign-in:", e.message); }
  } else deleteReg(RUN_KEY, RUN_NAME);
}
function writeRunValue() {
  reg("add", RUN_KEY, "/v", RUN_NAME, "/t", "REG_SZ", "/d", loginCommand(), "/f");
}
// On launch: replace the old unquoted entry, and point an existing entry at this copy if the folder moved or was renamed.
function syncLoginItem() {
  if (process.env.CLOAK_DATA_DIR || process.env.OVERCLAUDE_DATA_DIR) return; // test or portable profile: leave it alone
  const legacy = readReg(RUN_KEY, LEGACY_RUN_NAME);
  const hadLegacy = !!legacy && /cloak|overclaude|claude-overlay/i.test(legacy);
  if (hadLegacy) deleteReg(RUN_KEY, LEGACY_RUN_NAME);
  const current = readReg(RUN_KEY, RUN_NAME);
  if ((current !== null || hadLegacy) && current !== loginCommand()) writeRunValue();
}

function panelList() {
  const cfg = loadConfig();
  const list = ["tasks", "notes", "listen"].map((name) => ({ name, label: PANELS[name].label, builtin: true, editable: EDITABLE_BUILTINS.has(name),
    customized: isCustomized(name), canUndo: isCustomized(name) && widgets.canUndo(name), active: name === "listen" && !!listener?.listening }));
  for (const m of widgets.list().filter((w) => !PANELS[w.id])) list.push({ name: m.id, label: m.name, description: m.description, builtin: false, canUndo: widgets.canUndo(m.id), updated: m.updated });
  return list.map((p) => ({ ...p, enabled: cfg.panelEnabled[p.name] !== false, visible: !!panels[p.name]?.isVisible() }));
}
ipcMain.handle("panel-enabled", (_e, name, on) => {
  saveConfig({ panelEnabled: { ...loadConfig().panelEnabled, [name]: !!on } });
  notifyPanels();
  return panelList();
});
ipcMain.handle("panel-show", (_e, name) => { showPanel(name); return panelList(); });

// ---------- sign-in: Claude subscription or Anthropic API key ----------
// The API key is stored encrypted with Windows' own protection (safeStorage) and only ever handed to the CLI.
function loadAuth() {
  const cfg = loadConfig();
  let apiKey = null;
  if (cfg.authMode === "apiKey" && cfg.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try { apiKey = safeStorage.decryptString(Buffer.from(cfg.apiKeyEnc, "base64")); } catch {}
  }
  setAuth({ mode: cfg.authMode, apiKey, configDir: path.join(userData(), "claude-apikey") });
}
const authSignature = () => { const c = loadConfig(); return `${c.authMode || "subscription"}:${(c.apiKeyEnc || "").slice(-16)}`; };
function authStatus() {
  const cfg = loadConfig();
  return {
    mode: cfg.authMode === "apiKey" ? "apiKey" : "subscription",
    keyHint: cfg.apiKeyHint || null,
    claudeInstalled: !!findClaude(),
    onboarded: !!cfg.onboarded,
    provider: provider(),
    aiName: aiName(),
    // Checking ChatGPT's sign-in runs the Codex CLI, so only when ChatGPT is the one in use.
    codex: provider() === "chatgpt" ? codex.loginStatus() : null,
  };
}
ipcMain.handle("set-provider", (_e, p) => {
  if (!["claude", "chatgpt"].includes(p)) return authStatus();
  if (p !== provider()) {
    saveConfig({ provider: p });
    chat.kill();
    chat = makeChat(); // a new conversation: one AI can't continue the other's
    fs.rmSync(chatHistoryPath(), { force: true });
    pendingApprovals = new Map();
    writeInstructions();
    broadcast("ai-changed", aiName());
  }
  return authStatus();
});
ipcMain.handle("codex-status", () => codex.loginStatus(true));
ipcMain.on("install-codex", () => openTerminal(
  "Write-Host 'Installing the Codex CLI (OpenAI, from npm), which Cloak uses for ChatGPT...' -ForegroundColor Cyan; " +
  "npm install -g @openai/codex; Write-Host ''; " +
  "Write-Host 'Done. Go back to Cloak and click Sign in next to ChatGPT. You can close this window.' -ForegroundColor Green"));
ipcMain.on("open-codex-login", () => {
  const exe = codex.findCodex();
  if (!exe) return;
  openTerminal(
    "Write-Host 'Sign in to ChatGPT:' -ForegroundColor Cyan; " +
    "Write-Host '  Choose Sign in with ChatGPT and finish in your browser, then go back to Cloak and click Check.'; Write-Host ''; " +
    `& '${exe.replace(/'/g, "''")}' login`);
});
ipcMain.handle("auth-status", () => authStatus());
ipcMain.handle("auth-set", (_e, { mode, apiKey }) => {
  const patch = { authMode: mode === "apiKey" ? "apiKey" : "subscription" };
  if (mode === "apiKey" && apiKey) {
    const key = String(apiKey).trim();
    if (!/^sk-ant-[\w-]{20,}$/.test(key)) return { ok: false, error: "That doesn't look like an Anthropic API key. It should start with sk-ant-." };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: "Windows can't store the key securely on this account." };
    patch.apiKeyEnc = safeStorage.encryptString(key).toString("base64");
    patch.apiKeyHint = `sk-ant-…${key.slice(-4)}`;
  }
  if (patch.authMode === "apiKey" && !patch.apiKeyEnc && !loadConfig().apiKeyEnc) return { ok: false, error: "Paste your API key first." };
  saveConfig(patch);
  loadAuth();
  chat.kill();
  chat.warm();
  return { ok: true, status: authStatus() };
});
// A tiny real request, to confirm Claude answers with the chosen sign-in.
ipcMain.handle("auth-test", async () => {
  if (provider() === "chatgpt") {
    const st = codex.loginStatus(true);
    if (!st.installed) return { ok: false, error: codex.NOT_FOUND_MSG };
    if (!st.loggedIn) return { ok: false, error: aiError("not logged in") };
    const r = await codex.runCodex({ cwd: workDir(), prompt: "Reply with just the word: ready", effort: "low" }).done;
    return r.error ? { ok: false, error: aiError(r.error) } : { ok: true };
  }
  if (!findClaude()) return { ok: false, error: "Claude Code isn't installed yet." };
  const res = await runAI({ cwd: workDir(), prompt: "Reply with just the word: ready", tools: "", model: "haiku", effort: "low", persist: false }).done;
  if (res.error) return { ok: false, error: aiError(res.error) };
  if (res.json.is_error) return { ok: false, error: aiError(res.json.result) };
  return { ok: true };
});
// Opens a visible PowerShell window. Used for the official Claude Code installer and for signing in.
function openTerminal(script) {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // signing in should use your Claude account, not a key from the environment
  openTerminalWindow(script, { env });
}
ipcMain.on("install-claude", () => openTerminal(
  "Write-Host 'Installing Claude Code (official installer from claude.ai)...' -ForegroundColor Cyan; " +
  "irm https://claude.ai/install.ps1 | iex; Write-Host ''; " +
  "Write-Host 'Done. Go back to Cloak and click Check again. You can close this window.' -ForegroundColor Green"));
ipcMain.on("open-claude-login", () => {
  const exe = findClaude();
  if (!exe) return;
  openTerminal(
    "Write-Host 'Sign in to Claude:' -ForegroundColor Cyan; " +
    "Write-Host '  1. Type /login and press Enter'; " +
    "Write-Host '  2. Choose your Claude account (Pro or Max), not Anthropic Console'; " +
    "Write-Host '  3. Finish in your browser, then type /exit and go back to Cloak'; Write-Host ''; " +
    `& '${exe.replace(/'/g, "''")}'`);
});
// Only a few known pages can be opened from the setup screens.
ipcMain.on("open-external", (_e, url) => {
  if (/^https:\/\/(console\.anthropic\.com|claude\.ai|claude\.com|code\.claude\.com|nodejs\.org|github\.com\/Hxmz-Coder|chatgpt\.com|learn\.chatgpt\.com)\//.test(String(url))) shell.openExternal(url);
});

// ---------- welcome / setup ----------
function openWelcome(step) {
  showPanel("welcome", true);
  if (!step) return;
  const wc = panels.welcome.webContents;
  if (wc.isLoading()) wc.once("did-finish-load", () => wc.send("welcome-step", step));
  else wc.send("welcome-step", step);
}
ipcMain.on("open-welcome", (_e, step) => openWelcome(step));
// Settings > General > Restart: start a fresh copy, then quit this one normally (windows close, so anything
// half-typed in Notes is saved first).
ipcMain.on("restart-app", () => { app.relaunch(); app.quit(); });
ipcMain.handle("welcome-done", (_e, { profile, mode }) => {
  saveConfig({ onboarded: true, profile: profile || {} });
  if (mode) setActiveMode(mode);
  hidePanel("welcome");
  focusWidget();
  widget.webContents.send("open-bar");
  return true;
});
// Buttons in the welcome tour that show the real thing.
ipcMain.on("tour", (_e, what) => {
  if (what === "bar") { focusWidget(); widget.webContents.send("open-bar"); }
  if (what === "panels") { showPanel("tasks"); showPanel("notes"); }
  if (what === "settings") openSettings();
  if (what === "modes") { focusWidget(); widget.webContents.send("open-bar"); }
});

// ---------- custom widgets ----------
ipcMain.handle("widget-delete", (_e, id) => {
  if (PANELS[id] || !widgets.meta(id)) return panelList();
  destroyPanel(id);
  widgets.remove(id);
  const cfg = loadConfig();
  const { [id]: _b, ...bounds } = cfg.panelBounds;
  const { [id]: _en, ...enabled } = cfg.panelEnabled;
  saveConfig({ panelBounds: bounds, panelEnabled: enabled, pill: { ...cfg.pill, widgets: (cfg.pill.widgets || []).filter((w) => w !== id) } });
  delete widgetStatus[id];
  broadcast("pill-changed", loadConfig().pill);
  return panelList();
});
// Back to the built-in Tasks or Notes (your tasks and notes themselves aren't touched).
ipcMain.handle("widget-restore", (_e, id) => {
  if (!isCustomized(id)) return panelList();
  const wasVisible = !!panels[id]?.isVisible();
  destroyPanel(id);
  widgets.remove(id);
  createPanel(id);
  if (wasVisible) showPanel(id);
  return panelList();
});
function builtinSource(name) {
  const read = (f) => { try { return fs.readFileSync(path.join(__dirname, f), "utf8"); } catch { return ""; } };
  return { name: PANELS[name].label, html: read(PANELS[name].file), js: read(PANELS[name].file.replace(/\.html$/, ".js")) };
}
ipcMain.handle("widget-undo", (_e, id) => {
  if (widgets.undo(id)) panels[id]?.reload();
  return panelList();
});

// Claude writes (or changes) a widget from your description, then it's installed and shown.
ipcMain.handle("widget-build", async (_e, { request, id }) => {
  if (building) return { ok: false, error: "Claude is already building a widget. Wait for it to finish." };
  if (!String(request || "").trim()) return { ok: false, error: "Describe the widget first." };
  if (id && !widgets.meta(id) && !EDITABLE_BUILTINS.has(id)) return { ok: false, error: "That widget no longer exists." };
  building = true;
  const progress = (msg) => panels.settings?.webContents.send("build-progress", msg);
  try {
    // First change to Tasks or Notes: Claude starts from the built-in panel's code.
    const fromBuiltin = EDITABLE_BUILTINS.has(id) && !widgets.meta(id);
    const existing = !id ? null : fromBuiltin
      ? { meta: { name: PANELS[id].label, request: `The built-in ${PANELS[id].label} widget` }, builtin: builtinSource(id) }
      : { meta: widgets.meta(id), source: widgets.source(id) };
    let prompt = buildPrompt(String(request).trim(), existing);
    for (let attempt = 1; attempt <= 2; attempt++) {
      progress(attempt === 1 ? (id ? "Claude is changing the widget…" : "Claude is designing and coding your widget…") : "Fixing a problem in the code…");
      const res = await runAI({ cwd: workDir(), prompt, tools: "", jsonSchema: BUILD_SCHEMA, effort: "high", persist: false, timeoutMs: 10 * 60_000 }).done;
      if (res.error) return { ok: false, error: aiError(res.error) };
      if (res.json.is_error) return { ok: false, error: aiError(res.json.result) };
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
      const meta = widgets.save({ ...build, ...(fromBuiltin ? { name: PANELS[id].label } : {}), request: fullRequest }, id);
      if (fromBuiltin) { destroyPanel(id); showPanel(id); } // swap the built-in window for Claude's version
      else if (id) panels[id]?.reload();
      else showPanel(meta.id);
      // Builds take a minute or two; if you went off to do something else, tell you it's ready.
      if (!panels.settings?.isFocused()) pushNotification({ kind: "built", title: `${meta.name} is ready`, body: id ? "Claude finished changing it." : "Claude built your new widget.", target: { type: "panel", name: meta.id } });
      return { ok: true, widget: meta, panels: panelList() };
    }
  } finally {
    building = false;
    progress(null); // build over: lets a Settings page that didn't start it (or reloaded mid-build) stop its spinner
  }
});

// The API custom widgets call (see widget-preload.js). The widget is identified by which window is calling.
const askLog = new Map(); // widget id -> recent ask timestamps
const widgetNotifyAt = new Map(); // widget id -> when it last popped a notification
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
    case "tasks.clearDone": tasks.clearDone(); return true;
    case "tasks.scan": {
      const recent = (askLog.get(id) || []).filter((t) => t > Date.now() - 3600_000);
      if (recent.length >= 30) throw new Error("This widget has asked Claude too many times this hour.");
      askLog.set(id, [...recent, Date.now()]);
      return scanTasks({ activity: true, notes: true });
    }
    case "notes.get": return readNotes();
    // Only your Notes widget (Claude's version of it) may change your notes.
    case "notes.set":
      if (id !== "notes") throw new Error("Only the Notes widget can change your notes.");
      fs.writeFileSync(notesPath(), String(args[0] ?? ""));
      if (loadConfig().notesSync !== false) scheduleNotesSync();
      return true;
    case "notes.syncNow":
      if (id !== "notes") throw new Error("Only the Notes widget can sync your notes.");
      return syncNotes(true);
    case "pill.setStatus": {
      // A short line the widget offers for the top pill (shown if you pick it in Settings > Top widget).
      const text = args[0] == null ? "" : String(args[0]).replace(/\s+/g, " ").trim().slice(0, 60);
      widgetStatus[id] = text;
      widget?.webContents.send("widget-status", { id, text });
      return true;
    }
    case "pill.notify": {
      // Something happening right now (e.g. "Now: Dentist"): a notification, at most once a minute per widget.
      // (The pill itself only ever shows what you chose in Settings.)
      const text = args[0] == null ? "" : String(args[0]).replace(/\s+/g, " ").trim().slice(0, 50);
      const last = widgetNotifyAt.get(id) || 0;
      if (text && Date.now() - last > 60_000) {
        widgetNotifyAt.set(id, Date.now());
        pushNotification({ kind: "widget", urgent: true, title: panelSpec(id)?.label || "Widget", body: text, target: { type: "panel", name: id } });
      }
      return true;
    }
    case "ask": {
      // Keep a misbehaving widget from burning through your usage.
      const recent = (askLog.get(id) || []).filter((t) => t > Date.now() - 3600_000);
      if (recent.length >= 30) throw new Error("This widget has asked Claude too many times this hour.");
      askLog.set(id, [...recent, Date.now()]);
      const res = await runAI({ cwd: workDir(), prompt: String(args[0] || "").slice(0, 20000), tools: "", effort: "low", persist: false }).done;
      if (res.error) throw new Error(aiError(res.error));
      if (res.json.is_error) throw new Error(aiError(res.json.result));
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
  chat.reset();
  fs.rmSync(chatHistoryPath(), { force: true });
  pendingApprovals = new Map();
  declinedNote = "";
  clearChatScreenshots();
  return true;
});
ipcMain.handle("stop", () => { chat.stop(); return true; });
ipcMain.handle("chat-history", () => loadHistory().messages);

ipcMain.handle("ask", async (_e, { text, image }) => {
  let prompt = text || "What's on my screen?";
  if (image) {
    const name = `shot-${Date.now()}.png`;
    fs.writeFileSync(path.join(chatShotsDir(), name), Buffer.from(image, "base64"));
    prompt = `[I attached a screenshot of my screen: ./screenshots/${name}]\n\n${prompt}`;
  }
  return chatTurn(prompt, { display: text || "What's on my screen?", image: !!image });
});

ipcMain.handle("recap", async () => {
  if (!loadConfig().memoryEnabled) return { ok: false, error: "Screen memory is off. Turn it on from the tray icon so I can keep track of what you're doing." };
  const prompt = recapPrompt(30);
  if (!prompt) return { ok: false, error: "I don't have any recent activity yet. Screen memory needs a few minutes of use first." };
  return chatTurn(prompt, { display: "What did I just do?" });
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
    { extraAllowed: chosen.map((a) => a.rule) },
  );
});
ipcMain.handle("decline", (_e, { ids }) => {
  const chosen = ids.map((id) => pendingApprovals.get(id)).filter(Boolean);
  for (const a of chosen) pendingApprovals.delete(a.id);
  if (chosen.length) declinedNote = `the user declined: ${chosen.map((a) => `${a.title} (${a.detail})`).join("; ")}. Don't retry those.`;
  return true;
});

ipcMain.handle("scan-tasks", (_e, sources) => scanTasks(sources));

// ---------- Listen (lib/listen.js) ----------
// What's been playing on the computer lately, for the chat's context while Listen is on.
const listenContext = (minutes) => (listener?.listening ? listener.recent(minutes, 3000) : "");
function makeListener() {
  return new Listener(path.join(userData(), "voice"), {
    emit: (ch, data) => { panels.listen?.webContents.send(ch, data); if (ch === "listen-state") notifyPanels(); },
    runAI: (opts) => runAI({ cwd: workDir(), tools: "", persist: false, ...(provider() === "claude" ? { model: (CHAT_SPEEDS[loadConfig().chatSpeed] || CHAT_SPEEDS.balanced).model } : {}), ...opts }),
    aiError: (t) => aiError(t),
    memories: () => memories.context(),
    today: () => todayLine(),
    addTasks: (items) => {
      const added = tasks.add(items, "claude");
      if (added.length) pushNotification({ kind: "found", title: `Added ${added.length} task${added.length > 1 ? "s" : ""} from Listen`,
        body: added.map((t) => t.title).slice(0, 2).join(", "), target: { type: "tasks", taskId: added[0].id } });
    },
    onImportant: (item) => pushNotification({ kind: "listen", urgent: true, title: "Listen", body: item.text, target: { type: "panel", name: "listen" } }),
  });
}
ipcMain.handle("listen-status", () => listener.status());
ipcMain.handle("listen-install", () => listener.install());
ipcMain.handle("listen-start", () => listener.start());
ipcMain.handle("listen-stop", () => { listener.stop(); return true; });
ipcMain.handle("listen-clear", () => { listener.clear(); return true; });
ipcMain.handle("listen-set-auto", (_e, on) => { listener.auto = !!on; saveConfig({ listenAuto: !!on }); return listener.status(); });
ipcMain.handle("listen-respond-now", () => listener.respond());
ipcMain.handle("listen-ask", (_e, q) => listener.ask(q));
// A clip of the computer's sound from the Listen panel (16 kHz mono Float32Array).
ipcMain.handle("voice-transcribe", (e, pcm) => {
  if (e.sender && panels.listen?.webContents !== e.sender) return { error: "Not the Listen panel." }; // (no sender: a test script)
  return listener.transcribe(pcm instanceof Float32Array ? pcm : new Float32Array(pcm || []));
});
// Settings > Memory
ipcMain.handle("memories-list", () => memories.list());
ipcMain.handle("memories-add", (_e, text) => { memories.add(String(text || "").split(/\r?\n/), "me"); return memories.list(); });
ipcMain.handle("memories-update", (_e, id, text) => { memories.update(id, text); return memories.list(); });
ipcMain.handle("memories-remove", (_e, id) => { memories.remove(id); return memories.list(); });
ipcMain.handle("memories-clear", () => { memories.clear(); return memories.list(); });
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
ipcMain.handle("notes-set", (_e, text) => {
  fs.writeFileSync(notesPath(), String(text));
  if (loadConfig().notesSync !== false) scheduleNotesSync();
  return true;
});
ipcMain.handle("notes-sync-now", () => syncNotes(true));

// Notes turn into tasks on their own: a little while after you stop typing, Claude reads the changed notes.
// At most once a minute, and only when the notes actually changed.
const NOTES_SYNC_DELAY_MS = 20_000;
let notesSyncTimer = null, lastNotesSync = 0;
function scheduleNotesSync(delay = NOTES_SYNC_DELAY_MS) {
  clearTimeout(notesSyncTimer);
  notesSyncTimer = setTimeout(() => syncNotes(false), delay);
}
async function syncNotes(force) {
  const text = readNotes().trim();
  const send = (state) => panels.notes?.webContents.send("notes-sync", state);
  if (!text) return send({ state: "idle" });
  if (!force && text === notesScannedText) return send({ state: "done", added: [] });
  if (scanning) return scheduleNotesSync(15_000);
  const wait = 60_000 - (Date.now() - lastNotesSync);
  if (!force && wait > 0) return scheduleNotesSync(wait);
  lastNotesSync = Date.now();
  send({ state: "syncing" });
  const r = await scanTasks({ activity: false, notes: true });
  send(r.error ? { state: "error", error: r.error } : { state: "done", added: r.added });
  return r;
}

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
    { label: "Listen", click: () => togglePanel("listen") },
    { label: "Mode", submenu: modeMenuItems() },
    { label: "Settings", click: () => openSettings() },
    { label: "Setup guide", click: () => openWelcome() },
    { type: "separator" },
    { label: "Screen memory", type: "checkbox", checked: cfg.memoryEnabled, click: (i) => { saveConfig({ memoryEnabled: i.checked }); buildTray(); } },
    { label: "Find tasks automatically", type: "checkbox", checked: cfg.autoScan, click: (i) => { saveConfig({ autoScan: i.checked }); buildTray(); } },
    notifyCfg().pausedUntil > Date.now()
      ? { label: `Resume notifications (paused until ${new Date(notifyCfg().pausedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})`, click: () => pauseNotifications(0) }
      : { label: "Pause notifications for 1 hour", click: () => pauseNotifications(60) },
    { label: "Clear screen memory", click: () => memory.clear() },
    { label: "Reset \"always allow\" choices", enabled: cfg.autoAllow.length > 0, click: () => { saveConfig({ autoAllow: [] }); buildTray(); } },
    { label: "Reset widget positions", click: () => { saveConfig({ panelBounds: {} }); for (const n of Object.keys(panels)) panels[n].setBounds(defaultBounds(n)); } },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]));
}

// ---------- startup ----------
app.whenReady().then(() => {
  try { syncLoginItem(); } catch {}
  fs.mkdirSync(workDir(), { recursive: true });
  writeInstructions();
  clearChatScreenshots();

  tasks = new TaskStore(path.join(userData(), "tasks.json"), (list) => broadcast("tasks-changed", list));
  memories = new MemoryStore(path.join(userData(), "memories.json"), (list) => broadcast("memories-changed", list));
  listener = makeListener();
  listener.auto = loadConfig().listenAuto !== false;
  // The computer's sound for Listen: Windows "loopback" capture. Only the Listen panel may ask for it.
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    if (!panels.listen || req.frame?.url !== panels.listen.webContents.getURL()) return cb({});
    desktopCapturer.getSources({ types: ["screen"] }).then((s) => cb({ video: s[0], audio: "loopback" })).catch(() => cb({}));
  });
  memory = new ScreenMemory({
    dir: path.join(workDir(), "memory"),
    isEnabled: () => loadConfig().memoryEnabled,
    onWelcomeBack: (minutes) => widget.webContents.send("welcome-back", minutes),
  });
  memory.start();
  loadAuth();
  chat = makeChat();
  const saved = loadHistory();
  if ((saved.provider || "claude") === provider()) chat.sessionId = saved.sessionId; // continue the last conversation
  chat.warm(); // start Claude now so the first message is quick
  notesScannedText = readNotes().trim(); // only rescan notes after they change
  setInterval(autoScan, AUTO_SCAN_EVERY_MS);
  notifyState = new NotifyState(path.join(userData(), "notify-state.json"));
  setTimeout(checkTaskNotifications, 8000); // after the top widget has loaded
  setInterval(checkTaskNotifications, 30_000);
  // A paused tray label goes stale when the pause ends; refresh it now and then.
  setInterval(() => { if (notifyCfg().pausedUntil && notifyCfg().pausedUntil < Date.now()) pauseNotifications(0); }, 60_000);

  widget = makeWindow("index.html", WIDGET.pill);
  placeWidget("pill");
  widget.once("ready-to-show", () => {
    if (!loadConfig().mainHidden) widget.showInactive();
    if (!loadConfig().onboarded) openWelcome(); // first launch: the setup guide
  });
  widgets = new WidgetStore(path.join(userData(), "widgets"));
  setupWidgetSession();
  createPanel("tasks");
  createPanel("notes");
  createPanel("listen");
  for (const m of widgets.list()) if (!PANELS[m.id]) createPanel(m.id); // Claude's Tasks/Notes were created just above

  const failed = registerHotkeys(loadConfig().hotkeys);
  if (failed.length) registerHotkeys(DEFAULT_HOTKEYS); // a saved shortcut is taken now: fall back to the defaults

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 16, height: 16 }));
  tray.setToolTip(`Cloak ${app.getVersion()}`);
  tray.on("click", toggleAll);
  buildTray();
});

app.on("will-quit", () => { globalShortcut.unregisterAll(); memory?.stop(); chat?.kill(); listener?.stop(); });
// Also clean up when Cloak exits without a normal quit (app.exit, a crash handler, etc.); the screen-memory
// helper would otherwise keep the process from closing.
process.on("exit", () => { try { memory?.stop(); chat?.kill(); } catch {} });
module.exports = { toggleAll, checkTaskNotifications }; // for test scripts
app.on("window-all-closed", (e) => e.preventDefault());
