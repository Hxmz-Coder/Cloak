// So Cloak can be opened like any app, not just by double-clicking start.bat / start.command in its folder:
//  - Windows: a "Cloak" shortcut in the Start menu (type "Cloak" in Windows search). Optionally one on the desktop.
//  - macOS: ~/Applications/Cloak.app, a tiny app that starts Cloak (Spotlight, Launchpad, the Dock).
// Made on every start, so it follows the Cloak folder if you move it. It always runs this copy of Cloak.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, shell } = require("electron");

const ICONS = path.join(__dirname, "..", "assets");
const winStartMenu = () => path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "Cloak.lnk");
const winDesktop = () => path.join(app.getPath("desktop"), "Cloak.lnk");
const macApp = () => path.join(os.homedir(), "Applications", "Cloak.app");

// What the shortcut runs: this Electron with this Cloak folder (a packaged Cloak would just run itself).
function command() {
  return { target: process.execPath, args: app.isPackaged ? "" : `"${app.getAppPath()}"`, cwd: app.isPackaged ? path.dirname(process.execPath) : app.getAppPath() };
}

function writeWindowsShortcut(file) {
  const { target, args, cwd } = command();
  const want = { target, args, cwd, icon: path.join(ICONS, "icon.ico"), iconIndex: 0, description: "Cloak: Claude on top of everything you do" };
  try {
    const have = shell.readShortcutLink(file);
    if (have.target === want.target && have.args === want.args && have.icon === want.icon) return true; // already right
  } catch {}
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return shell.writeShortcutLink(file, "create", want);
}

function writeMacApp() {
  const root = macApp();
  const { target, args } = command();
  const script = `#!/bin/bash\n# Starts Cloak. Made by Cloak itself, so you can open it from Spotlight or Launchpad.\nexec "${target}" ${args} >/dev/null 2>&1\n`;
  const exe = path.join(root, "Contents", "MacOS", "Cloak");
  try { if (fs.readFileSync(exe, "utf8") === script) return true; } catch {}
  fs.mkdirSync(path.join(root, "Contents", "MacOS"), { recursive: true });
  fs.mkdirSync(path.join(root, "Contents", "Resources"), { recursive: true });
  fs.writeFileSync(path.join(root, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Cloak</string>
  <key>CFBundleDisplayName</key><string>Cloak</string>
  <key>CFBundleIdentifier</key><string>com.hxmz.cloak.launcher</string>
  <key>CFBundleExecutable</key><string>Cloak</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${app.getVersion()}</string>
  <key>LSUIElement</key><true/>
</dict></plist>
`);
  fs.copyFileSync(path.join(ICONS, "icon.icns"), path.join(root, "Contents", "Resources", "icon.icns"));
  fs.writeFileSync(exe, script, { mode: 0o755 });
  const now = new Date();
  fs.utimesSync(root, now, now); // Finder and Spotlight pick up the new icon
  return true;
}

// Called at startup. Returns where Cloak can be found, for Settings.
function installLauncher() {
  if (process.platform === "win32") { writeWindowsShortcut(winStartMenu()); return status(); }
  if (process.platform === "darwin") { writeMacApp(); return status(); }
  return status();
}

function status() {
  if (process.platform === "win32") return { where: "startMenu", ok: fs.existsSync(winStartMenu()), desktop: fs.existsSync(winDesktop()) };
  if (process.platform === "darwin") return { where: "applications", ok: fs.existsSync(macApp()), path: macApp() };
  return { where: null, ok: false };
}

// Settings > General: a desktop shortcut (Windows), or show Cloak.app in Finder (macOS).
function addDesktopShortcut() {
  if (process.platform === "win32") writeWindowsShortcut(winDesktop());
  else if (process.platform === "darwin") shell.showItemInFolder(macApp());
  return status();
}

module.exports = { installLauncher, addDesktopShortcut, status };
