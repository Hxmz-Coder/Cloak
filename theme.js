// Applies your theme (accent color, opacity) to this window and keeps it in sync when you change it in Settings.
(() => {
  const root = document.documentElement.style;

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return [217, 119, 87];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // A lighter tint of the accent, for gradients.
  const mix = (rgb, to, t) => rgb.map((c, i) => Math.round(c + (to[i] - c) * t));
  const luminance = ([r, g, b]) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  function apply(theme) {
    if (!theme) return;
    const rgb = hexToRgb(theme.accent);
    root.setProperty("--accent", `rgb(${rgb.join(",")})`);
    root.setProperty("--accent-rgb", rgb.join(", "));
    root.setProperty("--accent-2", `rgb(${mix(rgb, [255, 255, 255], 0.3).join(",")})`);
    // Dark text on light accents, light text on dark ones.
    root.setProperty("--on-accent", luminance(rgb) > 0.28 ? "#1a1210" : "#ffffff");
    // Some windows (Settings, Welcome) are always fully opaque so they stay easy to read.
    const a = document.documentElement.hasAttribute("data-opaque") ? 1 : Math.min(1, Math.max(0.3, Number(theme.opacity) || 0.95));
    root.setProperty("--bg-alpha", String(a));
  }

  window.overlay?.getTheme?.().then(apply);
  window.overlay?.onTheme?.(apply);
})();
