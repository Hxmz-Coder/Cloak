// Talk panel: records the microphone, cuts it into what you said at each pause (audio-clips.js) and sends it to be
// answered (lib/talk.js). Plays the answer as it arrives, sentence by sentence. While Claude is speaking (and for a
// moment after) the microphone is ignored, so it never answers itself.
const $ = (id) => document.getElementById(id);
const ov = window.overlay;
const body = document.body;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let st = null;
let mic = null;

// ---------- what main tells us ----------
function render() {
  body.classList.toggle("ready", !!st.installed);
  body.classList.toggle("on", st.active);
  body.classList.toggle("thinking", st.status === "thinking");
  $("toggle").textContent = st.active ? "Stop" : "Start talking";
  $("sub").textContent = st.active ? (st.mode ? "Talk mode" : "on") : "";
  $("setupSize").textContent = st.listenInstalled ? "about 330 MB" : "about 850 MB";
  showStatus();
  const sel = $("voice");
  if (!sel.options.length) sel.innerHTML = st.voices.map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join("");
  sel.value = st.voice;
  sel.disabled = !st.naturalVoice;
  $("note").textContent = st.installed && !st.naturalVoice ? "Using your computer's built-in voice until the natural voice is set up." : "";
}
function showStatus() {
  const s = $("status");
  s.classList.toggle("err", st.status === "error");
  s.textContent = st.status === "error" || st.status === "loading" || st.status === "installing" ? st.detail
    : speaking ? "Speaking… click the circle to interrupt."
    : st.status === "thinking" ? "Thinking…"
    : st.active ? "Listening. Just talk."
    : "Press Start, then just talk.";
  body.classList.toggle("speaking", speaking);
  if (st.status === "installing" || (!st.installed && st.status === "error")) $("setupStatus").textContent = st.detail;
}
function addLine(l) {
  const log = $("log");
  log.querySelector(".empty")?.remove();
  log.insertAdjacentHTML("beforeend", `<div class="line ${esc(l.who)}">${esc(l.text)}</div>`);
  log.scrollTop = log.scrollHeight;
}
function renderLog() {
  $("log").innerHTML = st.history.length ? "" : '<div class="empty">Your conversation shows up here.</div>';
  st.history.forEach(addLine);
}

ov.onTalkState((s) => { const cleared = st && s.history.length < st.history.length; st = s; render(); if (cleared) renderLog(); });
ov.onTalkLine(addLine);
ov.onTalkCapture(async (on) => {
  if (!on) return stopMic();
  try { await startMic(); }
  catch (e) { $("status").textContent = `Talk couldn't use the microphone: ${e.message}`; $("status").classList.add("err"); ov.talkStop(); }
});

// ---------- the microphone ----------
const RATE = audioClips.RATE;
// Stricter than Listen: a clip needs over half a second of clear speech, and room noise is never boosted, so the
// speech engine isn't handed noise to "hear" words in.
const clips = audioClips.makeSegmenter((pcm) => { if (!speaking && !tail) ov.talkHeard(pcm).catch(() => {}); },
  { pause: 0.7, max: 20, minSpeech: 0.6, above: 3, floorMin: 0.006, boost: false });
async function startMic() {
  if (mic) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain(); mute.gain.value = 0;
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
  const step = ctx.sampleRate / RATE;
  proc.onaudioprocess = (e) => {
    if (speaking || tail) return clips.reset();
    clips(audioClips.downsample(e.inputBuffer.getChannelData(0), step));
  };
  mic = { stream, stop() { proc.onaudioprocess = null; stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); } };
}
function stopMic() { mic?.stop(); mic = null; clips.reset(); }

// ---------- speaking: the natural voice's audio, played in order ----------
let player = null, queue = [], playing = null, speaking = false, tail = false, tailTimer = null;
function setSpeaking(on) {
  speaking = on;
  clearTimeout(tailTimer);
  if (!on) { tail = true; tailTimer = setTimeout(() => (tail = false), 600); } // the last word's echo dies out first
  showStatus();
}
function playNext() {
  if (playing || !queue.length) { if (!playing && !queue.length && speaking) setSpeaking(false); return; }
  const item = queue.shift();
  if (item.text) { // no natural voice yet: the system voice
    const u = new SpeechSynthesisUtterance(item.text);
    playing = { stop: () => speechSynthesis.cancel() };
    u.onend = u.onerror = () => { playing = null; playNext(); };
    speechSynthesis.speak(u);
    return;
  }
  player ||= new AudioContext();
  const buf = player.createBuffer(1, item.pcm.length, item.rate);
  buf.copyToChannel(item.pcm instanceof Float32Array ? item.pcm : new Float32Array(item.pcm), 0);
  const src = player.createBufferSource();
  src.buffer = buf;
  src.connect(player.destination);
  playing = { stop: () => { try { src.stop(); } catch {} } };
  src.onended = () => { playing = null; playNext(); };
  src.start();
}
function enqueue(item) { queue.push(item); if (!speaking) setSpeaking(true); playNext(); }
ov.onTalkAudio((a) => enqueue({ pcm: a.pcm, rate: a.rate }));
ov.onTalkSay((s) => enqueue({ text: s.text }));
ov.onTalkStopAudio(() => { queue = []; playing?.stop(); playing = null; speechSynthesis.cancel(); if (speaking) setSpeaking(false); });

// ---------- buttons ----------
$("setupBtn").onclick = async () => {
  $("setupBtn").disabled = true;
  const r = await ov.talkInstall();
  $("setupBtn").disabled = false;
  if (r?.error) $("setupStatus").textContent = r.error;
};
$("toggle").onclick = async () => {
  if (st.active) return ov.talkStop();
  const r = await ov.talkStart();
  if (r?.error) { $("status").textContent = r.error; $("status").classList.add("err"); }
};
$("orb").onclick = () => { if (speaking || st.status === "thinking") ov.talkInterrupt(); else if (!st.active) $("toggle").click(); };
$("voice").onchange = () => ov.talkSetVoice($("voice").value);
$("resetBtn").onclick = () => ov.talkReset();
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (speaking) ov.talkInterrupt(); else ov.hidePanel(); } });

(async () => { st = await ov.talkStatus(); render(); renderLog(); })();
