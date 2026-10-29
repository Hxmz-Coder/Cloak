const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ov = window.overlay;
let S = null; // current settings

const ICON = {
  up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg>',
};
const switchHtml = (checked, attrs = "") => `<label class="switch"><input type="checkbox" ${checked ? "checked" : ""} ${attrs}><span></span></label>`;

// ---------- navigation ----------
function show(section) {
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.s === section));
  document.querySelectorAll("main section").forEach((s) => s.classList.toggle("on", s.id === `s-${section}`));
  document.querySelector("main").scrollTop = 0;
}
$("nav").addEventListener("click", (e) => { if (e.target.dataset.s) show(e.target.dataset.s); });
ov.onSettingsSection((s) => { show(s); refresh(); });
ov.onPanelShown(refresh);
ov.onTheme?.((theme) => { if (S) { S.theme = theme; renderAppearance(); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !listening) ov.hidePanel(); });

// ---------- appearance ----------
const COLORS = [
  ["Claude orange", "#d97757"], ["Coral", "#e8685a"], ["Amber", "#e2a33b"], ["Green", "#5bb07a"], ["Teal", "#39aaa6"],
  ["Blue", "#5b8def"], ["Indigo", "#7b7ff0"], ["Purple", "#a77be6"], ["Pink", "#e06aa6"], ["Graphite", "#9aa0a8"],
];
function renderAppearance() {
  const glass = S.theme.material === "glass";
  $("classicColors").style.display = glass ? "none" : "";
  $("glassTint").style.display = glass ? "" : "none";
  document.querySelectorAll("#materialPick button").forEach((b) => b.classList.toggle("on", b.dataset.v === (glass ? "glass" : "classic")));
  document.querySelectorAll("#tintPick button").forEach((b) => b.classList.toggle("on", b.dataset.v === (S.theme.tint || "dark")));
  const cur = S.theme.accent.toLowerCase();
  $("swatches").innerHTML = COLORS.map(([name, hex]) =>
    `<button class="sw ${hex === cur ? "on" : ""}" title="${name}" data-hex="${hex}" style="background:${hex}"></button>`).join("") +
    `<span class="custom-color">Custom <input type="color" id="customColor" value="${esc(S.theme.accent)}"></span>`;
  const bg = (S.theme.background || "#161413").toLowerCase();
  $("bgSwatches").innerHTML = BACKGROUNDS.map(([name, hex]) =>
    `<button class="sw ${hex === bg ? "on" : ""}" title="${name}" data-hex="${hex}" style="background:${hex};box-shadow:inset 0 0 0 1px rgba(255,255,255,.15)"></button>`).join("") +
    `<span class="custom-color">Custom <input type="color" id="customBg" value="${esc(bg)}"></span>`;
  const icon = S.theme.icon === "custom" && S.theme.iconData ? "custom" : S.theme.icon || "cloak";
  document.querySelectorAll("#iconPick button").forEach((b) => b.classList.toggle("on", b.dataset.v === icon));
  $("customLabel").textContent = S.theme.iconData ? "Your picture" : "Choose picture…";
  if (S.theme.iconData) $("customDemo").style.setProperty("--icon-image", `url("${S.theme.iconData}")`);
  $("opacity").value = Math.round(S.theme.opacity * 100);
  $("opacityVal").textContent = `${Math.round(S.theme.opacity * 100)}%`;
}
async function setTheme(patch) {
  S.theme = await ov.setTheme(patch);
  renderAppearance();
}
$("swatches").addEventListener("click", (e) => { if (e.target.dataset.hex) setTheme({ accent: e.target.dataset.hex }); });
$("swatches").addEventListener("input", (e) => { if (e.target.id === "customColor") ov.setTheme({ accent: e.target.value }); });
$("swatches").addEventListener("change", (e) => { if (e.target.id === "customColor") setTheme({ accent: e.target.value }); });
let opTimer;
$("opacity").addEventListener("input", () => {
  $("opacityVal").textContent = `${$("opacity").value}%`;
  clearTimeout(opTimer);
  opTimer = setTimeout(() => ov.setTheme({ opacity: $("opacity").value / 100 }).then((t) => (S.theme = t)), 60);
});
$("themeReset").onclick = () => setTheme({ accent: "#d97757", background: "#161413", opacity: 0.95 });
$("materialPick").addEventListener("click", (e) => { if (e.target.dataset.v) setTheme({ material: e.target.dataset.v }); });
$("tintPick").addEventListener("click", (e) => { if (e.target.dataset.v) setTheme({ tint: e.target.dataset.v }); });
// Background color: dark tones that keep text readable (any color via Custom).
const BACKGROUNDS = [["Charcoal", "#161413"], ["Black", "#050505"], ["Slate", "#141821"], ["Navy", "#0f1630"], ["Forest", "#0f1d16"],
  ["Plum", "#1e1224"], ["Wine", "#24100f"], ["Mocha", "#241a14"]];
