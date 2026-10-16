// Shared behavior for movable panels: drag by the header (CSS app-region), the minimize button (hides the
// panel until the show/hide shortcut), and resizing from any edge or corner. Fixed-size windows (Settings,
// Welcome) mark <body data-fixed> and get no resize handles.
(() => {
  document.querySelector(".min")?.addEventListener("click", () => window.overlay.hidePanel());

  if (document.body.hasAttribute("data-fixed")) {
    document.querySelector(".grip")?.remove();
    return;
  }

  // Invisible handles along the edges of the panel (inside the window's transparent margin).
  const css = document.createElement("style");
  css.textContent = `
    .rz { position: fixed; z-index: 50; }
    .rz.n, .rz.s { left: 12px; right: 12px; height: 8px; cursor: ns-resize; }
    .rz.e, .rz.w { top: 12px; bottom: 12px; width: 8px; cursor: ew-resize; }
    .rz.n { top: 0; } .rz.s { bottom: 0; } .rz.e { right: 0; } .rz.w { left: 0; }
    .rz.ne, .rz.nw, .rz.se, .rz.sw { width: 14px; height: 14px; }
    .rz.ne { top: 0; right: 0; cursor: nesw-resize; } .rz.sw { bottom: 0; left: 0; cursor: nesw-resize; }
    .rz.nw { top: 0; left: 0; cursor: nwse-resize; } .rz.se { bottom: 0; right: 0; cursor: nwse-resize; }`;
  document.head.appendChild(css);

  let drag = null, pending = null;
  function start(e, dir) {
    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);
    drag = { dir, x: e.screenX, y: e.screenY, bx: window.screenX, by: window.screenY, w: window.outerWidth, h: window.outerHeight };
  }
  function move(e) {
    if (!drag) return;
    const dx = e.screenX - drag.x, dy = e.screenY - drag.y, d = drag.dir;
    let { bx: x, by: y, w, h } = drag;
    if (d.includes("e")) w += dx;
    if (d.includes("s")) h += dy;
    if (d.includes("w")) { w -= dx; x += dx; }
    if (d.includes("n")) { h -= dy; y += dy; }
    if (!pending) requestAnimationFrame(() => { window.overlay.setPanelBounds(pending); pending = null; });
    pending = { x, y, width: w, height: h, anchorRight: d.includes("w"), anchorBottom: d.includes("n") };
  }
  const end = () => { drag = null; };
  for (const dir of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
    const h = document.createElement("div");
    h.className = `rz ${dir}`;
    h.addEventListener("pointerdown", (e) => start(e, dir));
    h.addEventListener("pointermove", move);
    h.addEventListener("pointerup", end);
    h.addEventListener("pointercancel", end);
    document.body.appendChild(h);
  }
  // The corner grip works the same as the bottom-right corner.
  const grip = document.querySelector(".grip");
  if (grip) {
    grip.addEventListener("pointerdown", (e) => start(e, "se"));
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  }
})();
