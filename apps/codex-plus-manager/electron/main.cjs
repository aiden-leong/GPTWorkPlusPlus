// Codex++ Manager — Electron host
// 打包成 .app 后：
//   1. 拉后端子进程 (node server/index.js) 到随机空闲端口
//   2. 起 BrowserWindow 加载 codex:// 自定义协议
//   3. custom protocol handler 把 /api/* 反向代理到后端
//   4. 退出时 kill 子进程 (SIGTERM → 2s → SIGKILL)
//
// dev 模式 (npm run electron:dev): 加载 vite dev server (5173)
// prod 模式 (双击 .app):           加载 dist/ 静态 + 反向代理到子进程
//
// 单进程单 window：双击启动一条命令拉起前后端，退出关闭全部。

const { app, BrowserWindow, protocol, dialog } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");

// ===== 路径解析 =====
// 关键：dev 模式 + prod 模式要可靠区分。
// - `process.resourcesPath` 在 dev 模式也存在（Electron.app 的 Contents/Resources），
//   所以不能单用它判断 packaged。
// - `app.isPackaged` 只在 app ready 之后才准确。
// - 用 CODEX_PLUS_DEV=1 显式标记 dev（必须），反之默认 packaged。
// 兜底：如果 dev 标记了但 resourcesPath 在 node_modules/electron/ 里，也当 dev。
const RESOURCES_PATH = process.resourcesPath || "";
const looksDev = process.env.CODEX_PLUS_DEV === "1" || RESOURCES_PATH.includes("node_modules/electron");
const isPackaged = !looksDev;
const isDev = !isPackaged;

const APP_ROOT = isPackaged
  ? path.dirname(RESOURCES_PATH)
  : path.resolve(__dirname, "..");
const SERVER_DIR = isPackaged
  ? path.join(RESOURCES_PATH, "server")
  : path.join(APP_ROOT, "server");
const SERVER_ENTRY = path.join(SERVER_DIR, "index.js");
const DIST_DIR = isPackaged
  ? path.join(RESOURCES_PATH, "app.asar", "dist")
  : path.join(APP_ROOT, "dist");

// ===== 日志（dev + prod 排查用）=====
// dev 模式直接写到 electron/ 旁边，prod 写到用户 home
const LOG_PATH = isPackaged
  ? path.join(os.homedir(), "codex-plus-manager.log")
  : path.join(__dirname, "..", "codex-plus-manager.log");

function logToFile(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch (e) { console.log("logToFile err:", e.message); }
  console.log(...args);
}

// 启动期 panic：log 写好再让用户看到
function fatal(err) {
  logToFile("[fatal]", err?.stack || String(err));
  try {
    dialog.showErrorBox(
      "Codex++ Manager 启动失败",
      `错误：${err?.message || err}\n\n日志：${LOG_PATH}`
    );
  } catch {}
  app.quit();
}

// ===== 找空闲端口 =====
function findFreePort(start = 30000) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(start, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

// ===== 等待后端 ready（轮询 /api/health）=====
function waitForBackend(port, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryOnce = () => {
      const req = net.createConnection(port, "127.0.0.1");
      req.setTimeout(1500);
      req.once("connect", () => { req.destroy(); resolve(); });
      req.once("error", () => req.destroy());
      req.once("timeout", () => req.destroy());
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`backend ${port} not ready in ${timeoutMs}ms`));
        return;
      }
      setTimeout(tryOnce, 250);
    };
    tryOnce();
  });
}

// ===== 后端子进程 =====
let backendProc = null;
let backendPort = null;
let isQuitting = false;