$("bgSwatches").addEventListener("click", (e) => { if (e.target.dataset.hex) setTheme({ background: e.target.dataset.hex }); });
$("bgSwatches").addEventListener("input", (e) => { if (e.target.id === "customBg") ov.setTheme({ background: e.target.value }); });
$("bgSwatches").addEventListener("change", (e) => { if (e.target.id === "customBg") setTheme({ background: e.target.value }); });
// Icon: the Cloak mark, the classic star, or a picture of your own (double-click it to choose another).
$("iconPick").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.v === "custom" && !S.theme.iconData) return pickPicture();
  setTheme({ icon: b.dataset.v });
});
$("iconPick").addEventListener("dblclick", (e) => { if (e.target.closest('[data-v="custom"]')) pickPicture(); });
async function pickPicture() {
  const t = await ov.pickIcon();
  if (t?.error) { $("customLabel").textContent = t.error; return; }
  if (t) { S.theme = t; renderAppearance(); }
}

// ---------- top widget ----------
function renderTop() {
  const p = S.pill;
  if (document.activeElement !== $("pLabel")) $("pLabel").value = p.label ?? "";
  $("pClock").checked = p.clock;
  $("pDate").checked = !!p.date;
  $("pCount").checked = p.taskCount;
  $("pNext").checked = p.nextTask;
  document.querySelectorAll("#pStyle button").forEach((b) => b.classList.toggle("on", b.dataset.v === (p.style || "island")));
  $("islandOpts").style.display = p.style === "dot" ? "none" : "";
  document.querySelectorAll("#pPos button").forEach((b) => b.classList.toggle("on", b.dataset.v === (p.position || "center")));
  // Widgets Claude built can offer a line for the pill (e.g. the calendar's next event).
  const custom = (S.panels || []).filter((w) => !w.builtin);
  $("pWidgets").innerHTML = custom.map((w) => `
    <div class="row"><div class="grow"><div class="t">${esc(w.label)}</div><div class="d">Whatever this widget shows at a glance, if it offers something.</div></div>
      ${switchHtml((p.widgets || []).includes(w.name), `data-w="${esc(w.name)}"`)}</div>`).join("");
}
async function savePill(patch) {
  S.pill = { ...S.pill, ...patch };
  await ov.setPill(S.pill);
  renderTop();
}
let labelTimer;
// An empty box means no text on the pill.
$("pLabel").addEventListener("input", () => { clearTimeout(labelTimer); labelTimer = setTimeout(() => savePill({ label: $("pLabel").value.trim() }), 300); });
$("pClock").onchange = () => savePill({ clock: $("pClock").checked });
$("pDate").onchange = () => savePill({ date: $("pDate").checked });
$("pCount").onchange = () => savePill({ taskCount: $("pCount").checked });
$("pNext").onchange = () => savePill({ nextTask: $("pNext").checked });
$("pStyle").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) savePill({ style: b.dataset.v }); });
$("pWidgets").addEventListener("change", (e) => {
  const id = e.target.dataset.w;
  if (!id) return;
  const set = new Set(S.pill.widgets || []);
  e.target.checked ? set.add(id) : set.delete(id);
  savePill({ widgets: [...set] });
});
$("pPos").addEventListener("click", (e) => { if (e.target.dataset.v) savePill({ position: e.target.dataset.v }); });

