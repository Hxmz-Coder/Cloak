// Listen panel: captures the computer's sound (Windows loopback, not the microphone; on a Mac, a virtual sound
// device such as BlackHole that the sound is routed through), cuts it into short clips
// at pauses, and sends them to be transcribed (lib/listen.js). Shows the transcript and the AI's responses.
const $ = (id) => document.getElementById(id);
const ov = window.overlay;
const body = document.body;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const IS_MAC = ov.platform === "darwin";
const IDLE_TEXT = IS_MAC ? "On a Mac it listens through BlackHole, a free sound driver (see the Mac part of the README)."
  : "Listens to your computer's sound, not your microphone.";
const MAC_NO_DEVICE = "a Mac can't share its sound with Cloak directly. Install BlackHole 2ch (free, from existential.audio/blackhole), " +
  "then in Audio MIDI Setup make a Multi-Output Device with your speakers and BlackHole, choose it as the sound output, and press Start listening again.";
const MAC_NO_ACCESS = "Cloak isn't allowed to use sound input. In System Settings > Privacy & Security > Microphone, turn on Terminal " +
  "(or Electron), then quit and start Cloak again.";

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
    : st.listening && st.mode ? "Listen mode: answers pop up as questions are asked."
    : st.listening ? "Listening to your computer's sound…"
    : st.detail || IDLE_TEXT;
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
  const q = item.q ? `<div class="q">${item.kind === "ask" ? "You asked" : "Heard"}: ${esc(item.q)}</div>` : "";
  el.innerHTML = q + esc(item.text) + `<span class="when">${clock(item.t)}</span>`;
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
// Listen mode turned on (from the mode menu, at startup, or Start here): capture the computer's sound.
ov.onListenCapture(async () => {
  if (capture) return;
  try { await startCapture(); }
  catch (e) {
    await ov.listenStop();
    $("status").textContent = `Couldn't capture the computer's sound: ${e.message}`;
    $("status").classList.add("err");
  }
});
ov.onListenFeed((item) => { st.feed.push(item); addCard(item); });

// ---------- capturing the computer's sound ----------
const RATE = 16000;
async function startCapture() {
  if (capture) return;
  const stream = IS_MAC ? await macSoundStream() : await windowsSoundStream();
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0; // never play the captured sound back out
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);

  const step = ctx.sampleRate / RATE;
  proc.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    // down to 16 kHz by averaging
    const out = new Float32Array(Math.floor(input.length / step));
    for (let i = 0; i < out.length; i++) {
      let acc = 0, n = 0;
      for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) { acc += input[j]; n++; }
      out[i] = acc / (n || 1);
    }
    feed(out);
  };
  capture = { stream, ctx, stop() { proc.onaudioprocess = null; stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); } };
}
// The system-audio grant comes from main (loopback); the screen video it insists on is dropped right away.
async function windowsSoundStream() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  stream.getVideoTracks().forEach((t) => t.stop());
  if (!stream.getAudioTracks().length) throw new Error("Windows didn't share the computer's sound.");
  return stream;
}
// macOS: Electron 33 can't capture the system's sound, so record from a virtual device the sound is routed into.
// Device names stay hidden until sound-input access is granted, hence the throwaway request first.
async function macSoundStream() {
  try {
    (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
  } catch (e) { throw new Error(e.name === "NotAllowedError" ? MAC_NO_ACCESS : e.message); }
  const dev = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === "audioinput" && /blackhole|loopback|soundflower/i.test(d.label));
  if (!dev) throw new Error(MAC_NO_DEVICE);
  // Raw sound: the voice-call clean-up (echo cancelling etc.) would mangle music and lectures.
  return navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: dev.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
}
function stopCapture() { capture?.stop(); capture = null; meter(0); }

// ---------- Talk mode: the microphone ----------
// Your voice, cut into what you said at each pause, sent to the chat (main turns it into text). While Claude's reply
// is read aloud, the microphone is ignored, so it doesn't answer itself.
let mic = null, speaking = false;
const micClips = makeSegmenter((pcm) => { if (!speaking) ov.talkHeard(pcm).catch(() => {}); }, { pause: 0.8, max: 20 });
async function startMic() {
  if (mic) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain(); mute.gain.value = 0;
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
  const step = ctx.sampleRate / RATE;
  proc.onaudioprocess = (e) => { if (!speaking) micClips(downsample(e.inputBuffer.getChannelData(0), step)); };
  mic = { stop() { proc.onaudioprocess = null; stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); } };
}
function stopMic() { mic?.stop(); mic = null; }
ov.onTalkCapture(async (on) => {
  if (!on) return stopMic();
  try { await startMic(); }
  catch (e) { $("status").textContent = `Talk mode couldn't use the microphone: ${e.message}`; $("status").classList.add("err"); }
});
ov.onTalkSpeaking((on) => { speaking = on; });

// 16 kHz sound in, clips out. "Speech" is anything clearly above the background level, so it works whatever the
// volume. A clip ends at a short pause after some speech (so a question is answered as soon as it's finished), or
// after max seconds; stretches with no speech are dropped.
function makeSegmenter(onClip, { pause = 0.5, max = 8, showLevel = false } = {}) {
  let chunks = [], len = 0, voiced = 0, quiet = 0, floor = 0.002;
  return (out) => {
    let sum = 0;
    for (let i = 0; i < out.length; i++) sum += out[i] * out[i];
    const rms = Math.sqrt(sum / (out.length || 1));
    if (showLevel) meter(rms);
    floor = rms < floor ? floor * 0.9 + rms * 0.1 : floor * 0.995 + rms * 0.005; // follows the quiet parts
    const talking = rms > Math.max(0.0015, floor * 2.5);
    chunks.push(out); len += out.length;
    if (talking) { voiced += out.length; quiet = 0; } else quiet += out.length;
    if ((voiced > 1 * RATE && quiet > pause * RATE) || len > max * RATE) {
      if (voiced > 0.4 * RATE) onClip(normalize(join(chunks, len)));
      chunks = []; len = 0; voiced = 0; quiet = 0;
    } else if (len > 6 * RATE && voiced < 0.2 * RATE) { chunks = []; len = 0; voiced = 0; quiet = 0; }
  };
}
const feed = makeSegmenter((pcm) => send(pcm), { showLevel: true }); // the computer's sound, for Listen
const downsample = (input, step) => {
  const out = new Float32Array(Math.floor(input.length / step));
  for (let i = 0; i < out.length; i++) {
    let acc = 0, n = 0;
    for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) { acc += input[j]; n++; }
    out[i] = acc / (n || 1);
  }
  return out;
};
// Quiet audio is boosted so the speech engine hears it clearly.
function normalize(a) {
  let peak = 0;
  for (let i = 0; i < a.length; i++) peak = Math.max(peak, Math.abs(a[i]));
  if (peak < 0.001 || peak > 0.5) return a;
  const g = Math.min(30, 0.8 / peak);
  for (let i = 0; i < a.length; i++) a[i] *= g;
  return a;
}
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
  let r;
  try { r = await ov.transcribe(queue.shift()); }
  catch (e) { r = { error: String(e.message || e) }; }
  finally { busy = false; }
  if (r?.error) { $("status").textContent = `Couldn't turn that into text: ${r.error}`; $("status").classList.add("err"); }
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
// Start / Stop switch Listen mode on and off (main then tells this panel to capture, or stops it).
$("toggle").onclick = async () => {
  if (st.listening) { stopCapture(); await ov.listenStop(); return; }
  const r = await ov.listenStart();
  if (r?.error) $("status").textContent = r.error;
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
