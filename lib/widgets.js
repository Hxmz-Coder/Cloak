// Custom widgets that Claude writes for you.
//
// Each widget lives in <userData>/widgets/<id>/:
//   widget.json   name, description, size
//   source.json   the HTML/CSS/JS Claude wrote (kept so you can ask Claude to change it later)
//   index.html    the page we assemble around that source (frame, theme, safety policy)
//   data.json     the widget's own saved data (overlay.storage)
//   history/      earlier versions, so a change can be undone
//
// Widgets run sandboxed: no Node.js, no network, no files. They only get the small `overlay` API in widget-preload.js.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BUILD_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Short widget name, 1-3 words, e.g. 'Calendar'" },
    description: { type: "string", description: "One sentence: what the widget does" },
    html: { type: "string", description: "Markup for the widget body (no <html>, <head> or <body> tags, no <script> or <style>)" },
    css: { type: "string", description: "Styles for the widget body" },
    js: { type: "string", description: "Plain browser JavaScript that runs after the markup exists" },
    width: { type: "integer", description: "Initial width in px, 260-900" },
    height: { type: "integer", description: "Initial height in px, 200-800" },
  },
  required: ["name", "description", "html", "css", "js", "width", "height"],
  additionalProperties: false,
};

const API_DOC = `## What a widget is
A small always-on-top panel on the user's Windows desktop, next to their Claude chat bar, Tasks list and Notes. The host app already draws the frame: a draggable header with the widget's name and a minimize button, a resize grip, and the dark rounded panel itself. You only write the body.

## Output
- html: body markup only. It goes inside <div id="app"> which fills the panel below the header (display:flex; flex-direction:column; overflow:hidden). Make your root element fill it (flex:1; min-height:0) and scroll internally where needed.
- css: your styles. Scope them under #app.
- js: plain modern browser JavaScript (no modules, no imports, no frameworks, no external files, no network). It runs after the markup exists. Use async/await freely.
- width/height: a sensible starting size. The user can resize, so the layout must adapt (flex/grid, no fixed pixel widths for the whole layout).

## Look and feel (match the host)
Dark UI. Use these CSS variables, never hard-coded theme colors, so the user's accent color and opacity apply:
--text (main text), --muted (secondary text), --faint (tertiary), --panel (subtle surface, rgba), --panel-hi (hover surface), --border (hairlines), --accent (user's accent color), --accent-rgb (e.g. "217, 119, 87", use as rgba(var(--accent-rgb), .2)), --on-accent (text on accent), --ok (green), --warn (amber).
Font is already set (13.5px Segoe UI). Ready-made classes: button.btn, button.btn.primary, button.btn.ghost, button.icon-btn (28px square, put a 16px inline SVG inside, stroke="currentColor", fill="none"), and inputs/selects/textareas are pre-styled. Corners 8-10px. Keep it clean, compact and calm; no emojis unless asked.

## The overlay API (window.overlay); all methods return Promises unless noted
- overlay.storage.get(key) -> value or null; overlay.storage.set(key, value); overlay.storage.all() -> object. JSON-serializable values, saved per widget, survives restarts. Use this for any data the widget owns.
- overlay.tasks.list() -> [{ id, title, category: "homework"|"email"|"unfinished"|"other", due: "YYYY-MM-DD" | undefined, time: "HH:MM" (24h) | undefined, done: boolean, created: ms timestamp, doneAt?: ms, source: "me"|"claude", note?: string }]
- overlay.tasks.add({ title, category?, due?, time? }) -> [addedTask] (empty if a task with that title exists)
- overlay.tasks.update(id, { title?, category?, due?, time?, done? })   (due: "YYYY-MM-DD" / time: "HH:MM" to set, null to clear; a time without a due date is ignored)
- overlay.tasks.remove(id)
- overlay.tasks.onChange(callback)   (not a Promise; callback(list) runs whenever any widget, the user or Claude changes tasks)
- overlay.tasks.clearDone()   removes every finished task
- overlay.tasks.scan() -> { added: [titles], error? }   Claude looks through the user's notes and recent activity for new tasks and adds them (takes 10-30 seconds; only behind a button)
- overlay.tasks.onFocus(callback)   (not a Promise; callback(taskId) runs when the user clicks a notification about that task: scroll to it and highlight it for a few seconds)
- overlay.notes.get() -> the user's notes text (read-only, except in the user's own Notes widget)
- overlay.notes.set(text)   saves the user's notes (ONLY works in the Notes widget; anywhere else it throws). Save a moment after typing stops (debounce ~500ms) and on blur.
- overlay.notes.syncNow() -> { added: [titles], error? }   (Notes widget only) turns to-dos in the notes into tasks right now; this also happens automatically after typing stops
- overlay.notes.onSync(callback)   (not a Promise; Notes widget only) callback({ state: "syncing" | "done" | "error" | "idle", added?: [titles], error? }) as notes are turned into tasks
- overlay.focus(running)   Call with true while a focus session is running (e.g. a Pomodoro focus period) and false when it stops or pauses; repeat true at least every 30 seconds while it runs. Cloak then checks every few minutes that the user is on task (if they allowed it in Settings).
- overlay.ask(prompt) -> Claude's text answer (one-off, no tools; takes several seconds; use sparingly, e.g. behind a button, never on a timer)
- overlay.openChat(prompt)   (not a Promise; opens the user's Claude chat bar and sends the prompt there)
- overlay.today() -> "YYYY-MM-DD" in the user's local time (not a Promise)
- overlay.pill.setStatus(text)   One short line (max ~40 chars, e.g. "Dentist 3:30 PM") the user can choose to show in the small pill at the top of their screen (Settings > Top widget). Keep it current: call it on load, whenever your data changes, and every minute if it depends on the time. Pass "" when there's nothing to show. Offer one if the widget has something glanceable (next event, timer remaining, today's progress).
- overlay.pill.notify(text)   Pops up a notification from the top of the screen for something that needs attention right now (e.g. "Now: Dentist", "Timer done"); clicking it opens this widget. At most once per event (repeats within a minute are dropped).
Dates: due dates are local calendar dates "YYYY-MM-DD". Never parse them with new Date("YYYY-MM-DD") (that's UTC and shifts the day); split the string and use new Date(y, m - 1, d). Times are local "HH:MM" (24h); show them in the user's format with toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).

## Rules
- No network requests, no external scripts/fonts/images, no localStorage (use overlay.storage). Inline SVG and data: URIs are fine.
- Handle empty states nicely (e.g. no tasks yet).
- Don't rely on alert/confirm/prompt dialogs; build small inline UI instead.
- Your js runs inside an async function, so nothing you declare is global: attach event listeners in js (addEventListener / delegation), never inline onclick="..." attributes.
- Keep the code self-contained, readable and robust: guard against missing fields, and re-render when tasks change.`;

class WidgetStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  list() {
    return fs.readdirSync(this.dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(this.dir, d.name, "widget.json")))
      .map((d) => this.meta(d.name))
      .filter(Boolean)
      .sort((a, b) => a.created - b.created);
  }

  meta(id) {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, id, "widget.json"), "utf8")); } catch { return null; }
  }

  source(id) {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, id, "source.json"), "utf8")); } catch { return null; }
  }

  // Saves a build from Claude as a new widget (no id) or a new version of an existing one.
  save(build, id) {
    const isNew = !id;
    id ||= slug(build.name) + "-" + Date.now().toString(36);
    const wdir = path.join(this.dir, id);
    fs.mkdirSync(path.join(wdir, "history"), { recursive: true });
    if (!isNew && fs.existsSync(path.join(wdir, "source.json"))) {
      fs.copyFileSync(path.join(wdir, "source.json"), path.join(wdir, "history", `${Date.now()}.json`));
    }
    const prev = this.meta(id) || {};
    const meta = {
      id,
      name: String(build.name || prev.name || "Widget").slice(0, 40),
      description: String(build.description || prev.description || "").slice(0, 200),
      size: [clamp(build.width, 260, 900, 380), clamp(build.height, 200, 800, 440)],
      created: prev.created || Date.now(),
      updated: Date.now(),
      request: build.request || prev.request || "",
    };
    fs.writeFileSync(path.join(wdir, "widget.json"), JSON.stringify(meta, null, 2));
    fs.writeFileSync(path.join(wdir, "source.json"), JSON.stringify({ html: build.html, css: build.css, js: build.js }, null, 2));
    fs.writeFileSync(path.join(wdir, "index.html"), assemble(meta, build));
    return meta;
  }

  // Puts back the previous version. Returns false if there is none.
  undo(id) {
    const hdir = path.join(this.dir, id, "history");
    const versions = fs.existsSync(hdir) ? fs.readdirSync(hdir).sort() : [];
    if (!versions.length) return false;
    const last = path.join(hdir, versions.pop());
    const src = JSON.parse(fs.readFileSync(last, "utf8"));
    fs.writeFileSync(path.join(this.dir, id, "source.json"), JSON.stringify(src, null, 2));
    fs.writeFileSync(path.join(this.dir, id, "index.html"), assemble(this.meta(id), src));
    fs.rmSync(last);
    return true;
  }

  canUndo(id) {
    const hdir = path.join(this.dir, id, "history");
    return fs.existsSync(hdir) && fs.readdirSync(hdir).length > 0;
  }

  remove(id) { fs.rmSync(path.join(this.dir, id), { recursive: true, force: true }); }

  indexFile(id) { return path.join(this.dir, id, "index.html"); }

  // Per-widget storage for overlay.storage
  readData(id) {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, id, "data.json"), "utf8")); } catch { return {}; }
  }
  writeData(id, key, value) {
    const data = this.readData(id);
    if (value === null || value === undefined) delete data[key]; else data[key] = value;
    const json = JSON.stringify(data);
    if (json.length > 2_000_000) throw new Error("Widget storage is full (2 MB).");
    fs.writeFileSync(path.join(this.dir, id, "data.json"), json);
  }
}

