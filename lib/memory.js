// Screen memory: a local, rolling record of what you were doing, so Claude can answer "what did I just do?".
//  - activity.jsonl: which app/window was in front and when (kept 24 hours)
//  - shots/*.jpg: a screenshot every ~45s when the screen changed (kept ~30 minutes)
// Nothing leaves your PC unless you ask Claude for a recap or a task scan.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { desktopCapturer, screen, powerMonitor } = require("electron");

const SHOT_EVERY_MS = 45_000;
const SHOT_KEEP = 40;
const ACTIVITY_KEEP_MS = 24 * 3600_000;
const AWAY_AFTER_S = 5 * 60;

// Prints "<process>\t<window title>" every 2s for the foreground window.
const WINDOW_WATCHER = `
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}
"@
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$owner = [int]$env:CLOAK_PID
while ($true) {
  # Stop on our own if Cloak is gone (e.g. it crashed or was force-closed), so nothing is left running.
  if ($owner -and -not (Get-Process -Id $owner -ErrorAction SilentlyContinue)) { exit }
  $h = [FG]::GetForegroundWindow(); $sb = New-Object Text.StringBuilder 512
  [void][FG]::GetWindowText($h, $sb, 512); $p = 0; [void][FG]::GetWindowThreadProcessId($h, [ref]$p)
  $n = (Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName
  [Console]::Out.WriteLine("$n\`t$($sb.ToString())"); [Console]::Out.Flush()
  Start-Sleep -Seconds 2
}`;

class ScreenMemory {
  constructor({ dir, isEnabled, onWelcomeBack }) {
    this.dir = dir;
    this.shotsDir = path.join(dir, "shots");
    this.activityFile = path.join(dir, "activity.jsonl");
    this.isEnabled = isEnabled;
    this.onWelcomeBack = onWelcomeBack;
    this.last = null; // last foreground window { app, title }
    this.lastThumb = null;
    this.locked = false;
    this.awaySince = null;
    fs.mkdirSync(this.shotsDir, { recursive: true });
  }

  start() {
    if (process.platform === "win32") this.startWindowWatcher();
    this.shotTimer = setInterval(() => this.maybeCapture().catch(() => {}), SHOT_EVERY_MS);
    this.idleTimer = setInterval(() => this.checkIdle(), 20_000);
    powerMonitor.on("lock-screen", () => { this.locked = true; this.markAway(); });
    powerMonitor.on("unlock-screen", () => { this.locked = false; this.checkIdle(); });
    this.prune();
  }

  stop() {
    this.stopping = true;
    clearInterval(this.shotTimer);
    clearInterval(this.idleTimer);
    this.watcher?.kill();
  }