// ---------- notifications ----------
function renderNotify() {
  const n = S.notify;
  document.querySelectorAll("[data-n]").forEach((el) => (el.checked = !!n[el.dataset.n]));
  $("nKinds").style.opacity = n.enabled ? "" : ".45";
  const paused = n.pausedUntil > Date.now();
  $("nPaused").textContent = paused ? `Paused until ${new Date(n.pausedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : "";
  $("nPause").textContent = paused ? "Resume now" : "Pause for 1 hour";
}
async function saveNotify(patch) { S.notify = await ov.setNotify(patch); renderNotify(); }
$("s-notify").addEventListener("change", (e) => { const k = e.target.dataset.n; if (k) saveNotify({ [k]: e.target.checked }); });
$("nPause").onclick = () => saveNotify({ pausedUntil: S.notify.pausedUntil > Date.now() ? 0 : Date.now() + 3600_000 });
$("nTest").onclick = () => ov.testNotify();

// ---------- memory ----------
function renderMemory(list = S.memories || []) {
  S.memories = list;
  $("memCount").textContent = list.length ? `(${list.length})` : "";
  $("memList").innerHTML = list.length ? list.map((m) => `
    <div class="item" data-id="${esc(m.id)}">
      <div class="grow"><div class="t mem-text" contenteditable="plaintext-only" spellcheck="true" title="Click to edit">${esc(m.text)}</div>
        <div class="d">${m.source === "claude" ? "Saved from a chat" : "Added by you"} · ${new Date(m.created).toLocaleDateString([], { month: "short", day: "numeric" })}</div></div>
      <div class="acts"><button class="icon-btn" data-a="forget" title="Forget this">${ICON.del}</button></div>
    </div>`).join("") : '<p class="hint">Nothing yet.</p>';
}
$("memAdd").onclick = async () => {
  const text = $("memText").value.trim();
  if (!text) return $("memText").focus();
  renderMemory(await ov.addMemory(text));
  $("memText").value = "";
  $("memStatus").innerHTML = '<span class="ok">Remembered.</span>';
  setTimeout(() => ($("memStatus").innerHTML = ""), 2500);
};
$("memText").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) $("memAdd").click(); });
$("memList").addEventListener("click", async (e) => {
  const b = e.target.closest('[data-a="forget"]');
  if (b) renderMemory(await ov.removeMemory(b.closest(".item").dataset.id));
});
// Edit in place: saved when you click away (or press Enter).
$("memList").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.classList.contains("mem-text")) { e.preventDefault(); e.target.blur(); } });
$("memList").addEventListener("focusout", async (e) => {
  if (!e.target.classList.contains("mem-text")) return;
  const id = e.target.closest(".item").dataset.id, text = e.target.textContent.trim();
  const old = S.memories.find((m) => m.id === id)?.text;
  if (text && text !== old) renderMemory(await ov.updateMemory(id, text));
  else if (!text) e.target.textContent = old || "";
});
$("memClear").onclick = async () => {
  const b = $("memClear");
  if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Click again to forget everything"; return; }
  b.dataset.confirm = ""; b.textContent = "Forget everything";
  renderMemory(await ov.clearMemories());
};
ov.onMemoriesChanged((list) => { if (!document.activeElement?.classList.contains("mem-text")) renderMemory(list); });

// Files to remember
function renderFiles(files = S.files || []) {
  S.files = files;
  $("fileCount").textContent = files.length ? `(${files.length})` : "";
  const kb = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
  $("fileList").innerHTML = files.map((f) => `
    <div class="item" data-id="${esc(f.id)}">
      <div class="file-ic">${esc((f.name.split(".").pop() || "").toUpperCase().slice(0, 4))}</div>
      <div class="grow"><div class="t">${esc(f.name)} <span class="muted" style="font-weight:400">${kb(f.size)}</span></div>
        <div class="d file-sum">${f.status === "ready" ? esc(f.summary) : f.status === "error" ? `<span class="err">${esc(f.error)}</span>` : "Reading it…"}</div></div>
      <div class="acts">${f.status === "error" ? '<button class="btn ghost" data-a="retry">Try again</button>' : ""}
        <button class="icon-btn" data-a="forget-file" title="Forget this file">${ICON.del}</button></div>
    </div>`).join("");
}
async function addFiles(result) {
  renderFiles(result.files);
  $("fileStatus").innerHTML = result.errors?.length ? `<span class="err">${result.errors.map(esc).join("<br>")}</span>` : "";
}
$("filePick").onclick = async () => addFiles(await ov.pickMemoryFiles());
const drop = $("fileDrop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
drop.addEventListener("drop", async (e) => {
  e.preventDefault();
  const paths = [...e.dataTransfer.files].map((f) => ov.pathForFile(f)).filter(Boolean);
  if (paths.length) addFiles(await ov.addMemoryFiles(paths));
});
$("fileList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-a]");
  if (!b) return;
  const id = b.closest(".item").dataset.id;
  if (b.dataset.a === "forget-file") renderFiles(await ov.removeMemoryFile(id));
  if (b.dataset.a === "retry") renderFiles(await ov.retryMemoryFile(id));
});
ov.onMemoryFilesChanged(renderFiles);
// Files dropped anywhere else in Settings shouldn't open in the window.
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

// ---------- shortcut buttons ----------
let editingSc = null; // id being edited, "new" for a new one, or null
function scKind(sc) {
  if (sc.action === "recap") return "screen memory";
  if (sc.action === "scan") return "finds tasks";
  if (sc.screenshot) return "uses screen";
  if ((sc.prompt || "").includes("{clipboard}")) return "uses clipboard";
  return "";
}
function renderShortcuts() {
  const list = S.shortcuts;
  $("scList").innerHTML = list.map((sc, i) => `
    <div class="item" data-id="${esc(sc.id)}">
      <div class="grow"><div class="t">${esc(sc.label)}</div>${sc.prompt ? `<div class="d">${esc(sc.prompt.replace(/\s+/g, " "))}</div>` : `<div class="d">Built-in</div>`}</div>
      ${scKind(sc) ? `<span class="tag">${scKind(sc)}</span>` : ""}
      <div class="acts">
        <button class="icon-btn" data-a="up" title="Move up" ${i === 0 ? "disabled" : ""}>${ICON.up}</button>
        <button class="icon-btn" data-a="down" title="Move down" ${i === list.length - 1 ? "disabled" : ""}>${ICON.down}</button>
        ${sc.action ? "" : `<button class="icon-btn" data-a="edit" title="Edit">${ICON.edit}</button>`}
        <button class="icon-btn" data-a="del" title="Remove">${ICON.del}</button>
      </div>
    </div>`).join("");
  renderScForm();
}
function renderScForm() {
  if (!editingSc) { $("scForm").innerHTML = ""; return; }
  const sc = editingSc === "new" ? { label: "", prompt: "", screenshot: false, autoSend: true } : S.shortcuts.find((s) => s.id === editingSc);
  $("scForm").innerHTML = `
    <div class="form">
      <b>${editingSc === "new" ? "New shortcut" : "Edit shortcut"}</b>
      <input type="text" id="fLabel" maxlength="28" placeholder="Button name, e.g. Make it shorter" value="${esc(sc.label)}">
      <textarea id="fPrompt" placeholder="What should Claude do? e.g. Rewrite this to be half as long:&#10;&#10;{clipboard}">${esc(sc.prompt)}</textarea>
      <label><input type="checkbox" id="fShot" ${sc.screenshot ? "checked" : ""}> Attach a screenshot of my screen</label>
      <label><input type="checkbox" id="fAuto" ${sc.autoSend !== false ? "checked" : ""}> Send right away (otherwise just fill the box)</label>
      <div class="btns"><button class="btn primary" id="fSave">Save</button><button class="btn" id="fCancel">Cancel</button></div>
    </div>`;
  $("fLabel").focus();
  $("fCancel").onclick = () => { editingSc = null; renderScForm(); };
  $("fSave").onclick = async () => {
    const label = $("fLabel").value.trim(), prompt = $("fPrompt").value.trim();
    if (!label || !prompt) return (label ? $("fPrompt") : $("fLabel")).focus();
    const data = { label, prompt, screenshot: $("fShot").checked, autoSend: $("fAuto").checked };
    if (editingSc === "new") {
      const at = S.shortcuts.findIndex((s) => s.action === "scan"); // keep "Find tasks" last
      const item = { id: "w" + Date.now(), ...data };
      if (at >= 0) S.shortcuts.splice(at, 0, item); else S.shortcuts.push(item);
    } else S.shortcuts = S.shortcuts.map((s) => (s.id === editingSc ? { ...s, ...data } : s));
    editingSc = null;
    await ov.setShortcuts(S.shortcuts, scModeId);
    renderShortcuts();
  };
}
$("scList").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-a]");
  if (!btn) return;
  const id = btn.closest(".item").dataset.id;
  const i = S.shortcuts.findIndex((s) => s.id === id);
  const a = btn.dataset.a;
  if (a === "edit") { editingSc = id; return renderScForm(); }
  if (a === "del") S.shortcuts.splice(i, 1);
  if (a === "up" && i > 0) [S.shortcuts[i - 1], S.shortcuts[i]] = [S.shortcuts[i], S.shortcuts[i - 1]];
  if (a === "down" && i < S.shortcuts.length - 1) [S.shortcuts[i + 1], S.shortcuts[i]] = [S.shortcuts[i], S.shortcuts[i + 1]];
  await ov.setShortcuts(S.shortcuts, scModeId);
  renderShortcuts();
});
$("scAdd").onclick = () => { editingSc = "new"; renderScForm(); };
$("scReset").onclick = async () => { S.shortcuts = await ov.resetShortcuts(scModeId); editingSc = null; renderShortcuts(); };

// ---------- widgets ----------
const EXAMPLES = [
  ["Calendar", "A calendar that shows my tasks on their due dates, with a week view and a month view."],
  ["Focus timer", "A pomodoro focus timer: 25 minute focus, 5 minute break, with start/pause/reset and a count of sessions done today."],
  ["Habit tracker", "A habit tracker where I add daily habits and tick them off each day, showing a 7-day streak for each."],
  ["Countdown", "Countdowns to dates I add (like exams or trips), sorted by soonest, showing days left."],
  ["Daily plan", "A daily planner that suggests an order for today's tasks using Claude, with a button to re-plan."],
];
$("examples").innerHTML = EXAMPLES.map(([n], i) => `<button data-i="${i}">${n}</button>`).join("");
$("examples").addEventListener("click", (e) => { if (e.target.dataset.i) { $("bRequest").value = EXAMPLES[e.target.dataset.i][1]; $("bRequest").focus(); } });

let buildStarted = 0, buildTimer = null;
function setBuilding(on, msg) {
  clearInterval(buildTimer);
  if (!on) { $("bStatus").innerHTML = msg || ""; document.querySelectorAll(".needs-idle").forEach((b) => (b.disabled = false)); $("bBuild").disabled = false; return; }
  buildStarted = buildStarted || Date.now();
  $("bBuild").disabled = true;
  document.querySelectorAll(".needs-idle").forEach((b) => (b.disabled = true));
  const tick = () => {
    const s = Math.round((Date.now() - buildStarted) / 1000);
    $("bStatus").innerHTML = `<span class="spinner"></span>${esc(msg || "Claude is working…")} <span class="muted">${s}s, usually 1-3 minutes</span>`;
  };
  tick();
  buildTimer = setInterval(tick, 1000);
}
let ownBuild = false; // this page started the build and shows its result itself
ov.onBuildProgress((msg) => {
  if (msg) { S.building = true; return setBuilding(true, msg); }
  // null: the build is over (S.building could otherwise be stale from a refresh during it and restart the spinner)
  S.building = false;
  if (!ownBuild) { buildStarted = 0; setBuilding(false); }
});

async function build(request, id) {
  buildStarted = Date.now();
  ownBuild = true;
  setBuilding(true, id ? "Claude is changing the widget…" : "Claude is designing and coding your widget…");
  let r;
  try { r = await ov.buildWidget({ request, id }); }
  catch (err) { r = { ok: false, error: String(err.message || err) }; }
  ownBuild = false;
  S.building = false;
  buildStarted = 0;
  if (!r.ok) { setBuilding(false, `<span class="err">${esc(r.error)}</span>`); return false; }
  setBuilding(false, `<span class="ok">${id ? "Updated" : "Added"} "${esc(r.widget.name)}". It's open on your screen now.</span>`);
  S.panels = r.panels;
  renderWidgets();
  return true;
}
$("bBuild").onclick = async () => {
  const req = $("bRequest").value.trim();
  if (!req) return $("bRequest").focus();
  if (await build(req)) $("bRequest").value = "";
};