function buildPrompt(request, existing) {
  const today = new Date();
  const lines = [
    "You are building a custom widget for a desktop overlay app. Write complete, working code; the user will use it right away.",
    API_DOC,
    `Today is ${today.toDateString()}.`,
  ];
  if (existing?.builtin) {
    const b = existing.builtin;
    lines.push(`## The built-in "${b.name}" widget you're replacing
The user wants to change their built-in ${b.name} widget. Your version replaces it: same name, same place, same button. Below is the built-in one's code. It was written against the app's internal API, not the window.overlay API above, so rewrite it for the API above: listTasks() -> overlay.tasks.list(), addTask -> overlay.tasks.add, updateTask -> overlay.tasks.update, removeTask -> overlay.tasks.remove, onTasksChanged -> overlay.tasks.onChange, clearDone -> overlay.tasks.clearDone, scanTasks -> overlay.tasks.scan, onScanState -> (drop it; show your own busy state), taskHelp(t) -> overlay.openChat("Help me with this task from my list: ..."), onFocusTask -> overlay.tasks.onFocus, getNotes -> overlay.notes.get, setNotes -> overlay.notes.set, syncNotesNow -> overlay.notes.syncNow, onNotesSync -> overlay.notes.onSync, openWelcome -> (drop it). The frame (header, minimize button, resize grip, theme.js, panel.js) is drawn for you: leave out the .shell/.phead/.grip markup and the hidePanel/focusPanel calls, and put any header buttons it had inside your own body instead.
Keep every feature it has unless the change says otherwise, and keep the user's data where it is (tasks in overlay.tasks, notes in overlay.notes).
html (full page, for reference):
\`\`\`html
${b.html}
\`\`\`
js:
\`\`\`js
${b.js}
\`\`\``);
    lines.push(`## Change requested
${request}

Return the complete widget (all fields). Name it "${b.name}".`);
  } else if (existing) {
    lines.push(`## Current widget "${existing.meta.name}"
html:
\`\`\`html
${existing.source.html}
\`\`\`
css:
\`\`\`css
${existing.source.css}
\`\`\`
js:
\`\`\`js
${existing.source.js}
\`\`\``);
    lines.push(`## Change requested\n${request}\n\nReturn the complete updated widget (all fields, not a diff). Keep everything that already works and keep the same name unless asked.`);
  } else {
    lines.push(`## Widget requested\n${request}`);
  }
  return lines.join("\n\n");
}

// Catches syntax errors before installing. Returns an error message or null.
function checkJs(js) {
  try { new vm.Script(`(async () => {\n${js}\n})`); return null; } catch (e) { return String(e.message || e); }
}

function assemble(meta, src) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const safe = (s, tag) => String(s || "").replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src overlay: 'unsafe-inline'; style-src overlay: 'unsafe-inline'; img-src overlay: data:; font-src overlay: data:" />
<title>Claude Widget: ${esc(meta.name)}</title>
<link rel="stylesheet" href="overlay://app/theme.css" />
<link rel="stylesheet" href="overlay://app/panel.css" />
<style>
  .badge { background: rgba(var(--accent-rgb), .16); color: var(--accent); font-weight: 700; font-size: 11px; }
  #app { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; user-select: text; }
  .widget-error { margin: 12px; padding: 10px 12px; border-radius: 9px; background: rgba(255,120,100,.1); color: #ff9b8a; font-size: 12px; white-space: pre-wrap; }
</style>
<style>
${safe(src.css, "style")}
</style>
</head>
<body>
<div class="shell">
  <div class="phead" title="Drag to move">
    <div class="badge">${esc(meta.name.trim().charAt(0).toUpperCase())}</div>
    <div class="title">${esc(meta.name)}</div>
    <button class="icon-btn min" title="Minimize (Ctrl+Shift+Space brings it back)"><svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg></button>
  </div>
  <div id="app">
${src.html}
  </div>
  <div class="grip" title="Resize"></div>
</div>
<script src="overlay://app/theme.js"></script>
<script src="overlay://app/panel.js"></script>
<script>
window.addEventListener("error", (e) => {
  const box = document.createElement("div");
  box.className = "widget-error";
  box.textContent = "Something went wrong in this widget: " + e.message + "\\nYou can ask Claude to fix it in Settings > Widgets.";
  document.getElementById("app").prepend(box);
});
window.addEventListener("unhandledrejection", (e) => window.dispatchEvent(new ErrorEvent("error", { message: String(e.reason && e.reason.message || e.reason) })));
</script>
<script>
(async () => {
${safe(src.js, "script")}
})();
</script>
</body>
</html>
`;
}

const slug = (s) => String(s || "widget").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "widget";
const clamp = (n, lo, hi, d) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Math.round(Number(n)))) : d);

module.exports = { WidgetStore, BUILD_SCHEMA, buildPrompt, checkJs };
