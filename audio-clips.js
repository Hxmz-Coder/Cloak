// Cuts live sound into clips of speech, for Listen (the computer's sound) and Talk (your microphone).
// "Speech" is sound clearly above the background level, which is tracked as it changes, so it works at any volume.
// A clip ends at a short pause after enough speech, or at a maximum length; stretches without speech are dropped.
(() => {
  const RATE = 16000;

  const join = (chunks, len) => { const a = new Float32Array(len); let o = 0; for (const c of chunks) { a.set(c, o); o += c.length; } return a; };
  // Quiet clips are boosted so the speech engine hears them (Listen). Not for the microphone: boosting room noise
  // is exactly what makes the speech engine "hear" words nobody said.
  function normalize(a) {
    let peak = 0;
    for (let i = 0; i < a.length; i++) peak = Math.max(peak, Math.abs(a[i]));
    if (peak < 0.001 || peak > 0.5) return a;
    const g = Math.min(30, 0.8 / peak);
    for (let i = 0; i < a.length; i++) a[i] *= g;
    return a;
  }
  // Down to 16 kHz by averaging.
  function downsample(input, step) {
    const out = new Float32Array(Math.floor(input.length / step));
    for (let i = 0; i < out.length; i++) {
      let acc = 0, n = 0;
      for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) { acc += input[j]; n++; }
      out[i] = acc / (n || 1);
    }
    return out;
  }

  /**
   * Returns feed(chunk): call it with 16 kHz chunks. onClip(pcm) gets each clip.
   * pause: seconds of quiet that end a clip; max: longest clip; minSpeech: seconds of speech a clip needs;
   * above: how far over the background level counts as speech; floorMin: never treat quieter than this as speech;
   * boost: normalize quiet clips; onLevel(rms): for a level meter.
   */
  function makeSegmenter(onClip, { pause = 0.5, max = 8, minSpeech = 0.4, above = 2.5, floorMin = 0.0015, boost = true, onLevel } = {}) {
    let chunks = [], len = 0, voiced = 0, quiet = 0, floor = 0.002;
    const reset = () => { chunks = []; len = 0; voiced = 0; quiet = 0; };
    const feed = (out) => {
      let sum = 0;
      for (let i = 0; i < out.length; i++) sum += out[i] * out[i];
      const rms = Math.sqrt(sum / (out.length || 1));
      onLevel?.(rms);
      floor = rms < floor ? floor * 0.9 + rms * 0.1 : floor * 0.995 + rms * 0.005; // follows the quiet parts
      const speech = rms > Math.max(floorMin, floor * above);
      chunks.push(out); len += out.length;
      if (speech) { voiced += out.length; quiet = 0; } else quiet += out.length;
      if ((voiced > 1 * RATE && quiet > pause * RATE) || len > max * RATE) {
        if (voiced > minSpeech * RATE) { const clip = join(chunks, len); onClip(boost ? normalize(clip) : clip); }
        reset();
      } else if (len > 6 * RATE && voiced < 0.2 * RATE) reset();
    };
    feed.reset = reset;
    return feed;
  }

  window.audioClips = { RATE, makeSegmenter, downsample, join, normalize };
})();
