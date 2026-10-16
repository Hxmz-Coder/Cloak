const $ = (id) => document.getElementById(id);
const body = document.body;

let tasks = [];
let showDone = false;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ICON_ASK = '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>';
const ICON_CAL = '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>';
const ICON_DEL = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

// Due dates are local "YYYY-MM-DD" strings.
const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
function dueLabel(due) {
  const today = fromIso(isoDay(new Date()));
  const days = Math.round((fromIso(due) - today) / 86400000);
  const cls = days < 0 ? "late" : days <= 1 ? "soon" : "";
  const text = days < -1 ? `overdue ${-days}d` : days === -1 ? "due yesterday" : days === 0 ? "due today" : days === 1 ? "due tomorrow"
    : days < 7 ? `due ${fromIso(due).toLocaleDateString([], { weekday: "short" })}` : `due ${fromIso(due).toLocaleDateString([], { month: "short", day: "numeric" })}`;
  return `<span class="due ${cls}">${text}</span>`;
}

// ---------- finding tasks ----------
window.overlay.onScanState((on) => $("scanBtn").classList.toggle("spinning", on));
$("scanBtn").onclick = async () => {
  if ($("scanBtn").classList.contains("spinning")) return;
  const r = await window.overlay.scanTasks({ activity: true, notes: true });
  if (r.error) flash(r.error);
  else flash(r.added.length ? `Added ${r.added.length} task${r.added.length > 1 ? "s" : ""}.` : "Nothing new found.");
};
function flash(text) {
  const el = document.createElement("div");
  el.className = "flash";
  el.textContent = text;
  $("list").prepend(el);
  setTimeout(() => el.remove(), 6000);
}

// ---------- list ----------
function row(t) {
  const el = document.createElement("div");
  el.className = `task${t.done ? " done" : ""}`;
  el.innerHTML = `
    <div class="box" title="${t.done ? "Mark not done" : "Mark done"}"></div>
    <div class="body">
      <div class="t">${esc(t.title)}</div>
      <div class="m"><span class="cat ${esc(t.category)}">${esc(t.category)}</span>
        ${t.due && !t.done ? " · " + dueLabel(t.due) : ""}
        ${t.source === "claude" ? ' · <span class="from" title="' + esc(t.note || "Added by Claude") + '">from Claude</span>' : ""} · ${ago(t.created)}</div>
    </div>
    <div class="acts">
      ${t.done ? "" : `<button class="icon-btn cal" title="${t.due ? "Change due date" : "Set a due date"}">${ICON_CAL}</button><input type="date" class="due-in" value="${esc(t.due || "")}">`}
      ${t.done ? "" : `<button class="icon-btn ask" title="Ask Claude to help with this">${ICON_ASK}</button>`}
      <button class="icon-btn del" title="Delete">${ICON_DEL}</button>
    </div>`;
  el.querySelector(".box").onclick = () => window.overlay.updateTask(t.id, { done: !t.done });
  el.querySelector(".del").onclick = () => window.overlay.removeTask(t.id);
  el.querySelector(".ask")?.addEventListener("click", () => window.overlay.taskHelp(t));
  const dueIn = el.querySelector(".due-in");
  el.querySelector(".cal")?.addEventListener("click", () => { try { dueIn.showPicker(); } catch { dueIn.focus(); } });
  dueIn?.addEventListener("change", () => window.overlay.updateTask(t.id, { due: dueIn.value || null }));
  return el;
}

function render() {
  const list = $("list");
  list.querySelectorAll(":scope > :not(.flash)").forEach((n) => n.remove());
  // dated tasks first (soonest first), then the rest newest first
  const open = tasks.filter((t) => !t.done).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || b.created - a.created);
  const done = tasks.filter((t) => t.done);
  $("count").textContent = open.length ? `${open.length} open` : "all clear";
  if (!open.length && !done.length) {
    list.insertAdjacentHTML("beforeend", '<div class="empty">No tasks yet. Add one below. Claude also adds things it notices you still need to do, from your screen and your notes.</div>');
  }
  open.forEach((t) => list.appendChild(row(t)));
  if (done.length) {
    const sec = document.createElement("div");
    sec.className = "section";
    sec.innerHTML = `<span>${showDone ? "▾" : "▸"} Done (${done.length})</span><button class="clear">Clear</button>`;
    sec.onclick = (e) => { if (e.target.classList.contains("clear")) return; showDone = !showDone; render(); };
    sec.querySelector(".clear").onclick = () => window.overlay.clearDone();
    list.appendChild(sec);
    if (showDone) done.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).forEach((t) => list.appendChild(row(t)));
  }
}

window.overlay.onTasksChanged((list) => { tasks = list; render(); });
window.overlay.onPanelShown(render);

$("newTask").addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const title = $("newTask").value.trim();
  if (!title) return;
  await window.overlay.addTask({ title, category: $("newCat").value, due: $("newDue").value || undefined });
  $("newTask").value = "";
  $("newDue").value = "";
  $("newDue").classList.remove("set");
});
$("newDue").addEventListener("change", () => $("newDue").classList.toggle("set", !!$("newDue").value));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") window.overlay.hidePanel(); });

setInterval(render, 60_000); // refresh "x min ago"
(async () => { tasks = await window.overlay.listTasks(); render(); })();