function renderWidgets() {
  const tag = (p) => (!p.builtin ? '<span class="tag">made by Claude</span>' : p.customized ? '<span class="tag">changed by Claude</span>' : '<span class="tag">built-in</span>');
  const about = (p) => (!p.builtin ? p.description : p.name === "tasks" ? "Your task list." : p.name === "listen" ? "Turns what's playing on your computer into text, and the AI responds to it." : "Your notes; Claude can find tasks in them.");
  const hint = (p) => (p.name === "tasks" ? "e.g. Group tasks by category, and add a progress bar for today."
    : p.name === "notes" ? "e.g. Add a word count, and make headings bigger."
    : "e.g. Add a button to jump to today, and color tasks by category.");
  $("wList").innerHTML = S.panels.map((p) => `
    <div class="item" data-name="${esc(p.name)}">
      <div class="grow"><div class="t">${esc(p.label)} ${tag(p)}</div>
        <div class="d">${esc(about(p))}</div></div>
      <div class="acts">
        <button class="icon-btn" data-a="open" title="Show it now">${ICON.open}</button>
        ${p.builtin && !p.editable ? "" : `<button class="btn ghost needs-idle" data-a="change">Change…</button>`}
        ${p.canUndo ? `<button class="btn ghost needs-idle" data-a="undo" title="Go back to the previous version">Undo</button>` : ""}
        ${p.customized ? `<button class="btn ghost needs-idle" data-a="restore" title="Go back to the original ${esc(p.label)}. Your ${p.name === "tasks" ? "tasks" : "notes"} stay as they are.">Restore original</button>` : ""}
        ${p.builtin ? "" : `<button class="icon-btn" data-a="del" title="Delete">${ICON.del}</button>`}
        <span title="Show with the show/hide shortcut" style="margin-left:6px">${switchHtml(p.enabled, 'data-a="enabled"')}</span>
      </div>
      <div class="change"><textarea placeholder="What should Claude change? ${esc(hint(p))}"></textarea>
        <div class="btns"><button class="btn primary needs-idle" data-a="apply">Apply change</button><button class="btn" data-a="cancel">Cancel</button></div></div>
    </div>`).join("");
  if (S.building) setBuilding(true);
}
$("wList").addEventListener("click", async (e) => {
  const el = e.target.closest("[data-a]");
  if (!el) return;
  const item = el.closest(".item");
  const name = item.dataset.name;
  switch (el.dataset.a) {
    case "open": S.panels = await ov.panelShow(name); break;
    case "change": item.classList.add("open-change"); item.querySelector("textarea").focus(); return;
    case "cancel": item.classList.remove("open-change"); return;
    case "apply": {
      const req = item.querySelector("textarea").value.trim();
      if (!req) return item.querySelector("textarea").focus();
      await build(req, name);
      return;
    }
    case "undo": S.panels = await ov.undoWidget(name); break;
    case "restore":
      if (el.dataset.confirm !== "1") { el.dataset.confirm = "1"; el.textContent = "Click again to restore"; return; }
      S.panels = await ov.restoreWidget(name); break;
    case "del":
      if (el.dataset.confirm !== "1") { el.dataset.confirm = "1"; el.title = "Click again to delete"; el.style.color = "#ff9b8a"; return; }
      S.panels = await ov.deleteWidget(name); break;
    default: return;
  }
  renderWidgets();
});
$("wList").addEventListener("change", async (e) => {
  if (e.target.dataset.a !== "enabled") return;
  S.panels = await ov.panelEnabled(e.target.closest(".item").dataset.name, e.target.checked);
});
$("resetPos").onclick = async () => { await ov.resetPositions(); $("resetPos").textContent = "Positions reset"; };

