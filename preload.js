const { contextBridge, ipcRenderer } = require("electron");

const on = (ch) => (cb) => ipcRenderer.on(ch, (_e, data) => cb(data));

contextBridge.exposeInMainWorld("overlay", {
  // main widget
  setMode: (m, size) => ipcRenderer.send("set-mode", m, size),
  focus: () => ipcRenderer.send("focus"),
  hideWidget: () => ipcRenderer.send("hide-widget"),
  ask: (payload) => ipcRenderer.invoke("ask", payload),
  recap: () => ipcRenderer.invoke("recap"),
  approve: (payload) => ipcRenderer.invoke("approve", payload),
  decline: (payload) => ipcRenderer.invoke("decline", payload),
  stop: () => ipcRenderer.invoke("stop"),
  reset: () => ipcRenderer.invoke("reset"),
  capture: () => ipcRenderer.invoke("capture"),
  readClipboard: () => ipcRenderer.invoke("read-clipboard"),
  writeClipboard: (t) => ipcRenderer.send("write-clipboard", t),
  getConfig: () => ipcRenderer.invoke("get-config"),
  setPill: (p) => ipcRenderer.invoke("set-pill", p),
  setShortcuts: (s, modeId) => ipcRenderer.invoke("set-shortcuts", s, modeId),
  resetShortcuts: (modeId) => ipcRenderer.invoke("reset-shortcuts", modeId),
  onCollapse: on("collapse"),
  onOpenBar: on("open-bar"),
  onBlur: on("blurred"),
  onTriggerCapture: on("trigger-capture"),
  onRunPrompt: on("run-prompt"),
  onWelcomeBack: on("welcome-back"),
  onTasksAdded: on("tasks-added"),
  onChatEvent: on("chat-event"),
  chatHistory: () => ipcRenderer.invoke("chat-history"),
  onWidgetStatus: on("widget-status"),
  onPillAlert: on("pill-alert"),
  onPanelsChanged: on("panels-changed"),
  widgetsMenu: () => ipcRenderer.send("widgets-menu"),
  toggleAllPanels: () => ipcRenderer.send("toggle-all-panels"),
  onOpenChat: on("open-chat"),
  chatFinished: (info) => ipcRenderer.send("chat-finished", info),

  // notifications (shown by the top widget)
  onNotify: on("notify"),
  notifyOpen: (id) => ipcRenderer.send("notify-open", id),
  notifyDismiss: (id) => ipcRenderer.send("notify-dismiss", id),
  notifyAction: (id, action) => ipcRenderer.send("notify-action", id, action),
  notifyIdle: () => ipcRenderer.send("notify-idle"),
  setNotify: (patch) => ipcRenderer.invoke("set-notify", patch),
  testNotify: () => ipcRenderer.invoke("notify-test"),

  // panels (tasks, notes)
  togglePanel: (name) => ipcRenderer.send("toggle-panel", name),
  hidePanel: () => ipcRenderer.send("hide-panel"),
  focusPanel: () => ipcRenderer.send("focus-panel"),
  resizePanel: (w, h) => ipcRenderer.send("panel-resize", w, h),
  setPanelBounds: (b) => ipcRenderer.send("panel-set-bounds", b),
  onPanelShown: on("panel-shown"),

  // tasks
  scanTasks: (sources) => ipcRenderer.invoke("scan-tasks", sources),
  listTasks: () => ipcRenderer.invoke("tasks-list"),
  addTask: (item) => ipcRenderer.invoke("tasks-add", item),
  updateTask: (id, patch) => ipcRenderer.invoke("tasks-update", id, patch),
  removeTask: (id) => ipcRenderer.invoke("tasks-remove", id),
  clearDone: () => ipcRenderer.invoke("tasks-clear-done"),
  taskHelp: (task) => ipcRenderer.send("task-help", task),
  onTasksChanged: on("tasks-changed"),
  onScanState: on("scan-state"),
  onFocusTask: on("focus-task"),

  // notes
  getNotes: () => ipcRenderer.invoke("notes-get"),
  setNotes: (text) => ipcRenderer.invoke("notes-set", text),
  syncNotesNow: () => ipcRenderer.invoke("notes-sync-now"),
  onNotesSync: on("notes-sync"),

  // modes
  getModes: () => ipcRenderer.invoke("get-modes"),
  setActiveMode: (id) => ipcRenderer.invoke("set-active-mode", id),
  modesMenu: () => ipcRenderer.send("modes-menu"),
  saveMode: (m) => ipcRenderer.invoke("save-mode", m),
  deleteMode: (id) => ipcRenderer.invoke("delete-mode", id),
  restoreMode: (id) => ipcRenderer.invoke("restore-mode", id),
  buildMode: (request) => ipcRenderer.invoke("build-mode", request),
  onModeChanged: on("mode-changed"),

  // sign-in and setup
  authStatus: () => ipcRenderer.invoke("auth-status"),
  setAuth: (a) => ipcRenderer.invoke("auth-set", a),
  testAuth: () => ipcRenderer.invoke("auth-test"),
  installClaude: () => ipcRenderer.send("install-claude"),
  openClaudeLogin: () => ipcRenderer.send("open-claude-login"),
  openExternal: (url) => ipcRenderer.send("open-external", url),
  openWelcome: (step) => ipcRenderer.send("open-welcome", step),
  onWelcomeStep: on("welcome-step"),
  welcomeDone: (payload) => ipcRenderer.invoke("welcome-done", payload),
  tour: (what) => ipcRenderer.send("tour", what),

  // theme (every window)
  getTheme: () => ipcRenderer.invoke("get-theme"),
  onTheme: on("theme"),
  onPillChanged: on("pill-changed"),
  onShortcutsChanged: on("shortcuts-changed"),

  // settings
  openSettings: (section) => ipcRenderer.send("open-settings", section),
  onSettingsSection: on("settings-section"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  setTheme: (t) => ipcRenderer.invoke("set-theme", t),
  setSetting: (key, value) => ipcRenderer.invoke("set-setting", key, value),
  setHotkey: (which, accel) => ipcRenderer.invoke("set-hotkey", which, accel),
  clearMemory: () => ipcRenderer.invoke("clear-memory"),
  resetPositions: () => ipcRenderer.invoke("reset-positions"),
  panelEnabled: (name, on) => ipcRenderer.invoke("panel-enabled", name, on),
  panelShow: (name) => ipcRenderer.invoke("panel-show", name),
  buildWidget: (payload) => ipcRenderer.invoke("widget-build", payload),
  deleteWidget: (id) => ipcRenderer.invoke("widget-delete", id),
  undoWidget: (id) => ipcRenderer.invoke("widget-undo", id),
  restoreWidget: (id) => ipcRenderer.invoke("widget-restore", id),
  onBuildProgress: on("build-progress"),
});
