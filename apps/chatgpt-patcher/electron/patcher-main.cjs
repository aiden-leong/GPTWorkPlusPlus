// ChatGPT Patcher — 主进程（同时支持 Patcher.app 和 ChatGPT++.app 两种模式）
//
// 两种模式根据 process.env.CODEX_PATCHER_MODE 决定：
//   - "patcher" → Patcher UI（拖拽 + patch）
//   - 其他 / 未设 → Wrapper 模式（启动原 ChatGPT + 管理 UI + 后端）
//
// Patcher.app 的 package.json 设了 main: electron/patcher-main.cjs，
// 启动时 patcher-main.cjs 内部设 CODEX_PATCHER_MODE=patcher 进入 Patcher 模式。
//
// ChatGPT++.app 是 Patcher 把 MacOS/ChatGPT 替换成 Patcher 的 launcher，
// launcher 启动后 package.json 同样指向 patcher-main.cjs，但没设 env，进入 wrapper 模式。

const { app, BrowserWindow, ipcMain, dialog, protocol } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const net = require("node:net");
const { spawn, execSync } = require("node:child_process");
const { existsSync } = require("node:fs");

// 最早 boot log
const EARLY_LOG = "/tmp/early-boot.log";
try { fs.appendFileSync(EARLY_LOG, `[${new Date().toISOString()}] require done, app=${typeof app}\n`); } catch {}

// MODE 决定跑 Patcher UI 还是 wrapper
// 检测顺序：
//   1. env var CODEX_PATCHER_MODE 显式设置
//   2. process.execPath 包含 "Patcher" 字符串 → patcher
//   3. fallback → wrapper
let MODE;
if (process.env.CODEX_PATCHER_MODE === "patcher" || process.env.CODEX_PATCHER_MODE === "wrapper") {
  MODE = process.env.CODEX_PATCHER_MODE;
} else if (process.execPath.includes("Patcher")) {
  MODE = "patcher";
} else {
  MODE = "wrapper";
}

// === 公共：日志 ===
const LOG_PATH = MODE === "patcher"
  ? path.join(os.homedir(), "chatgpt-patcher.log")
  : path.join(os.homedir(), "chatgpt-plus.log");

function logToFile(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch (e) { console.log("logToFile err:", e.message); }
  console.log(...args);
}

try { fs.appendFileSync(LOG_PATH, `[boot] mode=${MODE} appPath=${app.getAppPath()}\n`); } catch {}
// 早期诊断 — 看 require 时哪里失败
const _startTime = Date.now();
process.on("uncaughtException", (err) => {
  try { fs.appendFileSync(LOG_PATH, `[uncaughtException at ${Date.now() - _startTime}ms] ${err.stack || err}\n`); } catch {}
});
process.on("unhandledRejection", (reason) => {
  try { fs.appendFileSync(LOG_PATH, `[unhandledRejection at ${Date.now() - _startTime}ms] ${reason?.stack || reason}\n`); } catch {}
});
try { fs.appendFileSync(LOG_PATH, `[boot2] ${Date.now() - _startTime}ms after top-level\n`); } catch {}

