// Shared behavior for movable panels: drag by the header (CSS app-region), resize from the corner grip,
// and the minimize button, which hides the panel until Ctrl+Shift+Space.
(() => {
  document.querySelector(".min")?.addEventListener("click", () => window.overlay.hidePanel());

  const grip = document.querySelector(".grip");
  if (!grip) return;
  let start = null, pending = null;
  grip.addEventListener("pointerdown", (e) => {
    grip.setPointerCapture(e.pointerId);
    start = { x: e.screenX, y: e.screenY, w: window.outerWidth, h: window.outerHeight };
  });
  grip.addEventListener("pointermove", (e) => {
    if (!start) return;
    const size = [start.w + e.screenX - start.x, start.h + e.screenY - start.y];
    if (!pending) requestAnimationFrame(() => { window.overlay.resizePanel(...pending); pending = null; });
    pending = size;
  });
  const end = () => { start = null; };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
})();
