// Listen panel: captures the computer's sound (Windows loopback, not the microphone), cuts it into short clips
// at pauses, and sends them to be transcribed (lib/listen.js). Shows the transcript and the AI's responses.
const $ = (id) => document.getElementById(id);
const ov = window.overlay;
const body = document.body;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

let st = null;      // status from main
let capture = null; // { stream, ctx, stop() }

// ---------- what main tells us ----------
function render() {
  body.classList.toggle("ready", !!st.installed);
  body.classList.toggle("listening", st.listening);
  $("toggle").querySelector("span").textContent = st.listening ? "Stop" : "Start listening";
  $("auto").checked = st.auto;
  const s = $("status");
  s.classList.toggle("err", st.status === "error");
  s.textContent = st.status === "error" ? st.detail
    : st.status === "loading" ? st.detail || "Starting the speech engine…"
    : st.listening ? "Listening to your computer's sound…"
    : st.detail || "Listens to your computer's sound, not your microphone.";
  $("sub").textContent = st.listening ? "on" : "";
  if (st.status === "installing" || (!st.installed && st.status === "error")) $("setupStatus").textContent = st.detail;
}
function renderFeed() {
  const f = $("feed");
  f.innerHTML = st.feed.length ? "" : `<div class="empty">When something's worth knowing, like a question you could answer or a deadline, the AI says so here. Ask it anything below.</div>`;
  st.feed.forEach(addCard);
}
function addCard(item) {
  const f = $("feed");
  f.querySelector(".empty")?.remove();
  f.querySelector(".thinking")?.remove();
  const el = document.createElement("div");
  el.className = `card${item.important ? " important" : ""}${item.kind === "error" ? " error" : ""}`;
  el.innerHTML = (item.q ? `<div class="q">You asked: ${esc(item.q)}</div>` : "") + esc(item.text) + `<span class="when">${clock(item.t)}</span>`;
  f.appendChild(el);
  f.scrollTop = f.scrollHeight;
}
function renderText() {
  const tx = $("text");
  tx.innerHTML = st.transcript.length ? "" : `<div class="empty">Nothing heard yet. Press Start listening, then play something.</div>`;
  st.transcript.forEach(addLine);
}
function addLine(s) {
  const tx = $("text");
  tx.querySelector(".empty")?.remove();
  const near = tx.scrollHeight - tx.scrollTop - tx.clientHeight < 60;
  tx.insertAdjacentHTML("beforeend", `<div class="line"><time>${clock(s.t)}</time>${esc(s.text)}</div>`);
  if (near) tx.scrollTop = tx.scrollHeight;
}

ov.onListenState((s) => {
  const was = st?.listening, cleared = st && (s.feed.length < st.feed.length || s.transcript.length < st.transcript.length);
  st = s;
  render();
  if (cleared) { renderFeed(); renderText(); }
  if (!s.listening && was) stopCapture();
});
ov.onListenTranscript((s) => { st.transcript.push(s); addLine(s); });
ov.onListenFeed((item) => { st.feed.push(item); addCard(item); });

// ---------- capturing the computer's sound ----------
const RATE = 16000;
async function startCapture() {
  // The system-audio grant comes from main (loopback); the screen video it insists on is dropped right away.
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  stream.getVideoTracks().forEach((t) => t.stop());
  if (!stream.getAudioTracks().length) throw new Error("Windows didn't share the computer's sound.");
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0; // never play the captured sound back out
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);

  const step = ctx.sampleRate / RATE;
  let chunks = [], len = 0, voiced = 0, quiet = 0;
  proc.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    // down to 16 kHz by averaging
    const out = new Float32Array(Math.floor(input.length / step));
    let sum = 0;
    for (let i = 0; i < out.length; i++) {
      let acc = 0, n = 0;
      for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) { acc += input[j]; n++; }
      out[i] = acc / (n || 1);
      sum += out[i] * out[i];
    }
    const rms = Math.sqrt(sum / (out.length || 1));
    meter(rms);
    chunks.push(out); len += out.length;
    if (rms > 0.008) { voiced += out.length; quiet = 0; } else quiet += out.length;
    // A clip ends at a pause after some speech, or at 15 seconds. Long stretches of silence are dropped.
    const pauseAfterSpeech = voiced > 1.5 * RATE && quiet > 0.7 * RATE;
    if (pauseAfterSpeech || len > 15 * RATE) {
      if (voiced > 0.6 * RATE) send(join(chunks, len));
      chunks = []; len = 0; voiced = 0; quiet = 0;
    } else if (len > 8 * RATE && voiced < 0.2 * RATE) { chunks = []; len = 0; voiced = 0; quiet = 0; }
  };
  capture = { stream, ctx, stop() { proc.onaudioprocess = null; stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); } };
}
function stopCapture() { capture?.stop(); capture = null; meter(0); }
const join = (chunks, len) => { const a = new Float32Array(len); let o = 0; for (const c of chunks) { a.set(c, o); o += c.length; } return a; };

