// Notes panel: your own writing, autosaved. Claude only reads it (Find tasks); it never edits it.
const notes = document.getElementById("notes"), saved = document.getElementById("saved"), foot = document.getElementById("foot");
const findBtn = document.getElementById("findBtn");
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
notes.addEventListener("input", () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 500); });
notes.addEventListener("blur", () => { if (saveTimer) save(); });
window.addEventListener("beforeunload", () => { if (saveTimer) window.overlay.setNotes(notes.value); });

function say(html) {
  foot.innerHTML = html;
  foot.classList.add("show");
  clearTimeout(footTimer);
  footTimer = setTimeout(() => foot.classList.remove("show"), 8000);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

findBtn.onclick = async () => {
  if (findBtn.classList.contains("spinning")) return;
  if (saveTimer) await save();
  findBtn.classList.add("spinning");
  say("Reading your notes…");
  const r = await window.overlay.scanTasks({ activity: false, notes: true });
  findBtn.classList.remove("spinning");
  if (r.error) say(esc(r.error));
  else if (!r.added.length) say("No new tasks in your notes.");
  else say(`<span class="ok">Added ${r.added.length} task${r.added.length > 1 ? "s" : ""}:</span> ${r.added.map(esc).join(" · ")}`);
};

document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (saveTimer) save(); window.overlay.hidePanel(); } });
window.overlay.getNotes().then((text) => { notes.value = text; });
