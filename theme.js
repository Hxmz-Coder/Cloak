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
    root.setProperty("--bg-rgb", (starry ? [0, 0, 0] : glass ? (light ? [214, 234, 252] : [12, 30, 64]) : hexToRgb(theme.background || "#161413")).join(", "));
    // The mark: "cloak" (default), "classic" or "custom" (a picture you chose, as a data: URL).
    const icon = theme.icon === "custom" && theme.iconData ? "custom" : theme.icon === "classic" ? "classic" : theme.icon === "ring" ? "ring" : "cloak";
    document.documentElement.dataset.icon = icon;
    const ringColor = hexToRgb(theme.accent);
    root.setProperty("--ring-color", `rgb(${ringColor.join(",")})`);
    root.setProperty("--ring-mark", ringColor.every((c) => c > 240) ? "#d1d5db" : "#ffffff");
    if (icon === "custom") root.setProperty("--icon-image", `url("${theme.iconData}")`);
    sky(starry);
  }

  // Starry Night: stars twinkle in random spots and a shooting star crosses now and then. The stars are placed in
  // percentages, so the sky survives the window changing size; the shooting stars are timed at random.
  let skyTimer = 0;
  function sky(on) {
    const shell = document.querySelector(".shell");
    const old = shell?.querySelector(".sky-layer");
    if (!on || !shell) { clearTimeout(skyTimer); old?.remove(); return; }
    if (old) return;
    const layer = document.createElement("div");
    layer.className = "sky-layer";
    const rand = (a, b) => a + Math.random() * (b - a);
    const area = Math.max(1, window.innerWidth * window.innerHeight);
    const count = Math.max(14, Math.min(90, Math.round(area / 3800)));
    for (let i = 0; i < count; i++) {
      const star = document.createElement("span");
      const size = Math.random() < 0.8 ? rand(1, 1.8) : rand(2, 2.8);
      star.className = "star";
      star.style.cssText = `left:${rand(0, 100)}%;top:${rand(0, 100)}%;width:${size}px;height:${size}px;--dur:${rand(2.5, 7)}s;--delay:${-rand(0, 7)}s;--peak:${rand(0.55, 1)}`;
      layer.appendChild(star);
    }
    shell.prepend(layer);
    const shoot = () => {
      skyTimer = setTimeout(() => {
        if (!layer.isConnected) return;
        if (!document.hidden && layer.animate) {
          const w = layer.clientWidth, h = layer.clientHeight;
          const s = document.createElement("span");
          s.className = "shooter";
          const angle = rand(18, 38), dist = Math.max(w * 0.6, 120) + rand(0, 80);
          const x0 = rand(w * 0.3, w), y0 = rand(0, h * 0.5);
          const dx = -Math.cos(angle * Math.PI / 180) * dist, dy = Math.sin(angle * Math.PI / 180) * dist;
          s.style.cssText = `left:${x0}px;top:${y0}px;transform-origin:100% 50%`;
          layer.appendChild(s);
          const rot = `rotate(${180 - angle}deg)`;
          const run = s.animate([
            { opacity: 0, transform: `translate(0,0) ${rot}` },
            { opacity: 1, offset: 0.15 },
            { opacity: 0, transform: `translate(${dx}px,${dy}px) ${rot}` },
          ], { duration: rand(650, 1100), easing: "ease-in" });
          run.onfinish = () => s.remove();
        }
        shoot();
      }, rand(5000, 16000));
    };
    shoot();
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
