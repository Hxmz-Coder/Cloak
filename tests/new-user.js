// New-user test runs: launches Cloak with a brand-new, empty profile and acts like a first-time user.
// Each scenario records every window/console error, every Claude answer, and checks answers against known
// correct results where possible. Uses real Claude calls on your account, so it costs some usage.
//
//   npm run test:new-user -- <scenario>          (scenarios: see SCENARIOS below, or "all")
//   CLOAK_TEST_OUT=folder to choose where results go (default: tests/results)
//
// Run from the project folder. Each run uses its own throwaway data folder and never touches your real data.
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const scenario = process.env.CLOAK_SCENARIO || process.argv.find((a) => !a.startsWith("-") && SCENARIO_NAMES().includes(a)) || "first-run";
const profile = path.join(os.tmpdir(), `cloak-test-${scenario}-${Date.now()}`);
process.env.CLOAK_DATA_DIR = profile;
const outDir = process.env.CLOAK_TEST_OUT || path.join(__dirname, "results");
fs.mkdirSync(outDir, { recursive: true });
// Listen's speech engine: a stand-in, unless a real one is given (see the "listen" scenario).
const LECTURE = "Welcome back everyone. Remember that the biology exam is on Friday at three p m. Can anyone tell me what the mitochondria does?";
if (process.env.CLOAK_TEST_VOICE_DIR) process.env.CLOAK_VOICE_DIR = process.env.CLOAK_TEST_VOICE_DIR;
else { process.env.CLOAK_VOICE_FAKE = "1"; process.env.CLOAK_VOICE_FAKE_TEXT = LECTURE; }
// Quiet test profile: no notification sounds.
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, "config.json"), JSON.stringify({ notify: { sound: false } }));

// Test windows open far off-screen and never take focus, so a run doesn't get in the way of whatever you're
// doing on this PC. Positions read back as if on-screen. CLOAK_TEST_VISIBLE=1 shows them normally, to watch a run.
if (process.env.CLOAK_TEST_VISIBLE !== "1") {
  const OFF = -20000;
  const P = BrowserWindow.prototype;
  const { setBounds, getBounds, setPosition, getPosition } = P;
  P.setBounds = function (b, ...r) { return setBounds.call(this, b && b.x !== undefined ? { ...b, x: b.x + OFF } : b, ...r); };
  P.getBounds = function () { const b = getBounds.call(this); return { ...b, x: b.x - OFF }; };
  P.setPosition = function (x, y, ...r) { return setPosition.call(this, x + OFF, y, ...r); };
  P.getPosition = function () { const [x, y] = getPosition.call(this); return [x - OFF, y]; };
  P.show = function () { return this.showInactive(); };
  P.focus = function () {};
}

const results = [];
const errors = [];
const transcript = [];
process.on("uncaughtException", (e) => errors.push(`main: ${e.stack || e}`));
process.on("unhandledRejection", (e) => errors.push(`main (promise): ${e?.stack || e}`));
app.on("web-contents-created", (_e, wc) => {
  wc.on("console-message", (_ev, level, message, line, source) => {
    if (level >= 3) errors.push(`${wc.getTitle() || "window"}: ${message} (${path.basename(source || "")}:${line})`);
  });
  wc.on("render-process-gone", (_ev, d) => errors.push(`${wc.getTitle()}: renderer crashed (${d.reason})`));
});

const { toggleAll, checkTaskNotifications, listen, focus, talk } = require("../main.js");
const { taskNotifications, NotifyState, DEFAULT_NOTIFY } = require("../lib/notify");

// ---------- helpers ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (ch, ...a) => ipcMain._invokeHandlers.get(ch)({ sender: null }, ...a);
const findWin = (title) => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.getTitle() === title);
// Windows load at their own pace on a brand-new profile: wait up to 20s for one to exist.
async function win(title) {
  for (let i = 0; i < 80; i++) { const w = findWin(title); if (w) return w; await wait(250); }
  return null;
}
const js = (w, code) => w.webContents.executeJavaScript(`(async () => { try { ${code} } catch (e) { return "JSERR: " + e.message } })()`);
const pad = (n) => String(n).padStart(2, "0");
const iso = (off = 0) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function check(name, pass, detail = "") {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 1500) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : `  -- ${String(detail).slice(0, 300)}`}`);
}
// Ask in the chat and keep the transcript.
async function ask(text, label) {
  const t0 = Date.now();
  const r = await call("ask", { text });
  const ms = Date.now() - t0;
  transcript.push({ label: label || text.slice(0, 60), q: text, a: r.ok ? r.text : `ERROR: ${r.error}`, ms, approvals: r.approvals?.map((a) => `${a.title}: ${a.detail}`), tasksAdded: r.tasksAdded });
  return { ...r, ms, text: r.text || "" };
}
const has = (s, re) => re.test(String(s || ""));
// A small real PDF with lines of text (for Memory's saved files).
function makePdf(file, lines) {
  const text = lines.map((l, i) => `BT /F1 13 Tf 72 ${720 - i * 22} Td (${l.replace(/[()\\]/g, "")}) Tj ET`).join("\n");
  const objs = ["<</Type/Catalog/Pages 2 0 R>>", "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${text.length}>>\nstream\n${text}\nendstream`, "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"];
  let out = "%PDF-1.4\n";
  const offs = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(file, out, "latin1");
  return file;
}

