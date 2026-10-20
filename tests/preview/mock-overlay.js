// A fake window.overlay for previewing app pages in a browser (see serve.js). onX(cb) registers a listener that
// the preview page fires with __mock.emit("onX", data); everything else resolves with sample data.
(() => {
  const pad = (n) => String(n).padStart(2, "0");
  const day = (off = 0) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const tasks = [
    { id: "t1", title: "Dentist", category: "other", due: day(0), time: "15:30", done: false, created: Date.now() - 3600e3, source: "me" },
    { id: "t2", title: "Chemistry lab report", category: "homework", due: day(1), done: false, created: Date.now() - 7200e3, source: "claude" },
    { id: "t3", title: "Reply to Prof. Lee", category: "email", done: false, created: Date.now() - 86400e3, source: "claude" },
  ];
  const panels = [
    { name: "tasks", label: "Tasks", builtin: true, customized: false, enabled: true, visible: false },
    { name: "notes", label: "Notes", builtin: true, customized: true, canUndo: true, enabled: true, visible: false },
    { name: "pomodoro-x", label: "Pomodoro", builtin: false, description: "A focus timer.", enabled: true, visible: false },
  ];
  const notify = { enabled: true, deadlines: true, checkins: true, digest: true, answers: true, found: true, widgets: true, sound: false, pausedUntil: 0 };
  const shortcuts = [{ id: "a", action: "recap", label: "What did I just do?" }, { id: "b", label: "Explain my screen", prompt: "x", screenshot: true }, { id: "c", action: "scan", label: "Find tasks" }];
  const data = {
    getConfig: { shortcuts, mode: { id: "general", name: "General" }, pill: { label: "Lock In", style: "island", nextTask: true, showMode: true, widgets: [], position: "center" }, panels, widgetStatus: {} },
    listTasks: tasks, chatHistory: [], getTheme: { accent: "#d97757", opacity: 0.95 }, getNotes: "Buy poster board\nStudy for bio quiz friday",
    getSettings: {
      theme: { accent: "#d97757", opacity: 0.95 }, pill: { label: "Lock In", style: "island", nextTask: true, widgets: [], position: "center" }, shortcuts,
      hotkeys: { toggle: "CommandOrControl+Shift+Space", capture: "CommandOrControl+Shift+S" },
      modes: [{ id: "general", name: "General", description: "", instructions: "", shortcuts, builtin: true }], activeMode: "general",
      memoryEnabled: true, autoScan: true, notesSync: true, autoAllow: [], chatSpeed: "balanced", auth: { mode: "subscription", onboarded: true, provider: "chatgpt", aiName: "ChatGPT", claudeInstalled: true, codex: { installed: true, loggedIn: false, detail: "Not logged in" } },
      openAtLogin: true, notify, panels, building: false, version: "1.1.0",
    },
    setNotify: notify, testNotify: true, codexStatus: { installed: true, loggedIn: true, detail: "Logged in using ChatGPT" }, getModes: { modes: [], active: "general" },
  };
  const handlers = {};
  const calls = [];
  window.__mock = { handlers, calls, emit: (name, d) => handlers[name]?.forEach((cb) => cb(d)) };
  window.overlay = new Proxy({}, {
    get: (_t, prop) => {
      if (typeof prop !== "string") return undefined;
      if (/^on[A-Z]/.test(prop)) return (cb) => { (handlers[prop] ||= []).push(cb); };
      return (...args) => {
        calls.push([prop, ...args]);
        window.parent?.postMessage({ mock: prop, args: JSON.parse(JSON.stringify(args)) }, "*");
        return Promise.resolve(prop in data ? data[prop] : true);
      };
    },
  });
})();