// Clips are transcribed in order, one at a time; if the engine falls behind, the oldest waiting clips are dropped.
const queue = [];
let busy = false;
function send(pcm) {
  queue.push(pcm);
  while (queue.length > 4) queue.shift();
  pump();
}
async function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const r = await ov.transcribe(queue.shift());
  busy = false;
  if (r?.error) { $("status").textContent = r.error; $("status").classList.add("err"); }
  pump();
}

const bars = [...document.querySelectorAll("#meter span")];
function meter(rms) {
  const level = Math.min(1, rms * 12);
  bars.forEach((b, i) => (b.style.height = `${3 + Math.max(0, level - Math.abs(i - 2) * 0.18) * 13}px`));
}

// ---------- buttons ----------
$("setupBtn").onclick = async () => {
  $("setupBtn").disabled = true;
  const r = await ov.listenInstall();
  $("setupBtn").disabled = false;
  if (r?.error) $("setupStatus").textContent = r.error;
  st = await ov.listenStatus(); render();
};
$("toggle").onclick = async () => {
  if (st.listening) { stopCapture(); await ov.listenStop(); return; }
  const r = await ov.listenStart();
  if (r?.error) { $("status").textContent = r.error; return; }
  try { await startCapture(); }
  catch (e) {
    await ov.listenStop();
    $("status").textContent = `Couldn't capture the computer's sound: ${e.message}`;
    $("status").classList.add("err");
  }
};
$("auto").onchange = async () => { st = await ov.listenSetAuto($("auto").checked); render(); };
$("respondNow").onclick = async () => {
  if (!st.transcript.length) return addCard({ t: Date.now(), kind: "error", text: "Nothing heard yet." });
  showThinking();
  const item = await ov.listenRespondNow();
  if (!item) { $("feed").querySelector(".thinking")?.remove(); addCard({ t: Date.now(), kind: "say", text: "Nothing new worth pointing out." }); }
};
$("askInput").addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const q = $("askInput").value.trim();
  if (!q) return;
  $("askInput").value = "";
  showTab("feed");
  showThinking(q);
  await ov.listenAsk(q);
});
function showThinking(q) {
  $("feed").querySelector(".empty")?.remove();
  $("feed").insertAdjacentHTML("beforeend", `<div class="card thinking">${q ? `<div class="q">You asked: ${esc(q)}</div>` : ""}Thinking…</div>`);
  $("feed").scrollTop = $("feed").scrollHeight;
}
$("copyBtn").onclick = () => {
  ov.writeClipboard(st.transcript.map((s) => `[${clock(s.t)}] ${s.text}`).join("\n"));
  $("copyBtn").classList.add("on"); setTimeout(() => $("copyBtn").classList.remove("on"), 900);
};
$("clearBtn").onclick = async () => { await ov.listenClear(); };
document.querySelector(".tabs").addEventListener("click", (e) => { if (e.target.dataset.tab) showTab(e.target.dataset.tab); });
function showTab(name) {
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("on", p.id === name));
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.activeElement !== $("askInput")) ov.hidePanel(); });

(async () => { st = await ov.listenStatus(); render(); renderFeed(); renderText(); })();