// ---------- Claude & privacy ----------
function renderClaude() {
  $("memoryEnabled").checked = S.memoryEnabled;
  $("autoScan").checked = S.autoScan;
  document.querySelectorAll("#chatSpeed button").forEach((b) => b.classList.toggle("on", b.dataset.v === S.chatSpeed));
  document.querySelectorAll("#replyLength button").forEach((b) => b.classList.toggle("on", b.dataset.v === S.replyLength));
  $("focusOn").checked = S.focusChecks.enabled;
  $("focusEveryRow").style.opacity = S.focusChecks.enabled ? "" : ".45";
  document.querySelectorAll("#focusEvery button").forEach((b) => b.classList.toggle("on", Number(b.dataset.v) === S.focusChecks.everyMin));
  $("allowList").innerHTML = S.autoAllow.length
    ? S.autoAllow.map((r, i) => `<div class="item"><div class="grow"><code>${esc(describeRule(r))}</code></div><button class="icon-btn" data-i="${i}" title="Ask me again">${ICON.del}</button></div>`).join("")
    : '<p class="hint">None yet. Claude asks before running commands that change things, editing files, or opening web pages.</p>';
}
function describeRule(r) {
  let m;
  if ((m = /^Bash\((.+):\*\)$/.exec(r))) return `Run "${m[1]}" commands`;
  if ((m = /^Edit\(\/\/(.+)\/\*\*\)$/.exec(r))) return `Edit files in ${m[1].replace(/^([a-z])\//, (_, d) => d.toUpperCase() + ":/")}`;
  if ((m = /^WebFetch\(domain:(.+)\)$/.exec(r))) return `Open pages on ${m[1]}`;
  return r;
}
$("memoryEnabled").onchange = () => ov.setSetting("memoryEnabled", $("memoryEnabled").checked);
$("autoScan").onchange = () => ov.setSetting("autoScan", $("autoScan").checked);
$("chatSpeed").addEventListener("click", async (e) => {
  if (!e.target.dataset.v) return;
  await ov.setSetting("chatSpeed", e.target.dataset.v);
  S.chatSpeed = e.target.dataset.v;
  renderClaude();
});
async function saveFocus(patch) {
  await ov.setSetting("focusChecks", patch);
  S.focusChecks = { ...S.focusChecks, ...patch };
  renderClaude();
}
$("focusOn").onchange = () => saveFocus({ enabled: $("focusOn").checked });
$("focusEvery").addEventListener("click", (e) => { if (e.target.dataset.v) saveFocus({ everyMin: Number(e.target.dataset.v) }); });
$("replyLength").addEventListener("click", async (e) => {
  if (!e.target.dataset.v) return;
  await ov.setSetting("replyLength", e.target.dataset.v);
  S.replyLength = e.target.dataset.v;
  renderClaude();
});
$("clearMem").onclick = async () => { await ov.clearMemory(); $("clearMem").textContent = "Cleared"; };
$("allowList").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-i]");
  if (!b) return;
  S.autoAllow.splice(Number(b.dataset.i), 1);
  await ov.setSetting("autoAllow", S.autoAllow);
  renderClaude();
});