// ---------- scenarios ----------
const SCENARIOS = {
  // The UI from first launch: setup guide, pill, bar, settings, panels. No Claude answers needed.
  async "first-run"() {
    const wel = await win("Claude Welcome");
    check("setup guide opens on first launch", wel && wel.isVisible());
    // click through the guide like a user
    for (let i = 0; i < 2; i++) await js(wel, `document.getElementById("nextBtn").click(); return 1`);
    await js(wel, `document.querySelector('#interests [data-v="school"]').click(); document.querySelector('#interests [data-v="coding"]').click(); return 1`);
    await js(wel, `document.getElementById("nextBtn").click(); return 1`);
    await wait(2500);
    const installTxt = await js(wel, `return document.getElementById("installStatus").innerText`);
    check("connect step detects Claude Code", /installed/i.test(installTxt), installTxt);
    await js(wel, `document.querySelector('#methods [data-v="apiKey"]').click(); return 1`);
    check("API key option shows the key box", (await js(wel, `return getComputedStyle(document.getElementById("keyBox")).display`)) !== "none");
    await js(wel, `document.querySelector('#methods [data-v="subscription"]').click(); document.getElementById("nextBtn").click(); return 1`);
    await wait(800);
    const picked = await js(wel, `return document.querySelector("#modeCards .card.on")?.dataset.id`);
    check("interest 'school' preselects Homework mode", picked === "homework", picked);
    for (let i = 0; i < 3; i++) { await js(wel, `document.getElementById("nextBtn").click(); return 1`); await wait(500); }
    check("finishing the guide saves onboarding and closes it", (await call("auth-status")).onboarded && !wel.isVisible());
    check("starting mode applied", (await call("get-modes")).active === "homework");

    const w = await win("Claude Widget");
    await wait(800);
    w.webContents.send("collapse"); await wait(600);
    const pill = await js(w, `return document.getElementById("pillInfo").innerText`);
    check("pill shows label and mode tag", /Claude/.test(pill) && /Homework/.test(pill), pill);
    w.webContents.send("welcome-back", 7); await wait(400);
    check("pill ignores 'welcome back'", (await js(w, `return document.getElementById("pillInfo").innerText`)) === pill);
    await js(w, `document.getElementById("shell").dispatchEvent(new Event("mouseenter")); return 1`); await wait(700);
    const tiles = await js(w, `return [...document.querySelectorAll(".tile")].map(t => t.innerText.trim())`);
    check("bar shows Homework shortcut buttons", tiles.includes("Check my work") && tiles.includes("Break into steps"), tiles.join(", "));
    const builtIn = (await call("panel-show", "tasks")).map((p) => p.label);
    check("Calendar and Pomodoro come built in", builtIn.includes("Calendar") && builtIn.includes("Pomodoro"), builtIn.join(", "));
    for (const id of ["calendar-mvcx691f", "pomodoro-mvam2qxu"]) {
      ipcMain.emit("toggle-panel", {}, id); await wait(1800);
      const bw = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes(`/widget/${id}/`));
      const errs = bw ? await js(bw, `return [...document.querySelectorAll(".widget-error")].map(e => e.textContent).join(" | ")`) : "no window";
      check(`built-in ${id.split("-")[0]} opens without errors`, bw?.isVisible() && !errs, errs);
      ipcMain.emit("toggle-panel", {}, id);
    }
    const wb = await js(w, `return document.querySelectorAll("#wbtns .icon-btn").length`);
    check("widget buttons render (tasks, notes, open-all)", wb >= 3, wb);

    // settings sections all render without errors
    ipcMain.emit("open-settings", {}, "appearance"); await wait(1800);
    const s = await win("Claude Settings");
    for (const sec of ["appearance", "top", "modes", "shortcuts", "widgets", "claude", "keys", "general"]) {
      const r = await js(s, `show("${sec}"); return document.querySelector("#s-${sec}").offsetHeight`);
      check(`settings: ${sec} section renders`, r > 50, r);
    }
    const sel = await js(s, `return [...document.querySelectorAll("#scMode option")].map(o => o.textContent)`);
    check("shortcut editor lists all modes", Array.isArray(sel) && sel.length >= 5, sel);
    const keys = await js(s, `show("keys"); return [...document.querySelectorAll(".key")].map(b => b.dataset.k + "=" + b.textContent)`);
    check("Keyboard settings include the Listen mode shortcut", keys.some((k) => /^listen=Ctrl\+Alt\+L$/.test(k)), keys.join(", "));
    const bad = await call("set-hotkey", "toggle", "Ctrl+Alt+NotAKey");
    check("invalid hotkey is rejected gracefully", bad && bad.ok === false, JSON.stringify(bad));
    await call("set-theme", { accent: "#5b8def", opacity: 0.7 });
    await wait(300);
    check("theme applies to the bar", /91,\s*141,\s*239/.test(await js(w, `return getComputedStyle(document.documentElement).getPropertyValue("--accent")`)));
    check("settings stays opaque", (await js(s, `return getComputedStyle(document.documentElement).getPropertyValue("--bg-alpha")`)).trim() === "1");

    // panels: open, add a task with a time, resize from an edge
    toggleAll(); await wait(1500);
    const t = await win("Claude Tasks");
    await js(t, `document.getElementById("addBtn").click(); return 1`);
    check("+ opens the add-task form", await js(t, `return getComputedStyle(document.querySelector(".addform")).display !== "none"`));
    await js(t, `document.getElementById("newTask").value = "Lab report"; document.getElementById("newDue").value = "${iso(1)}"; document.getElementById("newDue").dispatchEvent(new Event("change")); document.getElementById("newTime").value = "16:00"; document.getElementById("newTask").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); return 1`);
    await wait(600);
    const tl = await call("tasks-list");
    check("adding a task with a day and time from the panel", tl.some((x) => x.title === "Lab report" && x.due === iso(1) && x.time === "16:00"), JSON.stringify(tl));
    const shown = await js(t, `const r = document.querySelector(".task"); return { details: getComputedStyle(r.querySelector(".details")).opacity, title: r.querySelector(".t").textContent }`);
    check("a task shows just its title until you hover it", shown.title === "Lab report" && shown.details === "0", JSON.stringify(shown));
    const b0 = t.getBounds();
    await t.webContents.executeJavaScript(`window.overlay.setPanelBounds({ x: ${b0.x}, y: ${b0.y}, width: ${b0.width + 50}, height: ${b0.height + 40} })`);
    await wait(400);
    const b1 = t.getBounds();
    check("panel resizes", b1.width === b0.width + 50 && b1.height === b0.height + 40, JSON.stringify([b0, b1]));
    s.webContents.executeJavaScript(`window.overlay.resizePanel(300, 300)`); await wait(300);
    check("settings can't be resized", s.getBounds().width === 800);

    // A widget closed some other way (e.g. Alt+F4) opens again on the next click.
    t.close(); await wait(600);
    ipcMain.emit("toggle-panel", {}, "tasks"); await wait(1500);
    const t2 = await win("Claude Tasks");
    check("a closed widget reopens when clicked", t2 && !t2.isDestroyed() && t2.isVisible());

    // After sleep, Windows can end a hidden widget's page process: it used to "open" as an invisible empty window.
    t2.webContents.forcefullyCrashRenderer(); await wait(1200);
    ipcMain.emit("toggle-panel", {}, "tasks"); await wait(1800);
    const t3 = await win("Claude Tasks");
    const alive = t3 ? await js(t3, `return document.querySelectorAll(".task").length >= 0 && "alive"`) : null;
    check("a widget whose page died (e.g. after sleep) opens fine on the next click", t3 && t3.isVisible() && alive === "alive", alive);
    ipcMain.emit("toggle-panel", {}, "tasks"); await wait(400);
    const cal = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes("/widget/calendar-"));
    cal?.webContents.forcefullyCrashRenderer(); await wait(1200);
    require("electron").powerMonitor.emit("resume"); await wait(2500);
    ipcMain.emit("toggle-panel", {}, "calendar-mvcx691f"); await wait(1800);
    const cal2 = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes("/widget/calendar-"));
    const calOk = cal2 ? await js(cal2, `return document.getElementById("app").innerText.length > 0`) : false;
    check("after the PC wakes up, widgets still open with their content", cal2?.isVisible() && calOk === true, String(calOk));
    // The built-in Pomodoro tells Cloak while a focus session runs (for on-task checks).
    ipcMain.emit("toggle-panel", {}, "pomodoro-mvam2qxu"); await wait(1800);
    const pw = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes("/widget/pomodoro-"));
    const startBtn = pw ? await js(pw, `const b = [...document.querySelectorAll("button")].find((x) => /^Start focus/i.test(x.textContent.trim())); if (!b) return "no start button"; b.click(); return "ok"`) : "no window";
    await wait(1200);
    check("starting the Pomodoro tells Cloak a focus session is running", startBtn === "ok" && focus().focusSessionRunning(), startBtn);
    errors.splice(0, errors.length, ...errors.filter((e) => !/renderer crashed \(crashed\)/.test(e))); // the crashes above were on purpose
  },

  // Notifications from the top widget: deadlines, check-ins, answers. No Claude answers needed.
  async "notifications"() {
    await call("welcome-done", { profile: {}, mode: "general" });
    const w = await win("Claude Widget");
    const pad = (n) => String(n).padStart(2, "0");
    const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const inMin = (m) => new Date(Date.now() + m * 60_000);
    const island = () => js(w, `return { on: document.body.classList.contains("notifying"), mode: document.body.dataset.mode, title: document.getElementById("nTitle").textContent, body: document.getElementById("nBody").textContent, more: document.getElementById("nMore").textContent, acts: [...document.querySelectorAll("#nActions [data-act]")].map(b => b.dataset.act) }`);
    const clear = async () => { for (let i = 0; i < 6 && (await island()).on; i++) { await js(w, `document.getElementById("nClose").click(); return 1`); await wait(300); } };
    w.webContents.send("collapse"); await wait(500);
    const pillText = () => js(w, `return document.getElementById("pillInfo").innerText`);
    const pill0 = await pillText();

    // The rules, with a fake clock (no waiting).
    const st = new NotifyState(path.join(profile, "rules-test.json"));
    const CFG = { ...DEFAULT_NOTIFY, digest: false }; // the daily summary has its own checks below
    const base = new Date(2026, 9, 20, 14, 0);
    const T = (min, extra = {}) => { const due = new Date(base.getTime() + min * 60_000); return { id: "x" + min, title: `Task ${min}`, done: false, due: dayOf(due), time: hm(due), ...extra }; };
    let r = taskNotifications([T(45)], base, st, CFG);
    check("rule: 1 hour heads-up", r.length === 1 && /Due in 45 min/.test(r[0].body), JSON.stringify(r));
    r = taskNotifications([T(45)], base, st, CFG);
    check("rule: not shown twice", r.length === 0, JSON.stringify(r));
    r = taskNotifications([T(10)], base, st, CFG);
    check("rule: starting late shows only the latest stage", r.length === 1 && /Due in 10 min/.test(r[0].body) && r[0].urgent, JSON.stringify(r));
    r = taskNotifications([T(-45)], base, st, CFG);
    check("rule: check-in after the time passes", r.length === 1 && r[0].kind === "checkin" && r[0].actions.length === 2, JSON.stringify(r));
    st.snooze("x-45", 30);
    const snoozedUntil = st.snoozedUntil("x-45");
    check("rule: snoozed check-in waits", taskNotifications([T(-45)], new Date(snoozedUntil - 60_000), st, CFG).length === 0);
    const later = new Date(snoozedUntil + 60_000);
    const backAgain = taskNotifications([{ ...T(-45), due: dayOf(later), time: hm(new Date(later.getTime() - 40 * 60_000)) }], later, st, CFG);
    check("rule: snoozed check-in comes back", backAgain.some((x) => x.kind === "checkin"), JSON.stringify(backAgain));
    check("rule: moving a task re-arms it", taskNotifications([{ ...T(45), time: "14:50" }], base, st, CFG).length === 1);
    const morning = new Date(2026, 9, 21, 9, 5);
    r = taskNotifications([{ id: "d1", title: "Essay", due: "2026-10-21", done: false }, { id: "d2", title: "Old one", due: "2026-10-19", done: false }], morning, st, DEFAULT_NOTIFY);
    check("rule: morning summary of today and overdue", r.length === 1 && /1 task due today/.test(r[0].title) && /1 overdue/.test(r[0].body), JSON.stringify(r));
    r = taskNotifications([{ id: "d3", title: "Quiz", due: "2026-10-22", done: false }], new Date(2026, 9, 21, 18, 10), st, DEFAULT_NOTIFY);
    check("rule: evening heads-up for tomorrow", r.length === 1 && /Due tomorrow/.test(r[0].title), JSON.stringify(r));
    check("rule: switched-off kinds stay quiet", taskNotifications([T(30, { id: "q" })], base, st, { ...CFG, deadlines: false }).length === 0);

    // Real notifications in the top widget (the daily summary would also fire, depending on the time of day).
    await call("set-notify", { digest: false });
    const soon = inMin(10);
    await call("tasks-add", { title: "Dentist", category: "other", due: dayOf(soon), time: hm(soon) });
    checkTaskNotifications(); await wait(900);
    let n = await island();
    check("deadline pops out of the pill", n.on && n.mode === "notify" && n.title === "Dentist" && /Due in (9|10) min/.test(n.body), JSON.stringify(n));
    check("the pill grows into a card", w.getBounds().width >= 400 && w.getBounds().height >= 80, JSON.stringify(w.getBounds()));
    await js(w, `document.getElementById("island").click(); return 1`); await wait(1500);
    const tp = await win("Claude Tasks");
    check("clicking it opens Tasks at that task", tp.isVisible() && (await js(tp, `return document.querySelector(".task.focus .t")?.textContent`)) === "Dentist");
    check("the pill shrinks back afterwards", (await island()).on === false && (await js(w, `return document.body.dataset.mode`)) !== "notify");

    const past = inMin(-45);
    await call("tasks-add", { title: "Return library book", category: "other", due: dayOf(past), time: hm(past) });
    checkTaskNotifications(); await wait(900);
    n = await island();
    check("check-in asks if you finished", n.on && /Did you finish "Return library book"/.test(n.title) && n.acts.join() === "done,snooze", JSON.stringify(n));
    await js(w, `document.querySelector('#nActions [data-act="done"]').click(); return 1`); await wait(600);
    check("'Yes, done' marks the task done", (await call("tasks-list")).find((x) => x.title === "Return library book")?.done === true);

    // Answers: only when you're not looking at the chat.
    ipcMain.emit("chat-finished", {}, { watching: false, text: "The capital of **France** is Paris.", approvals: 0 }); await wait(800);
    n = await island();
    check("answer-ready notification with a preview", n.on && n.title === "Claude answered" && n.body === "The capital of France is Paris.", JSON.stringify(n));
    await js(w, `document.getElementById("island").click(); return 1`); await wait(800);
    check("clicking it opens the chat", (await js(w, `return document.body.dataset.mode`)) === "chat");
    ipcMain.emit("chat-finished", {}, { watching: true, text: "hi", approvals: 0 }); await wait(600);
    check("no notification while you're reading the chat", (await island()).on === false);
    w.webContents.send("collapse"); await wait(500);

    // Several at once queue up.
    ipcMain.emit("chat-finished", {}, { watching: false, text: "one", approvals: 1 });
    ipcMain.emit("chat-finished", {}, { watching: false, text: "two", approvals: 0 }); await wait(700);
    n = await island();
    check("notifications queue (+1 waiting)", n.title === "Claude needs your OK" && n.more === "+1", JSON.stringify(n));
    await clear(); await wait(400);
    // The pill only ever shows what you chose in Settings: no "Answer ready", "Working…", "Now: ..." or "Added tasks".
    w.webContents.send("collapse"); await wait(400);
    const pill1 = await pillText();
    check("the pill is unchanged after answers, deadlines and check-ins", pill1 === pill0, JSON.stringify([pill0, pill1]));
    await js(w, `setBusy(true); return 1`); await wait(200);
    const pill2 = await pillText();
    await js(w, `setBusy(false); return 1`);
    check("the pill doesn't change while Claude is working", pill2 === pill0, JSON.stringify([pill0, pill2]));

    // Hidden top widget: shown just for the notification, then hidden again.
    ipcMain.emit("hide-widget"); await wait(400);
    check("top widget can be hidden", !w.isVisible());
    ipcMain.emit("chat-finished", {}, { watching: false, text: "while hidden", approvals: 0 }); await wait(800);
    check("a notification shows even when the top widget is hidden", w.isVisible() && (await island()).on);
    await clear(); await wait(500);
    check("and it hides again afterwards", !w.isVisible());
    ipcMain.emit("focus");

    // Settings switches.
    await call("set-notify", { answers: false });
    ipcMain.emit("chat-finished", {}, { watching: false, text: "muted", approvals: 0 }); await wait(600);
    check("a switched-off kind doesn't show", (await island()).on === false);
    await call("set-notify", { answers: true, pausedUntil: Date.now() + 3600_000 });
    ipcMain.emit("chat-finished", {}, { watching: false, text: "paused", approvals: 0 }); await wait(600);
    check("pausing silences everything", (await island()).on === false);
    await call("set-notify", { pausedUntil: 0 });
    await call("notify-test"); await wait(700);
    check("Settings test notification works", (await island()).on);
    await clear();
    ipcMain.emit("open-settings", {}, "notify"); await wait(1500);
    const sw = await win("Claude Settings");
    const rows = await js(sw, `return document.querySelectorAll("#s-notify [data-n]").length`);
    check("Settings > Notifications lists its switches", rows === 9, rows);
  },

  // A student in Homework mode: answers checked against known results.
  async "student"() {
    await call("welcome-done", { profile: { interests: ["school"] }, mode: "homework" });
    await call("tasks-add", { title: "Chemistry lab report", category: "homework", due: iso(2), time: "09:00" });
    await call("tasks-add", { title: "Read chapter 5 of history", category: "homework", due: iso(4) });
    // On-task checks (Homework mode): with made-up screens, never a real screenshot of this PC.
    const fakeScreen = async (html) => {
      const fw = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: { offscreen: true } });
      await fw.loadURL("data:text/html," + encodeURIComponent(html));
      await wait(300);
      const img = await fw.webContents.capturePage();
      fw.destroy();
      return img.toPNG();
    };
    const offTask = await fakeScreen(`<body style="margin:0;font:28px Arial;background:#0f0f0f;color:#fff"><div style="background:#202020;padding:16px">YouTube &nbsp; <span style="background:#121212;padding:6px 200px">Search</span></div><div style="padding:40px">Shorts</div><div style="padding:0 40px"><div style="width:360px;height:420px;background:#e33;display:inline-block"></div> <b>Funniest cat fails of the week #shorts</b><br>12M views</div></body>`);
    const onTask = await fakeScreen(`<body style="margin:0;font:22px Arial;background:#f1f3f4"><div style="background:#fff;padding:14px;border-bottom:1px solid #ccc">Google Docs &nbsp; <b>Chemistry lab report</b></div><div style="background:#fff;width:800px;margin:30px auto;padding:60px;line-height:1.6"><h2>Lab Report: Titration of Acetic Acid</h2><p>Purpose: to determine the concentration of acetic acid in vinegar by titration with 0.1 M NaOH.</p><p>Procedure: 25.0 mL of vinegar was pipetted into a flask...</p></div></body>`);
    const f = focus();
    const realShot = f.hooks.screenshot;
    let shown = [];
    const realNotify = f.hooks.notify;
    f.hooks.notify = (n) => shown.push(n);
    f.hooks.screenshot = async () => offTask;
    f.lastCheck = 0; await f.tick();
    check("on-task check: YouTube during Homework mode gets a nudge", shown.length === 1 && /back|still/i.test(shown[0].title), JSON.stringify(shown));
    transcript.push({ label: "focus nudge", a: JSON.stringify(shown[0]) });
    shown = [];
    f.hooks.screenshot = async () => onTask;
    f.lastCheck = 0; await f.tick();
    check("on-task check: a lab report doc gets no nudge", shown.length === 0, JSON.stringify(shown));
    await call("set-setting", "focusChecks", { enabled: false });
    f.hooks.screenshot = async () => offTask;
    f.lastCheck = 0; await f.tick();
    check("on-task checks can be turned off", shown.length === 0);
    await call("set-setting", "focusChecks", { enabled: true });
    f.hooks.screenshot = realShot; f.hooks.notify = realNotify;

    const longQ = await ask("Explain how photosynthesis works.");
    const words = (longQ.text || "").split(/\s+/).filter(Boolean).length;
    check(`answers are short by default, even in Homework mode (${words} words)`, longQ.ok && words <= 110, longQ.text || longQ.error);
    transcript.push({ label: "short answer", a: longQ.text });
    let r = await ask("What is the derivative of x^3 + 2x?");
    check("derivative of x^3 + 2x = 3x^2 + 2", r.ok && has(r.text.replace(/\s/g, ""), /3x(\^2|²)\+2/), r.text || r.error);
    r = await ask("Check my work: 2x + 5 = 17, so 2x = 12, so x = 7.");
    // Accept any way of writing the right answer ("x = 6", "12 ÷ 2 = **6**", ...).
    check("catches the mistake (x = 6, not 7)", r.ok && has(r.text.replace(/\*/g, ""), /(x\s*=|÷\s*2\s*=|\/\s*2\s*=)\s*6\b/) && has(r.text, /mistake|error|not quite|incorrect|wrong|slip|off/i), r.text);
    r = await ask("What is 17 times 23?");
    check("17 x 23 = 391", r.ok && has(r.text, /391/), r.text);
    r = await ask("What is the capital of Australia?");
    check("capital of Australia is Canberra", r.ok && has(r.text, /Canberra/), r.text);
    r = await ask("What's today's date?");
    const d = new Date();
    check("knows today's date", r.ok && (has(r.text, new RegExp(d.toLocaleDateString("en-US", { month: "long" }))) && has(r.text, new RegExp(`\\b${d.getDate()}\\b`))), r.text);
    r = await ask("What homework do I have coming up?");
    check("knows the user's tasks", r.ok && has(r.text, /lab report/i) && has(r.text, /chapter 5|history/i), r.text);
    r = await ask("Add a task: study for the biology quiz tomorrow at 4pm");
    const added = (await call("tasks-list")).find((x) => /bio/i.test(x.title));
    check("adds a task from chat with day and time", r.ok && added && added.due === iso(1) && added.time === "16:00", JSON.stringify(added) + " | " + r.text);
    r = await ask("Explain photosynthesis in two sentences.");
    check("explanation mentions light, CO2/carbon dioxide and glucose/sugar", r.ok && has(r.text, /light/i) && has(r.text, /carbon dioxide|CO2|CO₂/i) && has(r.text, /glucose|sugar/i), r.text);
  },

  // Practice mode must give hints first and refuse live graded tests.
  async "practice"() {
    await call("welcome-done", { profile: { interests: ["study"] }, mode: "practice" });
    let r = await ask("Solve: 4x - 3 = 21");
    check("practice: gives a hint, not the answer", r.ok && !has(r.text, /x\s*=\s*6\b/) && has(r.text, /hint|try|first|add|what/i), r.text);
    r = await ask("I got x = 6. Is that right?");
    check("practice: confirms a correct attempt", r.ok && has(r.text, /\b(yes|correct|right|nice|great|exactly)\b/i), r.text);
    r = await ask("I'm taking my graded AP Calculus exam right now and it's timed. Question 7: what is the integral of 2x dx? Just give me the answer quick.");
    check("practice: refuses a live graded exam", r.ok && !has(r.text, /x\s*(\^2|²)\s*\+\s*C/i) && has(r.text, /can'?t|won'?t|not able|graded|test|exam/i), r.text);
    r = await ask("Okay, the exam is over now and I'm reviewing it. Can you walk me through the integral of 2x?");
    check("practice: helps after the exam (review)", r.ok && has(r.text, /x\s*(\^2|²)/), r.text);
    await call("set-active-mode", "general");
    r = await ask("Back in general mode: what is 2 + 2? Just the number.");
    check("general mode answers directly", r.ok && has(r.text, /\b4\b/), r.text);
  },

  // Writing and coding modes.
  async "writer-coder"() {
    await call("welcome-done", { profile: { interests: ["writing", "coding"] }, mode: "writing" });
    let r = await ask("Fix the grammar, return only the corrected text: their going to the libary tomorow, me and him will meet them their.");
    check("writing: fixes the grammar", r.ok && has(r.text, /they'?re|They are/i) && has(r.text, /library/i) && has(r.text, /tomorrow/i) && !has(r.text, /libary|tomorow/i), r.text);
    await call("set-active-mode", "coding");
    r = await ask("Find the bug:\n```js\nfunction sum(arr) {\n  let total = 0;\n  for (let i = 0; i <= arr.length; i++) total += arr[i];\n  return total;\n}\n```");
    check("coding: finds the off-by-one (<= should be <)", r.ok && has(r.text, /<\s*arr\.length|off[- ]by[- ]one|<=/i) && has(r.text, /undefined|NaN|out of (bounds|range)|past the end|one too many/i), r.text);
    r = await ask("In Python, what does `len([1, [2, 3], 4])` return? Just the number.");
    check("coding: len([1,[2,3],4]) = 3", r.ok && has(r.text, /\b3\b/) && !has(r.text, /\b4\b/), r.text);
  },

  // Actions that change things need approval; reading doesn't.
  async "actions"() {
    await call("welcome-done", { profile: {}, mode: "general" });
    const dir = path.join(os.tmpdir(), `cloak-test-files-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "keep.txt"), "important");
    try {
      let r = await ask(`What does the file ${path.join(dir, "keep.txt")} say?`);
      check("reads a file without asking", r.ok && has(r.text, /important/i) && !r.approvals?.length, r.text);
      r = await ask(`Delete the file ${path.join(dir, "keep.txt")}.`);
      check("deleting a file needs approval", r.ok && r.approvals?.length > 0 && fs.existsSync(path.join(dir, "keep.txt")), JSON.stringify(r.approvals) + " | " + r.text);
      await call("decline", { ids: (r.approvals || []).map((a) => a.id) });
      r = await ask("Okay, never mind. Is keep.txt still there?");
      check("declined action didn't happen", fs.existsSync(path.join(dir, "keep.txt")) && r.ok, r.text);
      r = await ask(`Create a file named hello.txt in ${dir} containing: hi from Cloak`);
      check("creating a file asks first", r.ok && r.approvals?.length > 0 && !fs.existsSync(path.join(dir, "hello.txt")), r.text);
      const ap = await call("approve", { ids: r.approvals.map((a) => a.id), always: [] });
      transcript.push({ label: "approve", a: ap.text || ap.error });
      check("approved action happens", ap.ok && fs.existsSync(path.join(dir, "hello.txt")) && /hi from Cloak/.test(fs.readFileSync(path.join(dir, "hello.txt"), "utf8")), ap.text || ap.error);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },

  // Notes become tasks; tricky lines shouldn't.
  async "notes"() {
    await call("welcome-done", { profile: {}, mode: "general" });
    toggleAll(); await wait(1500);
    await call("notes-set", [
      "Meeting notes 10/16",
      "- photosynthesis happens in the chloroplast",
      "- turn in permission slip by friday",
      "- maybe learn guitar someday?",
      "- dentist nov 3 at 2pm",
      "- call grandma",
      "Mitochondria is the powerhouse of the cell",
    ].join("\n"));
    let added = [];
    for (let i = 0; i < 20 && !added.length; i++) { await wait(5000); added = await call("tasks-list"); }
    transcript.push({ label: "notes -> tasks", a: JSON.stringify(added.map((t) => [t.title, t.due, t.time])) });
    const titles = added.map((t) => t.title.toLowerCase());
    check("notes: permission slip became a task", titles.some((t) => /permission slip/.test(t)), titles);
    check("notes: dentist became a task on Nov 3 at 2pm", added.some((t) => /dentist/i.test(t.title) && /-11-03$/.test(t.due || "") && t.time === "14:00"), JSON.stringify(added));
    check("notes: call grandma became a task", titles.some((t) => /grandma/.test(t)), titles);
    check("notes: facts and 'maybe someday' ideas were skipped", !titles.some((t) => /chloroplast|mitochondria|powerhouse|guitar/.test(t)), titles);
    // Screen memory may already have picked up real windows during the run, so either outcome is fine,
    // as long as it's a clean answer or a friendly message (not an error).
    const r = await call("recap");
    transcript.push({ label: "recap", a: r.ok ? r.text : `MESSAGE: ${r.error}` });
    check("recap gives an answer or a friendly message", (r.ok && r.text.length > 20) || (r.ok === false && /activity|memory/i.test(r.error)), r.error || r.text);
  },

  // Claude builds a mode and a widget for a new user.
  async "builders"() {
    await call("welcome-done", { profile: {}, mode: "general" });
    const m = await call("build-mode", "Help me prepare for job interviews: ask practice questions and give feedback on my answers.");
    const made = m.ok && m.modes.find((x) => x.id === m.id);
    check("builds a mode from a description", made && made.shortcuts.length >= 4 && made.instructions.length > 40, JSON.stringify(made || m));
    transcript.push({ label: "built mode", a: JSON.stringify(made) });
    const t0 = Date.now();
    const w = await call("widget-build", { request: "A simple focus timer: 25 minute countdown with start, pause and reset, and a count of sessions finished today." });
    check(`builds a widget (${Math.round((Date.now() - t0) / 1000)}s)`, w.ok, w.error);
    if (w.ok) {
      await wait(2500);
      const ww = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes(`/widget/${w.widget.id}/`));
      const errs = await js(ww, `return [...document.querySelectorAll(".widget-error")].map(e => e.textContent).join(" | ")`);
      check("built widget loads without errors", ww && !errs, errs);
      const txt = await js(ww, `return document.getElementById("app").innerText`);
      check("built widget shows a 25:00 timer", /25:00/.test(txt), txt.slice(0, 200));
      transcript.push({ label: "widget text", a: txt.slice(0, 400) });
    }

    // Claude changes the built-in Tasks widget, then it's restored.
    await call("tasks-add", { title: "Finish poster", category: "homework", due: iso(0) });
    const t1 = Date.now();
    const c = await call("widget-build", { request: "Add a line at the top that says how many tasks are due today, like '1 due today'.", id: "tasks" });
    check(`Claude changes the Tasks widget (${Math.round((Date.now() - t1) / 1000)}s)`, c.ok && c.panels.find((p) => p.name === "tasks")?.customized, c.error || JSON.stringify(c.panels));
    if (c.ok) {
      await wait(2500);
      const tw = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().startsWith("overlay://widget/tasks/"));
      const txt = tw ? await js(tw, `return document.getElementById("app").innerText`) : "";
      check("changed Tasks shows your tasks and the new line", /Finish poster/.test(txt) && /1\s+due today/i.test(txt), txt.slice(0, 300));
      const errs = tw ? await js(tw, `return [...document.querySelectorAll(".widget-error")].map(e => e.textContent).join(" | ")`) : "no window";
      check("changed Tasks loads without errors", !errs, errs);
      transcript.push({ label: "changed tasks text", a: txt.slice(0, 400) });
      const back = await call("widget-restore", "tasks");
      await wait(1500);
      check("Restore original brings back the built-in Tasks", !back.find((p) => p.name === "tasks").customized && !!(await win("Claude Tasks")));
    }
  },

  // ChatGPT through the Codex CLI, using tests/fake-codex.js in its place (no OpenAI account or network needed).
  async "chatgpt"() {
    process.env.CODEX_CLI_PATH = path.join(__dirname, "fake-codex.js");
    const logFile = path.join(profile, "codex-calls.jsonl");
    process.env.FAKE_CODEX_LOG = logFile;
    const calls = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
    const lastCall = () => calls().pop() || {};
    await call("welcome-done", { profile: {}, mode: "general" });

    const st = await call("set-provider", "chatgpt");
    check("switches to ChatGPT", st.provider === "chatgpt" && st.aiName === "ChatGPT" && st.codex?.installed && st.codex?.loggedIn, JSON.stringify(st));
    const agents = fs.readFileSync(path.join(profile, "claude-chat", "AGENTS.md"), "utf8");
    check("Codex gets its instructions in AGENTS.md", /You are ChatGPT/.test(agents) && /APPROVAL NEEDED/.test(agents) && !/Read tool/.test(agents));
    const w = await win("Claude Widget");
    await wait(300);
    check("chat bar says Ask ChatGPT", /Ask ChatGPT/.test(await js(w, `return document.getElementById("input").placeholder`)));

    let r = await ask("Please remember the word pineapple.");
    check("ChatGPT answers in the chat", r.ok && /ChatGPT here/.test(r.text), r.error || r.text);
    check("first message starts a read-only Codex run", lastCall().resume === false && lastCall().write === false && lastCall().args.includes("--json"), JSON.stringify(lastCall().args));
    r = await ask("What word did I ask you to remember?");
    check("follow-ups continue the same conversation", r.ok && /pineapple/.test(r.text) && lastCall().resume === true, r.text);
    r = await ask("Please list files in my Documents folder.");
    check("ChatGPT can run look-only commands", r.ok, r.error);

    r = await ask("Please create a file called notes.txt in Documents.");
    check("a change becomes an Allow card", r.ok && r.approvals?.length === 1 && r.approvals[0].title === "Create notes.txt in Documents" && !/APPROVAL NEEDED/.test(r.text), JSON.stringify(r));
    const a = await call("approve", { ids: [r.approvals[0].id], always: [] });
    check("Allow repeats it with write access", a.ok && /Created notes\.txt/.test(a.text) && lastCall().write === true, a.text || a.error);
    await ask("Thanks.");
    check("write access was only for that one turn", lastCall().write === false);

    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    r = await call("ask", { text: "What's on my screen?", image: png });
    check("screenshots are attached as images", r.ok && /I can see 1 image/.test(r.text) && lastCall().images.length === 1, r.text || r.error);

    check("Test sign-in works with ChatGPT", (await call("auth-test")).ok);
    const m = await call("build-mode", "Help me prepare for job interviews.");
    check("builds a mode with ChatGPT", m.ok && m.modes.some((x) => x.name === "Interview prep"), m.error);
    const b = await call("widget-build", { request: "A click counter." });
    check("builds a widget with ChatGPT", b.ok && b.widget.name === "Counter", b.error);
    const schemaCall = calls().find((c) => c.args.includes("--output-schema"));
    check("structured answers use --output-schema", !!schemaCall && schemaCall.args.includes("--ephemeral"));
    await call("notes-set", "Buy poster board");
    const sync = await call("notes-sync-now");
    check("notes turn into tasks with ChatGPT", sync && sync.added?.includes("Buy poster board"), JSON.stringify(sync));

    process.env.FAKE_CODEX_LOGGED_OUT = "1";
    const out = await call("codex-status");
    check("notices when ChatGPT isn't signed in", out.installed && !out.loggedIn, JSON.stringify(out));
    r = await ask("hello?");
    check("signed out: a clear message", !r.ok && /isn't signed in/.test(r.error), r.error);
    delete process.env.FAKE_CODEX_LOGGED_OUT;

    const back = await call("set-provider", "claude");
    check("switches back to Claude", back.provider === "claude" && /You are Claude/.test(fs.readFileSync(path.join(profile, "claude-chat", "AGENTS.md"), "utf8")));
    ipcMain.emit("open-settings", {}, "general"); await wait(1500);
    const s = await win("Claude Settings");
    const ui = await js(s, `return { pick: document.querySelectorAll("#aiPick button").length, restart: !!document.getElementById("restartApp") }`);
    check("Settings has the AI picker and Restart", ui.pick === 2 && ui.restart, JSON.stringify(ui));
  },

  // Listen (computer sound -> text -> AI responses) and Memory. Uses a stand-in speech engine unless
  // CLOAK_TEST_VOICE_DIR points at a real install (a folder with node_modules/@huggingface/transformers and models/).
  async "listen"() {
    const real = !!process.env.CLOAK_TEST_VOICE_DIR;
    await call("welcome-done", { profile: {}, mode: "general" });
    check("Listen is ready to use", (await call("listen-status")).installed);
    ipcMain.emit("toggle-panel", {}, "listen"); await wait(1500);
    const lp = await win("Claude Listen");
    const w = await win("Claude Widget");
    const island = () => js(w, `return { on: document.body.classList.contains("notifying"), title: document.getElementById("nTitle").textContent, body: document.getElementById("nBody").textContent }`);
    const clearIsland = async () => { for (let i = 0; i < 6 && (await island()).on; i++) { await js(w, `document.getElementById("nClose").click(); return 1`); await wait(300); } };
    check("Listen panel opens", lp && lp.isVisible() && (await js(lp, `return document.body.classList.contains("ready")`)));

    // Memory: added by you, and saved from a chat.
    await call("memories-add", "My name is Sam and I take AP Biology.");
    check("Settings can add a memory", (await call("memories-list")).some((m) => /Sam/.test(m.text)));

    // The Listen widget on its own: Start listens without changing the mode.
    await call("listen-start");
    await wait(1500);
    check("the widget starts listening without switching modes", (await call("listen-status")).listening && (await js(lp, `return !!capture`)) && (await call("get-modes")).active === "general");
    check("Listen is also in the mode list", (await call("get-modes")).modes.some((m) => m.id === "listen"));

    // Sound goes through the panel's own clip-cutter, quietly (computer audio is often quiet): the bug where the
    // level meter moved but nothing reached the transcript.
    let pcm;
    if (real) {
      const wav = path.join(profile, "lecture.wav");
      require("child_process").execFileSync("powershell.exe", ["-NoProfile", "-Command",
        `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono); $s.SetOutputToWaveFile('${wav}', $f); $s.Speak('${LECTURE}'); $s.Dispose()`], { windowsHide: true });
      const buf = fs.readFileSync(wav);
      const ints = new Int16Array(buf.buffer, buf.byteOffset + 44, (buf.length - 44) >> 1);
      pcm = Float32Array.from(ints, (v) => (v / 32768) * 0.04); // about as loud as a quiet video
    } else {
      pcm = new Float32Array(16000 * 4); // the stand-in engine only needs something that sounds like speech
      for (let i = 0; i < pcm.length; i++) pcm[i] = 0.01 * Math.sin(i / 7) * (Math.floor(i / 4000) % 2 ? 1 : 0.6);
    }
    const t0 = Date.now();
    await js(lp, `const pcm = new Float32Array(Uint8Array.from(atob("${Buffer.from(pcm.buffer).toString("base64")}"), (c) => c.charCodeAt(0)).buffer);
      for (let i = 0; i < pcm.length; i += 1365) feed(pcm.slice(i, i + 1365));
      for (let i = 0; i < 20; i++) feed(new Float32Array(1365)); return 1`);
    let heard = "";
    for (let i = 0; i < 40 && !/mitochondria/i.test(heard); i++) { await wait(1000); heard = await js(lp, `return document.getElementById("text").innerText`); }
    check(`quiet ${real ? "real speech" : "sound"} reaches the transcript (${((Date.now() - t0) / 1000).toFixed(1)}s)`, /biology exam/i.test(heard) && /mitochondria/i.test(heard), heard);
    transcript.push({ label: "transcribed", a: heard });

    // A question it hears is answered right away, without asking.
    let ans = null;
    for (let i = 0; i < 45 && !ans; i++) { await wait(2000); ans = (await call("listen-status")).feed.find((f) => f.kind === "answer"); }
    check(`it answers the question it heard (${((Date.now() - t0) / 1000).toFixed(0)}s after the audio)`, ans && /energy|ATP|powerhouse|respiration/i.test(ans.text) && /mitochondria/i.test(ans.q), JSON.stringify(ans));
    transcript.push({ label: "auto answer", a: JSON.stringify(ans) });
    check("the answer shows in the panel", /Heard:.*mitochondria/i.test(await js(lp, `return document.getElementById("feed").innerText`)));
    check("answers are a short script to read out, not an explanation", ans && ans.text.length < 180 && !/^(the answer is|answer:)/i.test(ans.text) && !/[*#]/.test(ans.text), ans?.text);
    check("the widget alone doesn't pop answers up", !(await island()).on);
    listen().addTranscript("Quick warm-up before we start. What's one plus one?");
    let sum = null;
    for (let i = 0; i < 45 && !sum; i++) { await wait(1500); sum = (await call("listen-status")).feed.find((f) => f.kind === "answer" && /one plus one/i.test(f.q)); }
    check("\"What's one plus one?\" -> just the answer", sum && /^(two|2)\.?$/i.test(sum.text.trim()), JSON.stringify(sum));

    // Listen mode: the same, plus every answer pops up right away to read out.
    await call("listen-stop");
    await wait(500);
    check("Stop in the widget stops listening", !(await call("listen-status")).listening);
    await call("set-active-mode", "listen");
    await wait(1500);
    check("Listen mode listens", (await call("listen-status")).listening && (await call("listen-status")).mode && (await js(lp, `return !!capture`)));
    listen().addTranscript("Okay, next one. Does anyone know the capital of France?");
    let pop = null;
    for (let i = 0; i < 45; i++) { await wait(1000); const n = await island(); if (n.on && /France/.test(n.title)) { pop = n; break; } }
    check("in Listen mode the answer pops up to read out", pop && /^Q:/.test(pop.title) && /Paris/.test(pop.body) && pop.body.length < 120, JSON.stringify(pop));
    check("the pop-up has a Copy button", await js(w, `return !!document.querySelector('#nActions [data-act="copy"]')`));
    await clearIsland();

    // Answers use what it was told to remember.
    await call("memories-add", "My biology teacher is Ms. Rivera.");
    listen().addTranscript("Okay, quick check before we start. What is the name of your biology teacher?");
    let ans2 = null;
    for (let i = 0; i < 45 && !ans2; i++) { await wait(2000); ans2 = (await call("listen-status")).feed.find((f) => f.kind === "answer" && /teacher/i.test(f.q)); }
    check("answers come from memory too", ans2 && /Rivera/.test(ans2.text), JSON.stringify(ans2));
    listen().addTranscript("How are you doing today?");
    await wait(15000);
    check("small talk isn't answered", !(await call("listen-status")).feed.some((f) => f.kind === "answer" && /how are you/i.test(f.q)));

    const said = await call("listen-respond-now");
    check("it also points out the deadline it heard", said && /friday|exam/i.test(said.text), JSON.stringify(said) + " feed: " + JSON.stringify((await call("listen-status")).feed.slice(-3)));
    transcript.push({ label: "listen response", a: JSON.stringify(said) });
    await wait(1500);
    check("it adds the exam it heard to Tasks", (await call("tasks-list")).some((t) => /exam|biology/i.test(t.title)), JSON.stringify((await call("tasks-list")).map((t) => t.title)));
    const asked = await call("listen-ask", "When is the exam?");
    check("you can ask about what was said", asked && /friday/i.test(asked.text), JSON.stringify(asked));

    let r = await ask("What question did the teacher just ask the class?");
    check("the chat knows what Listen heard", r.ok && /mitochondria/i.test(r.text), r.text || r.error);
    r = await ask("What's my name? Just the name.");
    check("the chat uses what it was told to remember", r.ok && /Sam/.test(r.text), r.text || r.error);
    r = await ask("Please remember that my locker number is 214.");
    check("telling the chat to remember saves it", r.ok && (r.remembered || []).some((x) => /214/.test(x)) && (await call("memories-list")).some((m) => /214/.test(m.text)), JSON.stringify(r));
    await call("reset");
    r = await ask("What's my locker number?");
    check("memories last beyond the conversation", r.ok && /214/.test(r.text), r.text || r.error);

    // Files: a PDF the AI reads once and keeps a summary of.
    const pdf = makePdf(path.join(profile, "syllabus.pdf"), ["AP Biology syllabus, fall semester", "Teacher: Ms. Rivera", "Final exam: December 12 at 9 AM in room B214", "Lab notebooks are due every Monday"]);
    const added = await call("memory-files-add", [pdf]);
    check("a PDF can be saved to memory", added.files?.length === 1 && !added.errors?.length, JSON.stringify(added));
    let mf = [];
    for (let i = 0; i < 90; i++) { mf = await call("memory-files-list"); if (mf[0]?.status !== "reading") break; await wait(2000); }
    check("the AI reads it and keeps a summary", mf[0]?.status === "ready" && /B214/.test(mf[0].summary), JSON.stringify(mf[0]));
    transcript.push({ label: "pdf summary", a: mf[0]?.summary || mf[0]?.error });
    r = await ask("Where and when is my biology final exam?");
    check("the chat answers from the saved PDF", r.ok && /B214/.test(r.text) && /December 12|Dec\.? 12/i.test(r.text), r.text || r.error);
    const bad = await call("memory-files-add", [path.join(profile, "config.json").replace(/json$/, "exe")]);
    check("unsupported files are refused clearly", bad.errors?.length === 1, JSON.stringify(bad.errors));

    const cap = await js(lp, `await startCapture(); const n = capture.stream.getAudioTracks().length; stopCapture(); return n`);
    check("captures the computer's sound (loopback)", cap === 1, cap);
    await call("listen-stop");
    await wait(800);
    check("Stop turns Listen mode off and stops capturing", !(await call("listen-status")).listening && (await call("get-modes")).active === "general" && !(await js(lp, `return !!capture`)));


    ipcMain.emit("open-settings", {}, "memory"); await wait(1500);
    const sw = await win("Claude Settings");
    const mem = await js(sw, `return { facts: document.querySelectorAll("#memList .item").length, files: document.querySelectorAll("#fileList .item").length }`);
    check("Settings > Memory lists what it remembers and its files", mem.facts >= 2 && mem.files === 1, JSON.stringify(mem));
    await call("memory-files-remove", mf[0].id);
    check("forgetting a file deletes Cloak's copy", !fs.existsSync(mf[0].path) && (await call("memory-files-list")).length === 0);
  },

  // Talk: you speak, Claude answers out loud. A stand-in microphone (never the real one), and the voice is recorded
  // instead of played. Real speech engine and voice if CLOAK_TEST_VOICE_DIR has both.
  async "talk"() {
    const real = !!process.env.CLOAK_TEST_VOICE_DIR;
    await call("welcome-done", { profile: {}, mode: "general" });
    ipcMain.emit("toggle-panel", {}, "talk"); await wait(1500);
    const tp = await win("Claude Talk");
    check("Talk widget opens, set up", tp && tp.isVisible() && (await call("talk-status")).installed);
    await js(tp, `navigator.mediaDevices.getUserMedia = async () => { const c = new AudioContext(); return c.createMediaStreamDestination().stream; };
      window.__played = []; enqueue = (item) => { window.__played.push({ at: performance.now(), what: item.text ? "system voice" : "voice " + item.pcm.length }); }; return 1`);
    const st = await call("talk-start");
    for (let i = 0; i < 60 && (await call("talk-status")).status === "loading"; i++) await wait(1000); // the voice loads once
    check("Start turns the microphone on, without changing the mode", st.ok && (await call("talk-status")).active && (await js(tp, `return !!mic`)) && (await call("get-modes")).active === "general");

    const speech = (text, level) => {
      if (!real) { const v = new Float32Array(16000 * 2); for (let i = 0; i < v.length; i++) v[i] = level * Math.sin(i / 6) * (0.6 + 0.4 * Math.sin(i / 900)); return v; }
      const wav = path.join(profile, `say-${Date.now()}.wav`);
      require("child_process").execFileSync("powershell.exe", ["-NoProfile", "-Command",
        `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono); $s.SetOutputToWaveFile('${wav}', $f); $s.Speak('${text}'); $s.Dispose()`], { windowsHide: true });
      const b = fs.readFileSync(wav);
      return Float32Array.from(new Int16Array(b.buffer, b.byteOffset + 44, (b.length - 44) >> 1), (x) => (x / 32768) * level);
    };
    const feedMic = (pcm) => js(tp, `const pcm = new Float32Array(Uint8Array.from(atob("${Buffer.from(pcm.buffer).toString("base64")}"), (c) => c.charCodeAt(0)).buffer);
      for (let i = 0; i < pcm.length; i += 1365) clips(pcm.slice(i, i + 1365));
      for (let i = 0; i < 20; i++) clips(new Float32Array(1365)); return performance.now()`);
    const lines = () => js(tp, `return [...document.querySelectorAll("#log .line")].map((l) => l.className.replace("line ", "") + ": " + l.textContent)`);

    // Background noise is not "heard" as words (this is what made Talk answer things nobody said).
    const noise = new Float32Array(16000 * 4);
    for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() - 0.5) * 0.008;
    await feedMic(noise); await wait(real ? 6000 : 2000);
    check("background noise isn't turned into a question", !(await lines()).some((l) => l.startsWith("you")), JSON.stringify(await lines()));

    const sent = await feedMic(speech("What is the capital of Japan?", real ? 0.5 : 0.05));
    let played = [];
    for (let i = 0; i < 60 && !played.length; i++) { await wait(500); played = await js(tp, `return window.__played`); }
    const firstVoice = played.length ? ((played[0].at - sent) / 1000).toFixed(1) : "never";
    let ls = [];
    for (let i = 0; i < 30 && !ls.some((l) => l.startsWith("claude")); i++) { await wait(500); ls = await lines(); }
    check("what you say shows up", ls.some((l) => real ? /you: .*japan/i.test(l) : /you: .*mitochondria/i.test(l)), JSON.stringify(ls));
    check("Claude answers, in a few spoken sentences", ls.some((l) => real ? /claude: .*tokyo/i.test(l) : /claude: .*(ATP|energy)/i.test(l)) && !ls.some((l) => /claude: .*[*#`]/.test(l)), JSON.stringify(ls));
    check(`the answer is spoken in the voice, starting ${firstVoice}s after you stop`, played.length && /^voice/.test(played[0].what) && Number(firstVoice) < 12, JSON.stringify(played.slice(0, 3)));
    transcript.push({ label: "talk", a: `${ls.join(" | ")} | first sound after ${firstVoice}s, ${played.length} sentence(s)` });

    // Interrupting stops the rest of the answer.
    await js(tp, `window.__played = []; return 1`);
    talk().respond("Tell me a story about a dragon and a knight in about eight sentences.").catch(() => {});
    for (let i = 0; i < 60 && !(await js(tp, `return window.__played.length`)); i++) await wait(500);
    ipcMain.emit("talk-interrupt"); await wait(300);
    const atStop = await js(tp, `return window.__played.length`);
    await wait(8000);
    const after = await js(tp, `return window.__played.length`);
    check("interrupting stops the rest of the answer", atStop >= 1 && after === atStop && (await call("talk-status")).status === "listening", `${atStop} -> ${after}`);

    ipcMain.emit("talk-set-voice", {}, "am_michael"); await wait(300);
    check("the voice can be changed", (await call("talk-status")).voice === "am_michael" && (await js(tp, `return document.getElementById("voice").value`)) === "am_michael");

    // Talk mode: the same, always on; Stop in the widget turns the mode off.
    await call("talk-stop"); await wait(600);
    check("Stop turns the microphone off", !(await call("talk-status")).active && !(await js(tp, `return !!mic`)));
    await call("set-active-mode", "talk"); await wait(1500);
    check("Talk mode listens", (await call("talk-status")).active && (await call("talk-status")).mode && (await js(tp, `return !!mic`)));
    await call("talk-stop"); await wait(800);
    check("Stop in Talk mode turns the mode off", (await call("get-modes")).active === "general" && !(await js(tp, `return !!mic`)));
  },

  // Sign-in errors and odd input.
  async "edge-cases"() {
    await call("welcome-done", { profile: {}, mode: "general" });
    let r = await call("auth-set", { mode: "apiKey", apiKey: "not-a-key" });
    check("rejects a malformed API key", r.ok === false && /sk-ant/.test(r.error), r.error);
    r = await call("auth-set", { mode: "apiKey", apiKey: "sk-ant-api03-" + "x".repeat(60) });
    const t = await call("auth-test");
    check("a fake API key gives a clear 'rejected' message", t.ok === false && /API key/i.test(t.error), t.error);
    await call("auth-set", { mode: "subscription" });
    check("switching back to subscription works", (await call("auth-test")).ok);
    const w = await win("Claude Widget");
    await js(w, `input.value = "<img src=x onerror=\\"document.title='HACKED'\\"> what is 1+1?"; submit(); return 1`);
    await wait(15000);
    check("HTML in a message is shown as text, not run", w.getTitle() !== "HACKED" && (await js(w, `return !!document.querySelector("#log img[src='x']")`)) === false);
    const recalled = await js(w, `input.value = ""; input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" })); return input.value`);
    check("Up arrow brings back the last message", /what is 1\+1/.test(recalled), recalled);
    await js(w, `input.value = ""; return 1`);
    r = await ask("x".repeat(15000) + "\n\nHow many characters did I just send you, roughly? Just a rough number.");
    check("very long message gets an answer", r.ok, r.error || r.text);
    const p = call("ask", { text: "Write a 500 word story about a lighthouse." });
    await wait(3000);
    await call("stop");
    const stopped = await p;
    check("stop works mid-answer", stopped.ok && stopped.stopped, JSON.stringify(stopped));
    r = await ask("Reply with just: ok");
    check("next message works after stopping", r.ok && /ok/i.test(r.text), r.text || r.error);
    await call("reset");
    r = await ask("Did I ask you for a story earlier in this chat? Answer yes or no.");
    check("new chat forgets the old conversation", r.ok && /\bno\b/i.test(r.text), r.text);
  },
};
function SCENARIO_NAMES() { return ["first-run", "notifications", "chatgpt", "listen", "talk", "student", "practice", "writer-coder", "actions", "notes", "builders", "edge-cases"]; }

// ---------- run ----------
app.whenReady().then(async () => {
  const started = Date.now();
  await wait(3500);
  try {
    await SCENARIOS[scenario]();
  } catch (e) {
    errors.push(`test crashed: ${e.stack || e}`);
  }
  await wait(500);
  const real = errors.filter((e) => !/Autofill|DevTools|cache/i.test(e));
  check("no errors in any window or the main process", real.length === 0, real.join("\n"));
  const report = { scenario, seconds: Math.round((Date.now() - started) / 1000), passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length, results, errors: real, transcript };
  fs.writeFileSync(path.join(outDir, `${scenario}-${Date.now()}.json`), JSON.stringify(report, null, 2));
  console.log(`\n${scenario}: ${report.passed} passed, ${report.failed} failed (${report.seconds}s)`);
  console.log(`PROFILE ${profile}`); // the runner deletes it once this process has fully exited
  // The chat keeps a Claude process running in the background; make sure everything goes away.
  app.exit(report.failed ? 1 : 0);
  setTimeout(() => process.exit(report.failed ? 1 : 0), 1500);
});
