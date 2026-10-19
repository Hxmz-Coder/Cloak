// Runs every new-user scenario (each in its own fresh profile), a few at a time, and prints a summary.
//   npm run test:new-user                 all scenarios once
//   npm run test:new-user -- student x3   one scenario, three times
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ALL = ["first-run", "notifications", "student", "practice", "writer-coder", "actions", "notes", "builders", "edge-cases"];
const args = process.argv.slice(2);
const repeat = Number((args.find((a) => /^x\d+$/.test(a)) || "x1").slice(1));
const picked = args.filter((a) => ALL.includes(a));
const queue = [];
for (let i = 0; i < repeat; i++) queue.push(...(picked.length ? picked : ALL));
const PARALLEL = Number(process.env.CLOAK_TEST_PARALLEL || 3);
const electron = path.join(__dirname, "..", "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const outDir = process.env.CLOAK_TEST_OUT || path.join(__dirname, "results", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(outDir, { recursive: true });

let running = 0, done = 0;
const summary = [];
function next() {
  while (running < PARALLEL && queue.length) {
    const scenario = queue.shift();
    running++;
    const started = Date.now();
    const p = spawn(electron, [path.join(__dirname, "new-user.js")], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, CLOAK_SCENARIO: scenario, CLOAK_TEST_OUT: outDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    // Safety net: a run that hangs is stopped after 15 minutes.
    const killer = setTimeout(() => { out += "\nTIMED OUT"; p.kill(); }, 15 * 60_000);
    p.on("close", (code) => {
      clearTimeout(killer);
      running--; done++;
      const prof = (out.match(/^PROFILE (.+)$/m) || [])[1];
      if (prof) setTimeout(() => { try { fs.rmSync(prof.trim(), { recursive: true, force: true }); } catch {} }, 3000);
      const fails = out.split("\n").filter((l) => l.startsWith("FAIL"));
      const line = out.split("\n").reverse().find((l) => l.startsWith(`${scenario}:`)) || `${scenario}: did not finish (exit ${code})`;
      summary.push({ scenario, line, fails });
      console.log(`[${done}] ${line}  (${Math.round((Date.now() - started) / 1000)}s)`);
      for (const f of fails) console.log("     " + f.slice(0, 400));
      if (!queue.length && !running) finish();
      else next();
    });
  }
}
function finish() {
  const failed = summary.filter((s) => s.fails.length || !/passed/.test(s.line));
  console.log(`\n${summary.length} runs, ${summary.length - failed.length} clean, ${failed.length} with failures. Reports: ${outDir}`);
  process.exit(failed.length ? 1 : 0);
}
next();
