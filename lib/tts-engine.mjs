// Text-to-speech for Talk: Kokoro (a small neural voice model) running locally through kokoro-js. Runs in its own
// process (Electron utilityProcess, started by lib/talk.js) so making speech never freezes the app. Nothing is
// sent online; the only download is the model, once (about 330 MB).
//
// Messages in:  { type: "load" }  { type: "speak", id, text, voice }
// Messages out: { type: "progress", text }  { type: "ready", voices }  { type: "audio", id, pcm: Float32Array, rate }  { type: "error", id?, message }
import path from "path";
import { pathToFileURL } from "url";

const DIR = process.env.CLOAK_VOICE_DIR;
const FAKE = process.env.CLOAK_VOICE_FAKE === "1"; // tests: no model, a short beep per sentence
const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const post = (m) => process.parentPort.postMessage(m);

let tts = null, loading = null;
async function load() {
  if (FAKE) return post({ type: "ready", voices: ["af_heart", "am_michael"] });
  loading ||= (async () => {
    const mod = (p) => import(pathToFileURL(path.join(DIR, "node_modules", ...p)).href);
    const tf = await mod(["@huggingface", "transformers", "dist", "transformers.node.mjs"]);
    tf.env.cacheDir = path.join(DIR, "models");
    const { KokoroTTS } = await mod(["kokoro-js", "dist", "kokoro.js"]);
    const seen = {};
    tts = await KokoroTTS.from_pretrained(MODEL, {
      dtype: "fp32", device: "cpu", // on this kind of CPU the full model is as fast as the compressed ones, and sounds better
      progress_callback: (p) => {
        if (p.status !== "progress" || !p.total) return;
        seen[p.file] = [p.loaded, p.total];
        const [got, all] = Object.values(seen).reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0]);
        post({ type: "progress", text: `Downloading the voice (one time): ${Math.round((got / all) * 100)}% of ${Math.round(all / 1e6)} MB` });
      },
    });
    await tts.generate("Hi.", { voice: "af_heart" }); // warm up, so the first real sentence isn't slow
  })();
  await loading;
  post({ type: "ready", voices: Object.keys(tts.voices) });
}

process.parentPort.on("message", async ({ data: m }) => {
  try {
    if (m.type === "load") await load();
    else if (m.type === "speak") {
      if (FAKE) {
        const pcm = new Float32Array(2400);
        for (let i = 0; i < pcm.length; i++) pcm[i] = 0.1 * Math.sin(i / 8);
        return post({ type: "audio", id: m.id, pcm, rate: 24000 });
      }
      await load();
      const a = await tts.generate(m.text, { voice: m.voice || "af_heart" });
      post({ type: "audio", id: m.id, pcm: a.audio, rate: a.sampling_rate });
    }
  } catch (e) {
    post({ type: "error", id: m.id, message: String(e?.message || e) });
  }
});
