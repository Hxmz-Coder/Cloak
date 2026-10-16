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
  setShortcuts: (s) => ipcRenderer.invoke("set-shortcuts", s),
  resetShortcuts: () => ipcRenderer.invoke("reset-shortcuts"),
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
  onPanelsChanged: on("panels-changed"),
  widgetsMenu: () => ipcRenderer.send("widgets-menu"),
  toggleAllPanels: () => ipcRenderer.send("toggle-all-panels"),

  // panels (tasks, notes)
  togglePanel: (name) => ipcRenderer.send("toggle-panel", name),
  hidePanel: () => ipcRenderer.send("hide-panel"),
  focusPanel: () => ipcRenderer.send("focus-panel"),
  resizePanel: (w, h) => ipcRenderer.send("panel-resize", w, h),
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

  // notes
  getNotes: () => ipcRenderer.invoke("notes-get"),
  setNotes: (text) => ipcRenderer.invoke("notes-set", text),

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
  onBuildProgress: on("build-progress"),
});