// ---------- keyboard ----------
let listening = null;
const IS_MAC = ov.platform === "darwin";
const pretty = (a) => IS_MAC ? a.replace(/CommandOrControl|Super/g, "Cmd").replace(/Control/g, "Ctrl").replace(/Alt/g, "Option")
  : a.replace(/CommandOrControl/g, "Ctrl").replace(/Super/g, "Win");
if (IS_MAC) {
  $("keysLead").textContent = "Click a shortcut, then press the new key combination. It must include Cmd, Control or Option.";
  $("loginLabel").textContent = "Start when I log in to my Mac";
}
function renderKeys() {
  document.querySelectorAll(".key").forEach((b) => {
    b.classList.toggle("listening", listening === b.dataset.k);
    b.textContent = listening === b.dataset.k ? "Press keys… (Esc to cancel)" : pretty(S.hotkeys[b.dataset.k]);
  });
}
document.querySelectorAll(".key").forEach((b) => (b.onclick = () => { listening = b.dataset.k; $("keyStatus").textContent = ""; renderKeys(); }));
function keyName(e) {
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^F\d{1,2}$/.test(c)) return c;
  const map = { Space: "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Backquote: "`", Minus: "-", Equal: "=",
    BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Enter: "Enter", Tab: "Tab",
    Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert", Delete: "Delete" };
  return map[c] || null;
}
document.addEventListener("keydown", async (e) => {
  if (!listening) return;
  e.preventDefault();
  if (e.key === "Escape") { listening = null; renderKeys(); return; }
  const key = keyName(e);
  if (!key) return; // still holding modifiers
  if (!e.ctrlKey && !e.altKey && !e.metaKey) { $("keyStatus").innerHTML = `<span class="err">${IS_MAC ? "Include Cmd, Control or Option." : "Include Ctrl, Alt or the Windows key."}</span>`; return; }
  // CommandOrControl is Ctrl on Windows and Cmd on a Mac, so on a Mac it comes from the Cmd key and Ctrl is "Control".
  const accel = (IS_MAC ? [e.metaKey && "CommandOrControl", e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", key]
    : [e.ctrlKey && "CommandOrControl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super", key]).filter(Boolean).join("+");
  const which = listening;
  listening = null;
  const r = await ov.setHotkey(which, accel);
  if (r.ok) { S.hotkeys = r.hotkeys; $("keyStatus").innerHTML = `<span class="ok">Saved: ${esc(pretty(accel))}</span>`; }
  else $("keyStatus").innerHTML = `<span class="err">${esc(r.error)}</span>`;
  renderKeys();
});

// ---------- general ----------
$("openAtLogin").onchange = async () => {
  await ov.setSetting("openAtLogin", $("openAtLogin").checked);
  $("openAtLogin").checked = (await ov.getSettings()).openAtLogin; // show what the system actually has
};

// ---------- modes ----------
let scModeId = null;      // which mode's shortcut buttons the Shortcut buttons page is editing
let editingMode = null;   // mode id in the edit form, or "new"
const modeById = (id) => S.modes.find((m) => m.id === id);

// Shortcut buttons page: pick the mode whose buttons you're editing.
function syncShortcutMode() {
  if (!scModeId || !modeById(scModeId)) scModeId = S.activeMode;
  S.shortcuts = modeById(scModeId).shortcuts;
  $("scMode").innerHTML = S.modes.map((m) => `<option value="${esc(m.id)}" ${m.id === scModeId ? "selected" : ""}>${esc(m.name)}${m.id === S.activeMode ? " (active)" : ""}</option>`).join("");
}
$("scMode").onchange = () => { scModeId = $("scMode").value; editingSc = null; syncShortcutMode(); renderShortcuts(); };

const MODE_EXAMPLES = [
  ["Spanish practice", "Help me practice Spanish: chat with me in simple Spanish, gently correct my grammar, and quiz me on vocabulary."],
  ["Research", "Help me research topics: find and summarize reliable sources, compare viewpoints, and keep track of key facts."],
  ["Interview prep", "Help me prepare for job interviews: ask me practice questions, give feedback on my answers, and suggest stronger phrasing."],
  ["Email", "Help me write and reply to emails: clear, friendly and concise, matching the tone of the thread."],
];
$("modeExamples").innerHTML = MODE_EXAMPLES.map(([n], i) => `<button data-i="${i}">${n}</button>`).join("");
$("modeExamples").addEventListener("click", (e) => { if (e.target.dataset.i) { $("mRequest").value = MODE_EXAMPLES[e.target.dataset.i][1]; $("mRequest").focus(); } });

function renderModes() {
  $("modeList").innerHTML = S.modes.map((m) => `
    <div class="item" data-id="${esc(m.id)}">
      <div class="grow"><div class="t">${esc(m.name)} ${m.id === S.activeMode ? '<span class="tag" style="color:var(--accent)">active</span>' : ""} ${m.builtin ? '<span class="tag">built-in</span>' : ""}</div>
        <div class="d">${esc(m.description || (m.instructions || "").split("\n")[0] || "No extra instructions.")}</div></div>
      <div class="acts">
        ${m.id === S.activeMode ? "" : `<button class="btn ghost" data-a="use">Use</button>`}
        <button class="icon-btn" data-a="edit" title="Edit">${ICON.edit}</button>
        <button class="btn ghost" data-a="buttons" title="Edit this mode's shortcut buttons">Buttons</button>
        ${m.builtin ? `<button class="btn ghost" data-a="restore" title="Put it back the way it came">Restore</button>` : ""}
        ${m.id === "general" ? "" : `<button class="icon-btn" data-a="del" title="Delete">${ICON.del}</button>`}
      </div>
    </div>`).join("");
  renderModeForm();
}
function renderModeForm() {
  if (!editingMode) { $("modeForm").innerHTML = ""; return; }
  const m = editingMode === "new" ? { name: "", description: "", instructions: "" } : modeById(editingMode);
  $("modeForm").innerHTML = `
    <div class="form">
      <b>${editingMode === "new" ? "New mode" : `Edit ${esc(m.name)}`}</b>
      <input type="text" id="mfName" maxlength="24" placeholder="Name, e.g. Spanish" value="${esc(m.name)}">
      <input type="text" id="mfDesc" maxlength="200" placeholder="What it's for (one line)" value="${esc(m.description || "")}">
      <textarea id="mfInstr" style="min-height:150px" placeholder="How Claude should behave in this mode: focus, tone, format, what to avoid.">${esc(m.instructions || "")}</textarea>
      <p class="hint" style="margin:0">Modes can't change your privacy settings or what needs your approval.</p>
      <div class="btns"><button class="btn primary" id="mfSave">Save</button><button class="btn" id="mfCancel">Cancel</button></div>
    </div>`;
  $("mfName").focus();
  $("mfCancel").onclick = () => { editingMode = null; renderModeForm(); };
  $("mfSave").onclick = async () => {
    const name = $("mfName").value.trim();
    if (!name) return $("mfName").focus();
    const r = await ov.saveMode({ id: editingMode === "new" ? undefined : editingMode, name, description: $("mfDesc").value.trim(), instructions: $("mfInstr").value });
    S.modes = r.modes; S.activeMode = r.active;
    editingMode = null;
    renderModes(); syncShortcutMode(); renderShortcuts();
  };
}
$("modeList").addEventListener("click", async (e) => {
  const el = e.target.closest("[data-a]");
  if (!el) return;
  const id = el.closest(".item").dataset.id;
  let r;
  switch (el.dataset.a) {
    case "use": await ov.setActiveMode(id); S.activeMode = id; break;
    case "edit": editingMode = id; return renderModeForm();
    case "buttons": scModeId = id; syncShortcutMode(); renderShortcuts(); return show("shortcuts");
    case "restore": r = await ov.restoreMode(id); break;
    case "del":
      if (el.dataset.confirm !== "1") { el.dataset.confirm = "1"; el.title = "Click again to delete"; el.style.color = "#ff9b8a"; return; }
      r = await ov.deleteMode(id); break;
  }
  if (r) { S.modes = r.modes; S.activeMode = r.active; }
  renderModes(); syncShortcutMode(); renderShortcuts();
});
$("modeNew").onclick = () => { editingMode = "new"; renderModeForm(); };
$("mBuild").onclick = async () => {
  const req = $("mRequest").value.trim();
  if (!req) return $("mRequest").focus();
  $("mBuild").disabled = true;
  $("mStatus").innerHTML = '<span class="spinner"></span>Claude is writing the mode…';
  const r = await ov.buildMode(req);
  $("mBuild").disabled = false;
  if (!r.ok) { $("mStatus").innerHTML = `<span class="err">${esc(r.error)}</span>`; return; }
  S.modes = r.modes; S.activeMode = r.active;
  $("mStatus").innerHTML = `<span class="ok">Added "${esc(modeById(r.id).name)}". Click Use to switch to it, or Edit to adjust it.</span>`;
  $("mRequest").value = "";
  renderModes(); syncShortcutMode();
};
ov.onModeChanged((m) => { if (!S) return; S.activeMode = m.id; renderModes(); syncShortcutMode(); renderShortcuts(); });

// ---------- extra toggles ----------
$("notesSync").onchange = () => ov.setSetting("notesSync", $("notesSync").checked);
$("pShowMode").onchange = () => savePill({ showMode: $("pShowMode").checked });

// ---------- sign-in ----------
function renderAuth() {
  const a = S.auth || {};
  const gpt = a.provider === "chatgpt";
  document.querySelectorAll("#aiPick button").forEach((b) => b.classList.toggle("on", b.dataset.v === (a.provider || "claude")));
  $("claudeRow").style.display = gpt ? "none" : "";
  $("codexRow").style.display = gpt ? "" : "none";
  const c = a.codex || {};
  $("codexDesc").textContent = !c.installed ? "Cloak talks to ChatGPT through OpenAI's Codex CLI. Click Install (it needs Node.js, which Cloak already uses), then Sign in."
    : !c.loggedIn ? "Codex is installed. Click Sign in and choose Sign in with ChatGPT (Plus or Pro), then click Check."
    : `Signed in. ${c.detail || ""}`.trim();
  $("codexInstall").style.display = c.installed ? "none" : "";
  $("codexLogin").style.display = c.installed && !c.loggedIn ? "" : "none";
  $("authTitle").textContent = a.mode === "apiKey" ? "Anthropic API key" : "Claude subscription (Pro or Max)";
  $("authDesc").textContent = !a.claudeInstalled ? "Claude Code isn't installed yet. Open the setup guide to install it."
    : a.mode === "apiKey" ? `Using your API key ${a.keyHint || ""}. You pay Anthropic per use.` : "Using your Claude account's sign-in in Claude Code.";
}
// Where Cloak can be opened from (it adds itself there on start).
function renderLauncher(l) {
  const mac = l.where === "applications";
  $("launcherDesc").textContent = !l.ok ? "Cloak adds itself the next time it starts."
    : mac ? "Cloak is in your Applications folder: search for Cloak in Spotlight (Cmd+Space) or find it in Launchpad."
    : `Cloak is in the Start menu: press the Windows key and type Cloak.${l.desktop ? " There's also a shortcut on your desktop." : ""}`;
  $("launcherBtn").textContent = mac ? "Show in Finder" : l.desktop ? "On your desktop" : "Add to desktop";
  $("launcherBtn").disabled = !mac && l.desktop;
  $("launcherBtn").style.display = l.where ? "" : "none";
}
$("launcherBtn").onclick = async () => renderLauncher(await ov.launcherDesktop());
$("authChange").onclick = () => ov.openWelcome("connect");
$("aiPick").addEventListener("click", async (e) => {
  const v = e.target.dataset.v;
  if (!v || v === S.auth?.provider) return;
  S.auth = await ov.setProvider(v);
  renderAuth();
});
$("codexInstall").onclick = () => { ov.installCodex(); $("codexDesc").textContent = "Installing in the window that opened. When it says Done, click Check."; $("codexLogin").style.display = ""; };
$("codexLogin").onclick = () => { ov.openCodexLogin(); $("codexDesc").textContent = "Finish signing in in your browser, then click Check."; };
$("codexCheck").onclick = async () => {
  $("codexCheck").textContent = "Checking…";
  S.auth = { ...S.auth, codex: await ov.codexStatus() };
  $("codexCheck").textContent = "Check";
  renderAuth();
};
$("rerunSetup").onclick = () => ov.openWelcome("welcome");
$("restartApp").onclick = () => { $("restartApp").disabled = true; $("restartApp").textContent = "Restarting…"; ov.restartApp(); };

// ---------- load ----------
async function refresh() {
  S = await ov.getSettings();
  syncShortcutMode();
  renderAppearance(); renderTop(); renderNotify(); renderMemory(await ov.listMemories()); renderFiles(await ov.listMemoryFiles()); renderModes(); renderShortcuts(); renderWidgets(); renderClaude(); renderKeys(); renderAuth();
  $("openAtLogin").checked = S.openAtLogin;
  renderLauncher(await ov.launcherStatus());
  // Cloak Premium (lib/premium.js): nothing is marked until it launches.
  document.querySelectorAll("[data-premium]").forEach((el) => {
    el.querySelector(".premium-tag")?.remove();
    if (S.premium?.locked.includes(el.dataset.premium)) el.insertAdjacentHTML("beforeend", ' <span class="tag premium-tag">Premium</span>');
  });
  $("notesSync").checked = S.notesSync;
  $("pShowMode").checked = S.pill.showMode !== false;
  $("version").textContent = `Cloak ${S.version}`;
}
show("appearance");
refresh();