// ============================================================================
// ============================== PATCHER 模式 ================================
// ============================================================================
if (MODE === "patcher") {
  let mainWindow = null;

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 720,
      height: 520,
      minWidth: 560,
      minHeight: 420,
      title: "ChatGPT Patcher",
      backgroundColor: "#0d1117",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      webPreferences: {
        preload: path.join(__dirname, "patcher-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    mainWindow.loadFile(path.join(__dirname, "..", "patcher.html"));
    mainWindow.on("closed", () => { mainWindow = null; });
  }

  // === IPC: inspect ===
  ipcMain.handle("inspect", async (_evt, appPath) => {
    if (!appPath || typeof appPath !== "string") throw new Error("appPath 不能为空");
    if (!existsSync(appPath)) throw new Error("路径不存在");
    const stat = await fsp.stat(appPath);
    if (!stat.isDirectory()) throw new Error("不是一个目录");
    if (!appPath.endsWith(".app")) throw new Error("不是 .app 后缀");
    const infoPlist = path.join(appPath, "Contents", "Info.plist");
    if (!existsSync(infoPlist)) throw new Error("没有 Contents/Info.plist");
    const plist = await parsePlist(infoPlist);
    return {
      path: appPath,
      name: plist.CFBundleName || path.basename(appPath, ".app"),
      bundleId: plist.CFBundleIdentifier || "",
      bundleExecutable: plist.CFBundleExecutable || "",
      version: plist.CFBundleShortVersionString || "0.0.0",
    };
  });

  // === IPC: patch ===
  ipcMain.handle("patch", async (_evt, appPath) => {
    return await doPatch(appPath, (msg) => mainWindow?.webContents.send("log", msg));
  });

  ipcMain.handle("openPath", async (_evt, p) => {
    try { execSync(`open "${p}"`, { stdio: "ignore" }); return { ok: true }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle("revealInFinder", async (_evt, p) => {
    try { execSync(`open -R "${p}"`, { stdio: "ignore" }); return { ok: true }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle("pickApp", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择 ChatGPT.app",
      properties: ["openFile", "openDirectory"],
      defaultPath: "/Applications",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // === Patcher lifecycle ===
  app.whenReady().then(() => {
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

} else {
  // ==========================================================================
  // ============================ WRAPPER 模式 ================================
  // ==========================================================================
  // 启动 Resources/.original_chatgpt/Contents/MacOS/<exec> (原 ChatGPT)
  // 启动 Resources/manager/server/index.js (后端 API)
  // 打开 BrowserWindow，加载 codex:// 协议显示管理 UI

  const RESOURCES_PATH = process.resourcesPath || "";
  try { fs.appendFileSync(LOG_PATH, `[wrapper-init] RESOURCES_PATH=${RESOURCES_PATH}\n`); } catch {}
  const isPackaged = !RESOURCES_PATH.includes("node_modules/electron");
  try { fs.appendFileSync(LOG_PATH, `[wrapper-init] isPackaged=${isPackaged}\n`); } catch {}
  const APP_ROOT = isPackaged ? path.dirname(RESOURCES_PATH) : path.resolve(__dirname, "..");
  const MANAGER_DIR = isPackaged
    ? path.join(RESOURCES_PATH, "manager")
    : path.join(APP_ROOT, "payload", "manager");
  const MANAGER_SERVER = path.join(MANAGER_DIR, "server", "index.js");
  // dist 在 Resources/manager/dist/ (cp payload/manager/dist 过去的)
  // 不在 app.asar 内 (我们 patch 时只嵌 payload/manager)
  const MANAGER_DIST = path.join(MANAGER_DIR, "dist");
  try { fs.appendFileSync(LOG_PATH, `[wrapper-init] MANAGER_DIR=${MANAGER_DIR}\n`); } catch {}
  // 原 ChatGPT 在 Resources/.original_chatgpt/Contents/MacOS/<execName>
  // 通过读 patched app 的 Info.plist 找 CFBundleExecutable
  const PATCHED_INFO_PLIST = isPackaged
    ? path.join(APP_ROOT, "Contents", "Info.plist")
    : null;
  const ORIGINAL_INFO_PLIST = isPackaged
    ? path.join(RESOURCES_PATH, ".original_chatgpt", "Info.plist")
    : null;
  const ORIGINAL_APP_DIR = isPackaged
    ? path.join(RESOURCES_PATH, ".original_chatgpt", "Contents", "MacOS")
    : null;

  let backendProc = null;
  let originalProc = null;
  let backendPort = null;
  let isQuitting = false;

  function fatal(err) {
    logToFile("[fatal]", err?.stack || String(err));
    try { dialog.showErrorBox("ChatGPT++ 启动失败", `错误：${err?.message || err}\n\n日志：${LOG_PATH}`); } catch {}
    app.quit();
  }

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

  async function startOriginalChatGPT() {
    if (!ORIGINAL_APP_DIR || !existsSync(ORIGINAL_APP_DIR)) {
      logToFile(`[wrapper] 原 ChatGPT 目录不存在: ${ORIGINAL_APP_DIR} (dev 模式跳过)`);
      return;
    }
    // 读原始 Info.plist 找 CFBundleExecutable
    let execName = "ChatGPT";
    if (ORIGINAL_INFO_PLIST && existsSync(ORIGINAL_INFO_PLIST)) {
      const origPlist = await parsePlist(ORIGINAL_INFO_PLIST);
      execName = origPlist.CFBundleExecutable || "ChatGPT";
    }
    const origExec = path.join(ORIGINAL_APP_DIR, execName);
    if (!existsSync(origExec)) {
      logToFile(`[wrapper] 原 binary 不存在: ${origExec}`);
      return;
    }
    logToFile(`[wrapper] 启动原 ChatGPT: ${origExec}`);
    try {
      originalProc = spawn(origExec, [], {
        cwd: path.dirname(path.dirname(origExec)),
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });
    } catch (err) {
      logToFile(`[wrapper] 启动原 ChatGPT 失败: ${err.message}`);
      return;
    }
    originalProc.stdout.on("data", (d) => logToFile(`[chatgpt-out] ${d.toString().trim()}`));
    originalProc.stderr.on("data", (d) => logToFile(`[chatgpt-err] ${d.toString().trim()}`));
    originalProc.on("exit", (code, signal) => {
      logToFile(`[wrapper] 原 ChatGPT 退出 code=${code} signal=${signal}`);
      if (!isQuitting) {
        logToFile("[wrapper] 原 ChatGPT 退出，关闭 app");
        app.quit();
      }
    });
    logToFile(`[wrapper] 原 ChatGPT pid=${originalProc.pid}`);
  }

  async function startBackend() {
    if (!existsSync(MANAGER_SERVER)) {
      throw new Error(`manager server 不存在: ${MANAGER_SERVER}`);
    }
    backendPort = await findFreePort(30000);
    const env = {
      ...process.env,
      PORT: String(backendPort),
      ALLOWED_ORIGIN: "*",
      ELECTRON_RUN_AS_NODE: "1",
    };
    logToFile(`[wrapper] spawning backend on :${backendPort}`);
    try {
      backendProc = spawn(process.execPath, [MANAGER_SERVER], {
        env,
        cwd: path.dirname(MANAGER_SERVER),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      logToFile(`[wrapper] spawn threw: ${err.message}`);
      throw err;
    }
    logToFile(`[wrapper] backend spawned, pid=${backendProc.pid}`);
    backendProc.stdout.on("data", (d) => logToFile(`[backend-out] ${d.toString().trim()}`));
    backendProc.stderr.on("data", (d) => logToFile(`[backend-err] ${d.toString().trim()}`));
    backendProc.on("error", (err) => logToFile(`[wrapper] backend spawn error: ${err.message}`));
    backendProc.on("exit", (code, signal) => {
      logToFile(`[wrapper] backend exited code=${code} signal=${signal}`);
      if (!isQuitting && code !== 0 && code !== null) {
        logToFile("[wrapper] backend crashed, quitting app");
        app.quit();
      }
    });
    await waitForBackend(backendPort);
    logToFile(`[wrapper] backend ready on :${backendPort}`);
  }

  function stopChildren() {
    logToFile("[wrapper] stopping children");
    for (const [name, p] of [["backend", backendProc], ["original", originalProc]]) {
      if (p && !p.killed) {
        try { p.kill("SIGTERM"); } catch {}
        setTimeout(() => {
          if (p && !p.killed) {
            try { p.kill("SIGKILL"); } catch {}
          }
        }, 2000);
      }
    }
  }

  // === custom protocol: codex://app/<path> ===
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

  let mainWindow = null;

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 1024,
      minHeight: 700,
      title: "ChatGPT++ 管理工具",
      backgroundColor: "#0d1117",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      webPreferences: {
        preload: path.join(__dirname, "wrapper-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    if (!isPackaged) {
      // dev 模式：连 vite dev server
      mainWindow.loadURL("http://127.0.0.1:5173/");
      mainWindow.webContents.openDevTools({ mode: "detach" });
    } else {
      protocol.handle("codex", (req) => handleCodexProtocol(req));
      mainWindow.loadURL("codex://app/index.html");
    }

    mainWindow.on("closed", () => { mainWindow = null; });
  }

  async function handleCodexProtocol(request) {
    const url = new URL(request.url);
    let filePath = url.pathname;
    if (filePath === "/" || filePath === "") filePath = "/index.html";

    if (filePath.startsWith("/api/")) {
      return proxyToBackend(request, filePath, url.search);
    }

    const absolute = path.join(MANAGER_DIST, filePath);
    if (!absolute.startsWith(MANAGER_DIST)) {
      return new Response("forbidden", { status: 403 });
    }
    try {
      const data = await fsp.readFile(absolute);
      const ext = path.extname(absolute).toLowerCase();
      return new Response(data, { headers: { "Content-Type": MIME[ext] || "application/octet-stream" } });
    } catch (err) {
      if (err.code === "ENOENT") {
        const idx = await fsp.readFile(path.join(MANAGER_DIST, "index.html"));
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
      headers.delete("content-encoding");
      return new Response(res.body, { status: res.status, headers });
    } catch (err) {
      return new Response("proxy error: " + err.message, { status: 502 });
    }
  }

  // === Wrapper lifecycle ===
  try { fs.appendFileSync(LOG_PATH, `[wrapper-init] before whenReady register\n`); } catch {}
  app.whenReady().then(async () => {
    logToFile(`[wrapper] app ready`);
    logToFile(`[wrapper] MANAGER_DIR=${MANAGER_DIR}`);
    logToFile(`[wrapper] MANAGER_DIST=${MANAGER_DIST}`);
    logToFile(`[wrapper] ORIGINAL_APP_DIR=${ORIGINAL_APP_DIR}`);
    try {
      await startBackend();
    } catch (err) {
      return fatal(err);
    }
    await startOriginalChatGPT();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", () => {
    isQuitting = true;
    stopChildren();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  process.on("uncaughtException", (err) => fatal(err));
  process.on("exit", () => stopChildren());
}

// ============================================================================
// ============================== 共享工具 ====================================
// ============================================================================

async function parsePlist(p) {
  const xml = await fsp.readFile(p, "utf-8");
  const keys = ["CFBundleIdentifier", "CFBundleExecutable", "CFBundleName", "CFBundleDisplayName", "CFBundleShortVersionString"];
  const out = {};
  for (const k of keys) {
    const re = new RegExp(`<key>${k}<\\/key>\\s*<string>([^<]+)<\\/string>`);
    const m = xml.match(re);
    if (m) out[k] = m[1];
  }
  return out;
}

async function copyDir(src, dest, skipNames = new Set()) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (skipNames.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d, skipNames);
    else if (entry.isSymbolicLink()) {
      const { readlink, symlink } = await fsp;
      await symlink(await readlink(s), d);
    } else await fsp.copyFile(s, d);
  }
}

async function updatePlist(p, updates) {
  let xml = await fsp.readFile(p, "utf-8");
  for (const [key, value] of Object.entries(updates)) {
    const safe = String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (xml.includes(`<key>${key}</key>`)) {
      xml = xml.replace(new RegExp(`(<key>${key}<\\/key>\\s*)<string>[^<]+<\\/string>`), `$1<string>${safe}</string>`);
    } else {
      xml = xml.replace(/<\/dict>/, `  <key>${key}</key>\n  <string>${safe}</string>\n</dict>`);
    }
  }
  return xml;
}

// doPatch 函数 — Patcher 模式专用
async function doPatch(appPath, log) {
  log(`[patch] ${appPath}`);
  if (!existsSync(appPath)) throw new Error("路径不存在");
  const stat = await fsp.stat(appPath);
  if (!stat.isDirectory() || !appPath.endsWith(".app")) {
    throw new Error("无效的 .app 路径");
  }
  const infoPlist = path.join(appPath, "Contents", "Info.plist");
  if (!existsSync(infoPlist)) throw new Error("没有 Info.plist");
  const plist = await parsePlist(infoPlist);
  const execName = plist.CFBundleExecutable;
  if (!execName) throw new Error("Info.plist 没有 CFBundleExecutable");
  const parent = path.dirname(appPath);
  const baseName = path.basename(appPath, ".app");
  const targetPath = path.join(parent, `${baseName}++.app`);
  if (existsSync(targetPath)) throw new Error(`已存在 ${targetPath}，请先删除或改名`);

  const helperBaseName = baseName + "++";
  log(`[patch] target: ${targetPath}`);

  // 1. 复制整个 .app
  await copyDir(appPath, targetPath);
  log(`[patch] 1. copied .app structure`);

  // 2. 移动原 MacOS/<exec> 到 Resources/.original_chatgpt/
  const origMacosExec = path.join(targetPath, "Contents", "MacOS", execName);
  const originalResourceDir = path.join(targetPath, "Contents", "Resources", ".original_chatgpt");
  await fsp.mkdir(originalResourceDir, { recursive: true });
  const originalResourceExec = path.join(originalResourceDir, "Contents", "MacOS", execName);
  await fsp.mkdir(path.dirname(originalResourceExec), { recursive: true });
  await fsp.rename(origMacosExec, originalResourceExec);
  log(`[patch] 2. moved original ${execName} to .original_chatgpt/`);

  // 3. 备份原 Info.plist + Resources
  await fsp.copyFile(
    path.join(targetPath, "Contents", "Info.plist"),
    path.join(originalResourceDir, "Info.plist")
  );
  const originalResDir = path.join(appPath, "Contents", "Resources");
  if (existsSync(originalResDir)) {
    await copyDir(
      originalResDir,
      path.join(originalResourceDir, "Resources"),
      new Set([".original_chatgpt", "manager"])
    );
  }
  log(`[patch] 3. backed up Info.plist + Resources`);

  // 4. 用 Patcher.app 的 Info.plist 当模板，patched app 继承所有元数据
  //    原 ChatGPT.app 的 Info.plist 字段太简单，缺 LSMinimumSystemVersion 等
  //    Patcher.app 的 Info.plist 完整，拷过来 + 改 4 个字段就行
  const patcherInfoPlist = path.join(patcherContentsDir, "Info.plist");
  let patchedPlist;
  if (existsSync(patcherInfoPlist)) {
    patchedPlist = await fsp.readFile(patcherInfoPlist, "utf-8");
    // 替换关键字段
    patchedPlist = patchedPlist.replace(
      /<string>ChatGPT Patcher<\/string>/g,
      `<string>${helperBaseName}</string>`
    );
    // CFBundleExecutable 应该保持 "ChatGPT" (跟原 ChatGPT.app 一致，让 macOS 找我们的 wrapper)
    patchedPlist = patchedPlist.replace(
      /<key>CFBundleExecutable<\/key>\s*<string>ChatGPT Patcher<\/string>/,
      `<key>CFBundleExecutable</key>\n  <string>${execName}</string>`
    );
    // CFBundleIdentifier
    patchedPlist = patchedPlist.replace(
      /<key>CFBundleIdentifier<\/key>\s*<string>[^<]+<\/string>/,
      `<key>CFBundleIdentifier</key>\n  <string>${(plist.CFBundleIdentifier || "unknown") + ".patched"}</string>`
    );
    // 加 GPTPlusPatched 标记
    if (!patchedPlist.includes("GPTPlusPatched")) {
      patchedPlist = patchedPlist.replace(
        /<\/dict>/,
        `  <key>GPTPlusPatched</key>\n  <string>1</string>\n  <key>GPTPlusOriginalBundleId</key>\n  <string>${plist.CFBundleIdentifier || ""}</string>\n</dict>`
      );
    }
    await fsp.writeFile(path.join(targetPath, "Contents", "Info.plist"), patchedPlist);
    log(`[patch] 4. used Patcher Info.plist as template (CFBundleName=${helperBaseName})`);
  } else {
    // fallback
    const targetPlist = path.join(targetPath, "Contents", "Info.plist");
    const updated = await updatePlist(targetPlist, {
      CFBundleIdentifier: (plist.CFBundleIdentifier || "unknown") + ".patched",
      CFBundleName: helperBaseName,
      CFBundleDisplayName: helperBaseName,
      GPTPlusPatched: "1",
      GPTPlusOriginalBundleId: plist.CFBundleIdentifier || "",
    });
    await fsp.writeFile(targetPlist, updated);
    log(`[patch] 4. updated original Info.plist (CFBundleName=${helperBaseName})`);
  }

  // 5. wrapper = Patcher 的 launcher (跟 test-clone 一样的方案)
  //    Patcher.app 自带的 50KB launcher binary, rpath 找 Frameworks 下的 Electron Framework
  const ourWrapper = process.execPath;
  await fsp.copyFile(ourWrapper, origMacosExec);
  await fsp.chmod(origMacosExec, 0o755);
  log(`[patch] 5. copied wrapper binary to MacOS/${execName}`);

  // 拷 Frameworks/ + 重命名 helper apps
  const patcherContentsDir = path.dirname(path.dirname(process.execPath));
  const patcherFrameworks = path.join(patcherContentsDir, "Frameworks");
  const targetFrameworksDir = path.join(targetPath, "Contents", "Frameworks");
  if (existsSync(patcherFrameworks)) {
    await copyDir(patcherFrameworks, targetFrameworksDir);
    log(`[patch] 6. copied Frameworks/`);

    // 重命名 helpers
    const helperRenames = [
      { from: "ChatGPT Patcher Helper (GPU).app", binary: `${helperBaseName} Helper (GPU)` },
      { from: "ChatGPT Patcher Helper (Plugin).app", binary: `${helperBaseName} Helper (Plugin)` },
      { from: "ChatGPT Patcher Helper (Renderer).app", binary: `${helperBaseName} Helper (Renderer)` },
      { from: "ChatGPT Patcher Helper.app", binary: `${helperBaseName} Helper` },
    ];
    for (const { from, binary } of helperRenames) {
      const src = path.join(targetFrameworksDir, from);
      const dst = path.join(targetFrameworksDir, binary + ".app");
      if (!existsSync(src)) continue;
      // 1. 改 Info.plist
      const hp = path.join(src, "Contents", "Info.plist");
      if (existsSync(hp)) {
        let pl = await fsp.readFile(hp, "utf-8");
        pl = pl.replace(/<string>ChatGPT Patcher Helper[^<]*<\/string>/g, `<string>${binary}</string>`);
        pl = pl.replace(/<string>com\.aibsd\.chatgpt\.patcher\.helper[^<]*<\/string>/g, `<string>com.${baseName.toLowerCase().replace(/-/g, "_")}.helper</string>`);
        await fsp.writeFile(hp, pl);
      }
      // 2. 重命名 MacOS binary
      const macosSrc = path.join(src, "Contents", "MacOS");
      if (existsSync(macosSrc)) {
        const macosFiles = await fsp.readdir(macosSrc);
        for (const f of macosFiles) {
          if (f.startsWith("ChatGPT Patcher Helper")) {
            const newName = binary + f.substring("ChatGPT Patcher Helper".length);
            await fsp.rename(path.join(macosSrc, f), path.join(macosSrc, newName));
          }
        }
      }
      // 3. 重命名 .app 目录
      await fsp.rename(src, dst);
      log(`[patch]    helper: ${from} -> ${binary}.app`);
    }
  } else {
    throw new Error(`Patcher Frameworks/ not found at ${patcherFrameworks}`);
  }

  // 7. 嵌入 payload/manager/ 到 Resources/manager/
  const payloadDir = app.isPackaged
    ? path.join(process.resourcesPath, "payload", "manager")
    : path.join(__dirname, "..", "payload", "manager");
  const targetManagerDir = path.join(targetPath, "Contents", "Resources", "manager");
  if (!existsSync(payloadDir)) {
    throw new Error(`payload 目录不存在: ${payloadDir}`);
  }
  await copyDir(payloadDir, targetManagerDir);
  log(`[patch] 7. embedded payload/manager/`);

  // 8. 拷 Patcher 自带的 app.asar (wrapper 启动需要 Resources/app.asar)
  const patcherAsar = path.join(patcherContentsDir, "Resources", "app.asar");
  const targetAsar = path.join(targetPath, "Contents", "Resources", "app.asar");
  if (existsSync(patcherAsar)) {
    await fsp.copyFile(patcherAsar, targetAsar);
    log(`[patch] 8. copied app.asar`);
  } else {
    throw new Error(`Patcher app.asar not found at ${patcherAsar}`);
  }

  // 9. 加 PkgInfo (macOS bundle 需要)
  await fsp.writeFile(path.join(targetPath, "Contents", "PkgInfo"), "APPL????");
  log(`[patch] 9. added PkgInfo`);

  log(`[patch] DONE: ${targetPath}`);
  return {
    target: targetPath,
    original: appPath,
  };
}