  startWindowWatcher() {
    this.watcher = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WINDOW_WATCHER],
      { windowsHide: true, env: { ...process.env, CLOAK_PID: String(process.pid) } });
    let buf = "";
    this.watcher.stdout.on("data", (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) this.onWindow(line);
    });
    this.watcher.on("exit", () => { if (!this.stopping) setTimeout(() => this.startWindowWatcher(), 10_000); });
  }

  onWindow(line) {
    if (!this.isEnabled() || this.locked) return;
    const [app = "", ...rest] = line.split("\t");
    const title = rest.join("\t").trim();
    if (!app || /^electron$/i.test(app) && /^Claude/i.test(title)) return; // ignore our own widgets
    if (/^(LockApp|SearchHost|ShellExperienceHost)$/i.test(app)) return;
    if (this.last && this.last.app === app && this.last.title === title) return;
    this.last = { app, title };
    fs.appendFileSync(this.activityFile, JSON.stringify({ t: Date.now(), app, title }) + "\n");
  }

  checkIdle() {
    const idle = powerMonitor.getSystemIdleTime();
    if (idle >= AWAY_AFTER_S || this.locked) return this.markAway();
    if (this.awaySince) {
      const minutes = Math.round((Date.now() - this.awaySince) / 60_000);
      this.awaySince = null;
      if (this.isEnabled()) this.onWelcomeBack(minutes);
    }
  }

  markAway() {
    if (!this.awaySince) this.awaySince = Date.now() - powerMonitor.getSystemIdleTime() * 1000;
  }

  async maybeCapture() {
    if (!this.isEnabled() || this.locked || powerMonitor.getSystemIdleTime() > 120) return;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const scale = Math.min(1, 1280 / display.size.width);
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) },
    });
    const img = (sources.find((s) => s.display_id === String(display.id)) || sources[0])?.thumbnail;
    if (!img || img.isEmpty()) return;
    // Skip near-identical frames (compare a tiny grayscale version).
    const thumb = img.resize({ width: 48, height: 27 }).toBitmap();
    if (this.lastThumb && similarity(thumb, this.lastThumb) > 0.985) return;
    this.lastThumb = thumb;
    fs.writeFileSync(path.join(this.shotsDir, `${Date.now()}.jpg`), img.toJPEG(60));
    this.pruneShots();
  }

  pruneShots() {
    const files = fs.readdirSync(this.shotsDir).filter((f) => f.endsWith(".jpg")).sort();
    for (const f of files.slice(0, Math.max(0, files.length - SHOT_KEEP))) fs.rmSync(path.join(this.shotsDir, f), { force: true });
  }

  prune() {
    this.pruneShots();
    const cutoff = Date.now() - ACTIVITY_KEEP_MS;
    const kept = this.readActivity().filter((e) => e.t >= cutoff);
    fs.writeFileSync(this.activityFile, kept.map((e) => JSON.stringify(e)).join("\n") + (kept.length ? "\n" : ""));
  }

  clear() {
    fs.rmSync(this.shotsDir, { recursive: true, force: true });
    fs.mkdirSync(this.shotsDir, { recursive: true });
    fs.writeFileSync(this.activityFile, "");
    this.last = null;
    this.lastThumb = null;
  }

  readActivity() {
    try {
      return fs.readFileSync(this.activityFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch { return []; }
  }

  // Timeline text for the last `minutes`, e.g. "2:05 PM–2:12 PM (7 min) · chrome · Gmail - Inbox".
  timeline(minutes) {
    const since = Date.now() - minutes * 60_000;
    const all = this.readActivity();
    const lines = [];
    all.forEach((e, i) => {
      const end = all[i + 1]?.t ?? Date.now();
      if (end < since) return;
      const mins = Math.round((end - Math.max(e.t, since)) / 60_000);
      if (mins < 1 && i !== all.length - 1) return; // skip flickers under a minute
      lines.push(`${fmt(Math.max(e.t, since))}–${fmt(end)} (${mins} min) · ${e.app} · ${e.title || "(no title)"}`);
    });
    return lines.slice(-40).join("\n");
  }

  // Up to `n` screenshots from the last `minutes`, spread out, oldest first (paths relative to `relTo`).
  recentShots(minutes, n, relTo) {
    const since = Date.now() - minutes * 60_000;
    const files = fs.readdirSync(this.shotsDir).filter((f) => f.endsWith(".jpg") && Number(f.slice(0, -4)) >= since).sort();
    if (files.length <= n) return files.map((f) => this.rel(f, relTo));
    const picked = [];
    for (let i = 0; i < n; i++) picked.push(files[Math.round((i * (files.length - 1)) / (n - 1))]);
    return [...new Set(picked)].map((f) => this.rel(f, relTo));
  }

  rel(file, relTo) {
    const p = path.relative(relTo, path.join(this.shotsDir, file)).replace(/\\/g, "/");
    return { path: "./" + p, time: fmt(Number(file.slice(0, -4))) };
  }
}

function similarity(a, b) {
  if (a.length !== b.length) return 0;
  let same = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) {
    const ga = (a[i] + a[i + 1] + a[i + 2]) / 3, gb = (b[i] + b[i + 1] + b[i + 2]) / 3;
    if (Math.abs(ga - gb) < 12) same++;
    n++;
  }
  return same / n;
}

const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

module.exports = { ScreenMemory };
