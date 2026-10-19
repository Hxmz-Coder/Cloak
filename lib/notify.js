// Notifications that pop out of the top widget, like an iPhone's Dynamic Island: deadlines coming up, check-ins on
// tasks whose time has passed, a morning summary, answers that are ready, and alerts from widgets.
//
// This file decides *what* to show and remembers what was already shown (notify-state.json), so a restart
// doesn't repeat anything. main.js shows them and handles clicks.
const fs = require("fs");

// Settings > Notifications. Each kind can be switched off; "paused until" mutes everything for a while.
const DEFAULT_NOTIFY = {
  enabled: true,
  deadlines: true,  // due in 1 hour / 15 minutes / now
  checkins: true,   // "Did you finish ...?" a while after a task's time passes
  digest: true,     // morning: what's due today and what's overdue; evening: what's due tomorrow
  answers: true,    // Claude's answer is ready, or it needs your OK
  found: true,      // Claude added tasks from your notes or activity
  widgets: true,    // alerts from your widgets (a timer finishing, an event starting)
  sound: true,
  pausedUntil: 0,
};

const CHECKIN_AFTER_MIN = 30; // check in this long after a task's time
const SNOOZE_MIN = 30;
const DIGEST_HOUR = 9;
const TOMORROW_HOUR = 18;

const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (due, time) => { const [y, m, d] = due.split("-").map(Number); const [h, mi] = (time || "00:00").split(":").map(Number); return new Date(y, m - 1, d, h, mi); };
const fmtTime = (time) => at("2000-01-01", time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const list = (titles) => titles.slice(0, 2).join(", ") + (titles.length > 2 ? ` +${titles.length - 2} more` : "");

class NotifyState {
  constructor(file) {
    this.file = file;
    try { this.data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { this.data = {}; }
    this.data.fired ||= {};  // key -> when it was shown
    this.data.snooze ||= {}; // task id -> check in again after this time
  }
  save() {
    const weekAgo = Date.now() - 7 * 86400_000;
    for (const [k, t] of Object.entries(this.data.fired)) if (t < weekAgo) delete this.data.fired[k];
    for (const [k, t] of Object.entries(this.data.snooze)) if (t < weekAgo) delete this.data.snooze[k];
    try { fs.writeFileSync(this.file, JSON.stringify(this.data)); } catch {}
  }
  has(key) { return key in this.data.fired; }
  mark(...keys) { for (const k of keys) this.data.fired[k] ||= Date.now(); }
  snooze(taskId, minutes = SNOOZE_MIN) { this.data.snooze[taskId] = Date.now() + minutes * 60_000; this.save(); }
  snoozedUntil(taskId) { return this.data.snooze[taskId] || 0; }
}

/**
 * What to show now for the task list. Each notification is shown once: its key is remembered in `state`.
 * Returns [{ key, kind, title, body, target, actions?, sticky? }]. `cfg` is the notification settings.
 */
function taskNotifications(tasks, now, state, cfg) {
  const out = [];
  const open = tasks.filter((t) => !t.done);
  const today = isoDay(now);

  for (const t of open) {
    if (!t.due || !t.time) continue;
    const when = at(t.due, t.time);
    const mins = Math.round((when - now) / 60_000);
    const id = `${t.id}:${t.due}:${t.time}`; // moving the task re-arms its notifications
    const target = { type: "tasks", taskId: t.id };
    // Only the latest stage that applies is shown, so starting Cloak late doesn't replay the earlier ones.
    if (cfg.deadlines) {
      if (mins > 15 && mins <= 60 && !state.has(`hour:${id}`)) {
        state.mark(`hour:${id}`);
        out.push({ key: `hour:${id}`, kind: "deadline", title: t.title, body: `Due in ${mins} min · ${fmtTime(t.time)}`, target });
      } else if (mins > 0 && mins <= 15 && !state.has(`soon:${id}`)) {
        state.mark(`hour:${id}`, `soon:${id}`);
        out.push({ key: `soon:${id}`, kind: "deadline", urgent: true, title: t.title, body: `Due in ${mins} min · ${fmtTime(t.time)}`, target });
      } else if (mins <= 0 && mins > -CHECKIN_AFTER_MIN && !state.has(`now:${id}`)) {
        state.mark(`hour:${id}`, `soon:${id}`, `now:${id}`);
        out.push({ key: `now:${id}`, kind: "deadline", urgent: true, title: t.title, body: `Due now · ${fmtTime(t.time)}`, target,
          actions: [{ id: "done", label: "Done" }] });
      }
    }
    if (cfg.checkins && mins <= -CHECKIN_AFTER_MIN && mins > -12 * 60) {
      const snoozed = state.snoozedUntil(t.id);
      const key = `checkin:${id}:${snoozed}`; // a snooze makes a new check-in due
      if (!state.has(key) && now.getTime() >= snoozed) {
        state.mark(key, `hour:${id}`, `soon:${id}`, `now:${id}`);
        out.push({ key, kind: "checkin", sticky: true, title: `Did you finish "${t.title}"?`, body: `It was due at ${fmtTime(t.time)}.`, target,
          actions: [{ id: "done", label: "Yes, done" }, { id: "snooze", label: "Not yet" }] });
      }
    }
  }

  if (cfg.digest) {
    const dueToday = open.filter((t) => t.due === today);
    const overdue = open.filter((t) => t.due && t.due < today);
    if (now.getHours() >= DIGEST_HOUR && (dueToday.length || overdue.length) && !state.has(`digest:${today}`)) {
      state.mark(`digest:${today}`);
      const parts = [];
      if (dueToday.length) parts.push(list(dueToday.map((t) => t.title)));
      if (overdue.length) parts.push(`${overdue.length} overdue`);
      out.push({ key: `digest:${today}`, kind: "digest", title: dueToday.length ? `${plural(dueToday.length, "task")} due today` : `${plural(overdue.length, "task")} overdue`,
        body: parts.join(" · "), target: { type: "tasks" } });
    }
    const tmr = new Date(now); tmr.setDate(tmr.getDate() + 1);
    const dueTomorrow = open.filter((t) => t.due === isoDay(tmr));
    if (now.getHours() >= TOMORROW_HOUR && dueTomorrow.length && !state.has(`tomorrow:${today}`)) {
      state.mark(`tomorrow:${today}`);
      out.push({ key: `tomorrow:${today}`, kind: "digest", title: `Due tomorrow: ${plural(dueTomorrow.length, "task")}`,
        body: list(dueTomorrow.map((t) => t.title)), target: { type: "tasks" } });
    }
  }
  return out;
}

module.exports = { DEFAULT_NOTIFY, NotifyState, taskNotifications, isoDay };
