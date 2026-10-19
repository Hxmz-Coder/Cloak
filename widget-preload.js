// The only API a custom widget gets. Widgets run sandboxed (no Node.js, no network); everything goes through here.
const { contextBridge, ipcRenderer } = require("electron");

const call = (name, ...args) => ipcRenderer.invoke("widget-api", name, ...args);
const pad = (n) => String(n).padStart(2, "0");

contextBridge.exposeInMainWorld("overlay", {
  storage: {
    get: (key) => call("storage.get", key),
    set: (key, value) => call("storage.set", key, value),
    all: () => call("storage.all"),
  },
  tasks: {
    list: () => call("tasks.list"),
    add: (task) => call("tasks.add", task),
    update: (id, patch) => call("tasks.update", id, patch),
    remove: (id) => call("tasks.remove", id),
    onChange: (cb) => ipcRenderer.on("tasks-changed", (_e, list) => cb(list)),
    clearDone: () => call("tasks.clearDone"),
    scan: () => call("tasks.scan"),
    onFocus: (cb) => ipcRenderer.on("focus-task", (_e, id) => cb(id)),
  },
  notes: {
    get: () => call("notes.get"),
    // only in the Notes widget (Claude's version of it)
    set: (text) => call("notes.set", text),
    syncNow: () => call("notes.syncNow"),
    onSync: (cb) => ipcRenderer.on("notes-sync", (_e, s) => cb(s)),
  },
  pill: {
    setStatus: (text) => call("pill.setStatus", text),
    notify: (text, minutes) => call("pill.notify", text, minutes),
  },
  ask: (prompt) => call("ask", prompt),
  openChat: (prompt) => ipcRenderer.send("widget-open-chat", String(prompt || "")),
  today: () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; },

  // used by the frame (panel.js, theme.js)
  hidePanel: () => ipcRenderer.send("hide-panel"),
  resizePanel: (w, h) => ipcRenderer.send("panel-resize", w, h),
  setPanelBounds: (b) => ipcRenderer.send("panel-set-bounds", b),
  getTheme: () => ipcRenderer.invoke("get-theme"),
  onTheme: (cb) => ipcRenderer.on("theme", (_e, t) => cb(t)),
  onPanelShown: (cb) => ipcRenderer.on("panel-shown", () => cb()),
});
