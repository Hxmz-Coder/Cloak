// Notes panel: your own writing, autosaved. To-dos in it are added to your Tasks automatically (Cloak asks
// Claude a few seconds after you stop typing); Claude only reads your notes and never changes them.
const notes = document.getElementById("notes"), saved = document.getElementById("saved"), foot = document.getElementById("foot");
const syncBtn = document.getElementById("syncBtn"), syncText = document.getElementById("syncText");
let saveTimer = null, footTimer = null;

async function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  await window.overlay.setNotes(notes.value);
  saved.textContent = "saved";
  saved.style.opacity = 1;
  setTimeout(() => (saved.style.opacity = 0), 1500);
}
// Autosave shortly after you stop typing.
notes.addEventListener("input", () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 500);
  setSync("pending", "Will sync tasks…");
});
notes.addEventListener("blur", () => { if (saveTimer) save(); });
window.addEventListener("beforeunload", () => { if (saveTimer) window.overlay.setNotes(notes.value); });

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function say(html, keep) {
  foot.innerHTML = html;
  foot.classList.add("show");
  clearTimeout(footTimer);
  if (!keep) footTimer = setTimeout(() => foot.classList.remove("show"), 8000);
}
function setSync(state, text) {
  syncBtn.className = `sync ${state}`;
  syncText.textContent = text;
}

// Status from the automatic sync.
window.overlay.onNotesSync((s) => {
  if (s.state === "syncing") setSync("syncing", "Syncing tasks…");
  else if (s.state === "idle") setSync("", "Tasks sync on");
  else if (s.state === "error") {
    setSync("error", "Not synced");
    // Most often Claude isn't set up yet: offer the setup guide.
    say(`${esc(s.error)} <a id="setupLink">Set up Claude</a>`, true);
    document.getElementById("setupLink").onclick = () => window.overlay.openWelcome("connect");
  } else {
    setSync("done", s.added?.length ? `Added ${s.added.length} task${s.added.length > 1 ? "s" : ""}` : "Tasks synced");
    if (s.added?.length) say(`<span class="ok">Added to your tasks:</span> ${s.added.map(esc).join(" · ")}`);
  }
});
// Sync right now instead of waiting.
syncBtn.onclick = async () => {
  if (syncBtn.classList.contains("syncing")) return;
  if (saveTimer) await save();
  window.overlay.syncNotesNow();
};

document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (saveTimer) save(); window.overlay.hidePanel(); } });
window.overlay.getNotes().then((text) => { notes.value = text; });
