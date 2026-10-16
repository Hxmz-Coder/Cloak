// What Claude may do on its own, and how blocked actions become approval cards.
//
// Runs automatically: reading files in your user folder, searching (Glob/Grep), web search, and shell
// commands the CLI itself classifies as read-only (e.g. `dir`, `git status`).
// Needs your OK: shell commands that change things, creating/editing files, fetching web pages
// (a fetch can send data out in its URL). Approve once, or "always" to widen what runs on its own.
const path = require("path");

const TOOLS = "Read,Glob,Grep,WebSearch,WebFetch,Bash,Edit,Write";
const AUTO_ALLOWED = ["Read", "Glob", "Grep", "WebSearch"];

// Never offered as "always allow": too destructive to stop asking about.
const NEVER_ALWAYS = /^(rm|del|erase|rmdir|rd|remove-item|format|diskpart|shutdown|restart-computer|stop-computer|reg|regedit|bcdedit|takeown|icacls|cipher|sudo|curl|wget|invoke-webrequest|iwr|powershell|pwsh|cmd)$/i;

// C:\Users\me\x -> //c/Users/me/x (the CLI's permission-rule form for absolute Windows paths)
const toRulePath = (p) => "//" + p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => d.toLowerCase());

function firstWord(cmd) {
  const w = (cmd || "").trim().split(/\s+/)[0] || "";
  return path.basename(w.replace(/["']/g, "")).replace(/\.(exe|cmd|bat)$/i, "");
}

// Turns one entry of the CLI's `permission_denials` into an approval card.
function describeDenial(d, i) {
  const input = d.tool_input || {};
  const base = { id: d.tool_use_id || `a${i}`, tool: d.tool_name };
  switch (d.tool_name) {
    case "Bash": {
      const cmd = input.command || "";
      const word = firstWord(cmd);
      const canAlways = word && !NEVER_ALWAYS.test(word) && !/[;&|`$><]/.test(cmd);
      return {
        ...base,
        title: input.description || "Run a command",
        detail: cmd,
        rule: `Bash(${cmd})`,
        alwaysRule: canAlways ? `Bash(${word}:*)` : null,
        alwaysLabel: canAlways ? `Always allow \`${word}\` commands` : null,
      };
    }
    case "Edit":
    case "Write":
    case "NotebookEdit": {
      const fp = input.file_path || input.notebook_path || "";
      const dir = path.dirname(fp);
      return {
        ...base,
        title: d.tool_name === "Write" ? "Create or overwrite a file" : "Edit a file",
        detail: fp,
        rule: `Edit(${toRulePath(fp)})`,
        alwaysRule: `Edit(${toRulePath(dir)}/**)`,
        alwaysLabel: `Always allow edits in ${path.basename(dir) || dir}`,
      };
    }
    case "WebFetch": {
      let host = "";
      try { host = new URL(input.url).hostname; } catch {}
      return {
        ...base,
        title: "Open a web page",
        detail: input.url || "",
        rule: host ? `WebFetch(domain:${host})` : "WebFetch",
        alwaysRule: host ? `WebFetch(domain:${host})` : null,
        alwaysLabel: host ? `Always allow ${host}` : null,
      };
    }
    default:
      return { ...base, title: `Use ${d.tool_name}`, detail: JSON.stringify(input).slice(0, 200), rule: d.tool_name, alwaysRule: null, alwaysLabel: null };
  }
}

module.exports = { TOOLS, AUTO_ALLOWED, describeDenial };
