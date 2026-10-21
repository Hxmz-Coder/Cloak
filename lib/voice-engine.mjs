// Speech-to-text for Listen: Whisper (base.en) running locally through transformers.js. Runs in its own process
// (Electron utilityProcess, started by lib/listen.js), so transcribing never freezes the app. Nothing is sent
// online; the only download is the engine and the model, once.
//
// Messages in:  { type: "load" }  { type: "transcribe", id, pcm: Float32Array (16 kHz mono) }
// Messages out: { type: "progress", text }  { type: "ready" }  { type: "text", id, text }  { type: "error", id?, message }
import path from "path";
import { pathToFileURL } from "url";

const DIR = process.env.CLOAK_VOICE_DIR;          // where the engine was installed (has node_modules/ and models/)
const FAKE = process.env.CLOAK_VOICE_FAKE === "1"; // tests: no engine, canned text
const MODEL = "onnx-community/whisper-base.en";
const post = (m) => process.parentPort.postMessage(m);

let asr = null, loading = null;
async function load() {
  if (FAKE) return post({ type: "ready" });
  loading ||= (async () => {
    const tf = await import(pathToFileURL(path.join(DIR, "node_modules", "@huggingface", "transformers", "dist", "transformers.node.mjs")).href);
    tf.env.cacheDir = path.join(DIR, "models");
    tf.env.allowLocalModels = false;
    const seen = {};
    asr = await tf.pipeline("automatic-speech-recognition", MODEL, {
      dtype: "q8",
      progress_callback: (p) => {
        if (p.status !== "progress" || !p.total) return;
        seen[p.file] = [p.loaded, p.total];
        const [got, all] = Object.values(seen).reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0]);
        post({ type: "progress", text: `Downloading the speech model (one time): ${Math.round((got / all) * 100)}% of ${Math.round(all / 1e6)} MB` });
      },
    });
  })();
  await loading;
  post({ type: "ready" });
}

process.parentPort.on("message", async ({ data: m }) => {
  try {
    if (m.type === "load") await load();
    else if (m.type === "transcribe") {
      if (FAKE) return post({ type: "text", id: m.id, text: process.env.CLOAK_VOICE_FAKE_TEXT || `Fake transcript of ${(m.pcm.length / 16000).toFixed(1)} seconds.` });
      await load();
      const r = await asr(m.pcm, { chunk_length_s: 30 });
      post({ type: "text", id: m.id, text: String(r.text || "").trim() });
    }
  } catch (e) {
    post({ type: "error", id: m.id, message: String(e?.message || e) });
  }
});
