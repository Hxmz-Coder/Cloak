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

const { toggleAll } = require("../main.js");

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
    const bad = await call("set-hotkey", "toggle", "Ctrl+Alt+NotAKey");
    check("invalid hotkey is rejected gracefully", bad && bad.ok === false, JSON.stringify(bad));
    await call("set-theme", { accent: "#5b8def", opacity: 0.7 });
    await wait(300);
    check("theme applies to the bar", /91,\s*141,\s*239/.test(await js(w, `return getComputedStyle(document.documentElement).getPropertyValue("--accent")`)));
    check("settings stays opaque", (await js(s, `return getComputedStyle(document.documentElement).getPropertyValue("--bg-alpha")`)).trim() === "1");

    // panels: open, add a task with a time, resize from an edge
    toggleAll(); await wait(1500);
    const t = await win("Claude Tasks");
    await js(t, `document.getElementById("newTask").value = "Lab report"; document.getElementById("newDue").value = "${iso(1)}"; document.getElementById("newDue").dispatchEvent(new Event("change")); document.getElementById("newTime").value = "16:00"; document.getElementById("newTask").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); return 1`);
    await wait(600);
    const tl = await call("tasks-list");
    check("adding a task with a day and time from the panel", tl.some((x) => x.title === "Lab report" && x.due === iso(1) && x.time === "16:00"), JSON.stringify(tl));
    const b0 = t.getBounds();
    await t.webContents.executeJavaScript(`window.overlay.setPanelBounds({ x: ${b0.x}, y: ${b0.y}, width: ${b0.width + 50}, height: ${b0.height + 40} })`);
    await wait(400);
    const b1 = t.getBounds();
    check("panel resizes", b1.width === b0.width + 50 && b1.height === b0.height + 40, JSON.stringify([b0, b1]));
    s.webContents.executeJavaScript(`window.overlay.resizePanel(300, 300)`); await wait(300);
    check("settings can't be resized", s.getBounds().width === 800);
  },

  // A student in Homework mode: answers checked against known results.
  async "student"() {
    await call("welcome-done", { profile: { interests: ["school"] }, mode: "homework" });
    await call("tasks-add", { title: "Chemistry lab report", category: "homework", due: iso(2), time: "09:00" });
    await call("tasks-add", { title: "Read chapter 5 of history", category: "homework", due: iso(4) });
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
      const ww = BrowserWindow.getAllWindows().find((x) => x.getTitle().startsWith("Claude Widget:"));
      const errs = await js(ww, `return [...document.querySelectorAll(".widget-error")].map(e => e.textContent).join(" | ")`);
      check("built widget loads without errors", ww && !errs, errs);
      const txt = await js(ww, `return document.getElementById("app").innerText`);
      check("built widget shows a 25:00 timer", /25:00/.test(txt), txt.slice(0, 200));
      transcript.push({ label: "widget text", a: txt.slice(0, 400) });
    }
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
function SCENARIO_NAMES() { return ["first-run", "student", "practice", "writer-coder", "actions", "notes", "builders", "edge-cases"]; }

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