async function startBackend() {
  backendPort = await findFreePort(30000);
  const env = {
    ...process.env,
    PORT: String(backendPort),
    ALLOWED_ORIGIN: "*",  // prod 走 file:// + 反代，无需 CORS
    ELECTRON_RUN_AS_NODE: "1",
  };
  logToFile(`[electron] spawning backend on :${backendPort}`);
  logToFile(`[electron] SERVER_ENTRY=${SERVER_ENTRY}`);
  try {
    backendProc = spawn(process.execPath, [SERVER_ENTRY], {
      env,
      cwd: SERVER_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    logToFile(`[electron] spawn threw: ${err.message}`);
    throw err;
  }
  logToFile(`[electron] backend spawned, pid=${backendProc.pid}`);
  backendProc.stdout.on("data", (d) => logToFile(`[backend-out] ${d.toString().trim()}`));
  backendProc.stderr.on("data", (d) => logToFile(`[backend-err] ${d.toString().trim()}`));
  backendProc.on("error", (err) => logToFile(`[electron] backend spawn error: ${err.message}`));
  backendProc.on("exit", (code, signal) => {
    logToFile(`[electron] backend exited code=${code} signal=${signal}`);
    if (!isQuitting && code !== 0 && code !== null) {
      logToFile("[electron] backend crashed, quitting app");
      app.quit();
    }
  });
  await waitForBackend(backendPort);
  logToFile(`[electron] backend ready on :${backendPort}`);
}

function stopBackend() {
  if (backendProc && !backendProc.killed) {
    logToFile("[electron] killing backend");
    try { backendProc.kill("SIGTERM"); } catch {}
    setTimeout(() => {
      if (backendProc && !backendProc.killed) {
        try { backendProc.kill("SIGKILL"); } catch {}
      }
    }, 2000);
  }
}

// ===== BrowserWindow =====
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: "Codex++ 管理工具",
    backgroundColor: "#0d1117",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173/");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    protocol.handle("codex", (req) => handleCodexProtocol(req));
    mainWindow.loadURL("codex://app/index.html");
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ===== custom protocol: codex://app/<path> =====
// 静态文件从 DIST_DIR 读，/api/* 反向代理到后端
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
};

async function handleCodexProtocol(request) {
  const url = new URL(request.url);
  let filePath = url.pathname;
  if (filePath === "/" || filePath === "") filePath = "/index.html";

  if (filePath.startsWith("/api/")) {
    return proxyToBackend(request, filePath, url.search);
  }

  const absolute = path.join(DIST_DIR, filePath);
  if (!absolute.startsWith(DIST_DIR)) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const data = await fs.promises.readFile(absolute);
    const ext = path.extname(absolute).toLowerCase();
    return new Response(data, { headers: { "Content-Type": MIME[ext] || "application/octet-stream" } });
  } catch (err) {
    if (err.code === "ENOENT") {
      // SPA fallback
      const idx = await fs.promises.readFile(path.join(DIST_DIR, "index.html"));
      return new Response(idx, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return new Response("error: " + err.message, { status: 500 });
  }
}

async function proxyToBackend(request, pathname, search) {
  const targetUrl = `http://127.0.0.1:${backendPort}${pathname}${search || ""}`;
  try {
    const init = { method: request.method, headers: request.headers };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }
    const res = await fetch(targetUrl, init);
    const headers = new Headers(res.headers);
    headers.delete("content-encoding"); // fetch 已解压，避免重复
    return new Response(res.body, { status: res.status, headers });
  } catch (err) {
    return new Response("proxy error: " + err.message, { status: 502 });
  }
}

// ===== App lifecycle =====
// 早期 boot 诊断 — 写到 ~/codex-plus-manager.log 立即
try {
  fs.appendFileSync(LOG_PATH, `[boot] isPackaged=${isPackaged} isDev=${isDev} resourcesPath=${process.resourcesPath || "none"} __dirname=${__dirname}\n`);
} catch (e) { console.log("bootlog fail:", e.message); }

app.whenReady().then(async () => {
  logToFile(`[electron] app ready, isPackaged=${isPackaged}, isDev=${isDev}`);
  logToFile(`[electron] APP_ROOT=${APP_ROOT}`);
  logToFile(`[electron] SERVER_DIR=${SERVER_DIR}`);
  logToFile(`[electron] DIST_DIR=${DIST_DIR}`);
  try {
    await startBackend();
  } catch (err) {
    return fatal(err);
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  stopBackend();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

process.on("uncaughtException", (err) => fatal(err));
process.on("exit", () => stopBackend());
