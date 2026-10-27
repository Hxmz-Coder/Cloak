// Welcome / setup guide: about you, connecting Claude (subscription or API key), a starting mode, and a tour.
const $ = (id) => document.getElementById(id);
const ov = window.overlay;
const IS_MAC = ov.platform === "darwin";
if (IS_MAC) $("installHelp").innerHTML = "This opens a Terminal window and runs Anthropic's official installer. Or run it yourself: <code>curl -fsSL https://claude.ai/install.sh | bash</code>";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const STEPS = ["welcome", "about", "connect", "mode", "tour", "done"];
let step = 0;
let method = "subscription";
let connected = false;
let chosenMode = "general";
let modes = [];

// ---------- navigation ----------
function go(i) {
  step = Math.max(0, Math.min(STEPS.length - 1, i));
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("on", p.dataset.step === STEPS[step]));
  $("dots").innerHTML = STEPS.map((_, j) => `<i class="${j <= step ? "on" : ""}"></i>`).join("");
  $("backBtn").style.visibility = step === 0 ? "hidden" : "visible";
  $("skipBtn").style.visibility = step === STEPS.length - 1 ? "hidden" : "visible";
  $("nextBtn").textContent = step === 0 ? "Get started" : step === STEPS.length - 1 ? "Start using Cloak" : "Next";
  if (STEPS[step] === "connect") checkInstall().then(checkSignedIn);
  if (STEPS[step] === "mode") renderModes();
  if (STEPS[step] === "done") renderDone();
}
$("nextBtn").onclick = () => (step === STEPS.length - 1 ? finish() : go(step + 1));
$("backBtn").onclick = () => go(step - 1);
$("skipBtn").onclick = finish;
ov.onWelcomeStep((s) => { const i = STEPS.indexOf(s); if (i >= 0) go(i); });
ov.onPanelShown(() => { if (STEPS[step] === "connect") checkInstall(); });

async function finish() {
  const interests = [...document.querySelectorAll("#interests .chip.on")].map((c) => c.dataset.v);
  await ov.welcomeDone({ profile: { name: $("name").value.trim(), interests }, mode: chosenMode });
}

// ---------- about you ----------
$("interests").addEventListener("click", (e) => {
  const c = e.target.closest(".chip");
  if (c) { c.classList.toggle("on"); suggestMode(); }
});
// The first interest picks the starting mode (you can still change it on the Mode step).
function suggestMode() {
  const map = { school: "homework", study: "practice", writing: "writing", coding: "coding" };
  const first = [...document.querySelectorAll("#interests .chip.on")].map((c) => map[c.dataset.v]).find(Boolean);
  chosenMode = first || "general";
}

// ---------- connect Claude ----------
function setMethod(m) {
  method = m;
  document.querySelectorAll("#methods .card").forEach((c) => c.classList.toggle("on", c.dataset.v === m));
  $("subBox").style.display = m === "subscription" ? "" : "none";
  $("keyBox").style.display = m === "apiKey" ? "" : "none";
}
$("methods").addEventListener("click", (e) => { const c = e.target.closest(".card"); if (c) setMethod(c.dataset.v); });

async function checkInstall() {
  $("installStatus").className = "status";
  $("installStatus").innerHTML = '<span class="spinner"></span>Checking…';
  const s = await ov.authStatus();
  if (s.mode) setMethod(method === "apiKey" || s.mode === "apiKey" ? (method === "apiKey" ? "apiKey" : s.mode) : "subscription");
  if (s.claudeInstalled) {
    $("installStatus").className = "status ok";
    $("installStatus").textContent = "Claude Code is installed.";
    $("n1").classList.add("ok"); $("n1").textContent = "✓";
    $("installActions").style.display = "none";
    $("installHelp").style.display = "none";
  } else {
    $("installStatus").className = "status";
    $("installStatus").textContent = "Claude Code isn't installed yet.";
    $("n1").classList.remove("ok"); $("n1").textContent = "1";
    $("installActions").style.display = "";
    $("installHelp").style.display = "";
  }
  if (s.mode === "apiKey" && s.keyHint) $("apiKey").placeholder = `Saved: ${s.keyHint} (paste a new key to replace it)`;
  return s;
}
$("installBtn").onclick = () => {
  ov.installClaude();
  $("installStatus").innerHTML = `<span class="spinner"></span>Installing in the ${IS_MAC ? "Terminal" : "PowerShell"} window that opened. This takes about a minute…`;
  watchFor(async () => (await ov.authStatus()).claudeInstalled, () => { checkInstall(); checkSignedIn(); });
};
// Checks every few seconds (for up to 6 minutes) until a step is done, then calls done().
let watching = null;
function watchFor(test, done) {
  clearInterval(watching);
  const until = Date.now() + 6 * 60_000;
  watching = setInterval(async () => {
    if (Date.now() > until) return clearInterval(watching);
    if (await test()) { clearInterval(watching); done(); }
  }, 3000);
}
// Already signed in with a Claude subscription? Then step 2 is done (this check costs nothing).
async function checkSignedIn() {
  if (method !== "subscription") return false;
  const s = await ov.claudeSignInStatus();
  if (!s.loggedIn || s.method !== "claude.ai") return false;
  connected = true;
  $("subStatus").className = "status ok";
  $("subStatus").textContent = `Signed in${s.email ? ` as ${s.email}` : ""}. Claude is ready.`;
  $("n2").classList.add("ok"); $("n2").textContent = "✓";
  return true;
}
$("recheckBtn").onclick = checkInstall;

