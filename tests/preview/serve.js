// Preview Cloak's windows in a normal browser, with a fake backend (mock-overlay.js), to check how things look
// without starting the app or putting windows on your screen.
//   node tests/preview/serve.js        then open http://localhost:4173
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PORT = Number(process.env.PORT || 4173);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const MOCKED = new Set(["index.html", "tasks.html", "notes.html", "settings.html"]);

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "tests/preview/index.html";
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
  let body = fs.readFileSync(file);
  // App pages get the fake window.overlay before their own scripts run.
  if (MOCKED.has(rel)) body = body.toString().replace("<script", '<script src="/tests/preview/mock-overlay.js"></script>\n<script');
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  res.end(body);
}).listen(PORT, () => console.log(`Cloak preview: http://localhost:${PORT}`));
