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
    const starry = theme.material === "starry";
    const glass = theme.material === "glass" || starry;
    const light = !starry && glass && theme.tint === "light";
    document.documentElement.dataset.material = glass ? "glass" : "classic";
    document.documentElement.dataset.sky = starry ? "starry" : "none";
    document.documentElement.dataset.tint = light ? "light" : "dark";
    const corners = Math.max(0, Math.min(4, Number.isFinite(Number(theme.corners)) ? Number(theme.corners) : 2));
    root.setProperty("--corner-scale", [0, .5, 1, 1.5, 2][corners]);
    document.documentElement.dataset.corners = String(corners);
    const rgb = glass ? (light ? [45, 85, 130] : [164, 202, 255]) : hexToRgb(theme.accent);
    root.setProperty("--accent", `rgb(${rgb.join(",")})`);
    root.setProperty("--accent-rgb", rgb.join(", "));
    root.setProperty("--accent-2", `rgb(${mix(rgb, [255, 255, 255], 0.3).join(",")})`);
    // Dark text on light accents, light text on dark ones.
    root.setProperty("--on-accent", luminance(rgb) > 0.28 ? "#1a1210" : "#ffffff");
    // Some windows (Settings, Welcome) are always fully opaque so they stay easy to read.
    const a = document.documentElement.hasAttribute("data-opaque") ? 1 : glass ? (light ? 0.82 : 0.74) : Math.min(1, Math.max(0.3, Number(theme.opacity) || 0.95));
    root.setProperty("--bg-alpha", String(a));
    root.setProperty("--native-scheme", glass && light ? "light" : "dark");
    root.setProperty("--bg-rgb", (starry ? [6, 17, 40] : glass ? (light ? [214, 234, 252] : [12, 30, 64]) : hexToRgb(theme.background || "#161413")).join(", "));
    // The mark: "cloak" (default), "classic" or "custom" (a picture you chose, as a data: URL).
    const icon = theme.icon === "custom" && theme.iconData ? "custom" : theme.icon === "classic" ? "classic" : theme.icon === "ring" ? "ring" : "cloak";
    document.documentElement.dataset.icon = icon;
    const ringColor = hexToRgb(theme.accent);
    root.setProperty("--ring-color", `rgb(${ringColor.join(",")})`);
    root.setProperty("--ring-mark", ringColor.every((c) => c > 240) ? "#d1d5db" : "#ffffff");
    if (icon === "custom") root.setProperty("--icon-image", `url("${theme.iconData}")`);
  }

  // The highlight follows the pointer without moving the window or its hit area.
  document.addEventListener("pointermove", (event) => {
    if (document.documentElement.dataset.material !== "glass") return;
    const shell = document.querySelector(".shell");
    if (!shell) return;
    const bounds = shell.getBoundingClientRect();
    shell.style.setProperty("--cursor-x", `${((event.clientX - bounds.left) / bounds.width) * 100}%`);
    shell.style.setProperty("--cursor-y", `${((event.clientY - bounds.top) / bounds.height) * 100}%`);
  });
  window.overlay?.getTheme?.().then(apply);
  window.overlay?.onTheme?.(apply);
})();