$("loginBtn").onclick = async () => {
  const s = await checkInstall();
  if (!s.claudeInstalled) { $("subStatus").className = "status err"; $("subStatus").textContent = "Install Claude Code first (step 1)."; return; }
  await ov.setAuth({ mode: "subscription" });
  ov.openClaudeLogin();
  $("subStatus").className = "status";
  $("subStatus").innerHTML = '<span class="spinner"></span>Waiting for you to sign in in your browser…';
  watchFor(checkSignedIn, () => {});
};
$("plansLink").onclick = () => ov.openExternal("https://claude.ai/upgrade");
if (IS_MAC) {
  $("installWhat").textContent = "A Terminal window opens and runs Anthropic's official installer. It takes about a minute, and Cloak ticks this step off by itself when it's done.";
  $("termName").textContent = "Terminal";
  $("installCmd").textContent = "curl -fsSL https://claude.ai/install.sh | bash";
}
async function test(statusEl, numEl) {
  statusEl.className = "status";
  statusEl.innerHTML = '<span class="spinner"></span>Testing…';
  const r = await ov.testAuth();
  connected = r.ok;
  statusEl.className = `status ${r.ok ? "ok" : "err"}`;
  statusEl.textContent = r.ok ? "Connected. Claude is ready." : r.error;
  numEl.classList.toggle("ok", r.ok);
  numEl.textContent = r.ok ? "✓" : "2";
}
$("testSubBtn").onclick = async () => {
  await ov.setAuth({ mode: "subscription" });
  test($("subStatus"), $("n2"));
};
$("saveKeyBtn").onclick = async () => {
  const key = $("apiKey").value.trim();
  const r = await ov.setAuth({ mode: "apiKey", apiKey: key || undefined });
  if (!r.ok) { $("keyStatus").className = "status err"; $("keyStatus").textContent = r.error; return; }
  $("apiKey").value = "";
  if (r.status.keyHint) $("apiKey").placeholder = `Saved: ${r.status.keyHint}`;
  test($("keyStatus"), $("n2k"));
};
$("consoleLink").onclick = () => ov.openExternal("https://console.anthropic.com/settings/keys");

// ---------- mode ----------
async function renderModes() {
  if (!modes.length) modes = (await ov.getModes()).modes;
  $("modeCards").innerHTML = modes.map((m) => `
    <button class="card ${m.id === chosenMode ? "on" : ""}" data-id="${esc(m.id)}"><b>${esc(m.name)}</b><span>${esc(m.description || "")}</span></button>`).join("");
}
$("modeCards").addEventListener("click", (e) => {
  const c = e.target.closest(".card");
  if (!c) return;
  chosenMode = c.dataset.id;
  document.querySelectorAll("#modeCards .card").forEach((x) => x.classList.toggle("on", x === c));
});

// ---------- tour ----------
document.querySelectorAll("[data-tour]").forEach((b) => (b.onclick = () => ov.tour(b.dataset.tour)));

// ---------- done ----------
async function renderDone() {
  const name = $("name").value.trim();
  $("doneTitle").textContent = name ? `You're all set, ${name}` : "You're all set";
  const m = modes.find((x) => x.id === chosenMode);
  $("doneSub").textContent = `Starting in ${m ? m.name : "General"} mode.`;
  const s = await ov.authStatus();
  $("doneWarn").style.display = !s.claudeInstalled || !connected ? "" : "none";
  $("doneWarn").textContent = !s.claudeInstalled
    ? "Claude Code isn't installed yet, so Claude can't answer. Go back to Connect Claude to finish."
    : "You haven't tested the connection. If Claude doesn't answer, open this guide again from Settings > General.";
}

// ---------- start ----------
(async () => {
  const st = await ov.getSettings();
  const pretty = (a) => IS_MAC ? a.replace(/CommandOrControl|Super/g, "Cmd").replace(/Control/g, "Ctrl").replace(/Alt/g, "Option")
    : a.replace(/CommandOrControl/g, "Ctrl").replace(/Super/g, "Win");
  $("kToggle").textContent = $("kToggle2").textContent = pretty(st.hotkeys.toggle);
  $("kCapture").textContent = pretty(st.hotkeys.capture);
  chosenMode = st.activeMode || "general";
  setMethod(st.auth?.mode || "subscription");
  go(0);
})();
