// ChatGPT Patcher — 主进程
//
// 只做 Patcher（不再做 wrapper 模式）。
// 流程：拖入 .app → clone + 注入 hook + Developer ID 重签 → ChatGPT++.app

const { app, BrowserWindow, ipcMain, dialog, protocol } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const { execSync, spawn } = require("node:child_process");
const { existsSync } = require("node:fs");

// ===== 日志 =====
const LOG_PATH = path.join(os.homedir(), "chatgpt-patcher.log");
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch (e) { console.log("log err:", e.message); }
  console.log(...args);
}

try { fs.appendFileSync(LOG_PATH, `[boot] app started\n`); } catch {}

// ===== 配置 =====
const CODE_SIGN_IDENTITY = process.env.CODE_SIGN_IDENTITY ||
  "Developer ID Application: Hefei Ragdoll Technology Co.,Ltd. (BR8ZH293JZ)";
const KEYCHAIN_PROFILE = process.env.NOTARY_KEYCHAIN_PROFILE || null;  // null = skip notarize
const HOOK_REL_PATH = "patcher-resources/inject/hook.js";  // patched app Resources 里的 hook
const ADMIN_UI_REL_DIR = "patcher-resources/admin-ui";     // patched app Resources 里的 admin UI

// ===== Patcher UI =====
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

function sendLog(msg) {
  if (mainWindow) {
    mainWindow.webContents.send("log", msg);
  }
}

// ===== IPC: inspect =====
ipcMain.handle("inspect", async (_evt, appPath) => {
  if (!appPath || typeof appPath !== "string") throw new Error("appPath 不能为空");
  if (!existsSync(appPath)) throw new Error("路径不存在");
  const stat = await fsp.stat(appPath);
  if (!stat.isDirectory()) throw new Error("不是一个目录");
  if (!appPath.endsWith(".app")) throw new Error("不是 .app 后缀");
  const infoPlist = path.join(appPath, "Contents", "Info.plist");
  if (!existsSync(infoPlist)) throw new Error("没有 Contents/Info.plist");
  const plist = await parsePlist(infoPlist);

  // 检查是否是 Electron app
  const frameworksDir = path.join(appPath, "Contents", "Frameworks");
  const hasElectronFramework = existsSync(path.join(frameworksDir, "Electron Framework.framework"));
  const hasAppAsar = existsSync(path.join(appPath, "Contents", "Resources", "app.asar"));

  return {
    path: appPath,
    name: plist.CFBundleName || path.basename(appPath, ".app"),
    bundleId: plist.CFBundleIdentifier || "",
    bundleExecutable: plist.CFBundleExecutable || "",
    version: plist.CFBundleShortVersionString || "0.0.0",
    isElectron: hasElectronFramework,
    hasAppAsar,
  };
});

// ===== IPC: patch =====
ipcMain.handle("patch", async (_evt, appPath) => {
  return await doPatch(appPath, sendLog);
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
    title: "选择 .app",
    properties: ["openFile", "openDirectory"],
    defaultPath: "/Applications",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ===== patch 主流程 =====
async function doPatch(appPath, log) {
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

  log(`[patch] source: ${appPath}`);
  log(`[patch] target: ${targetPath}`);

  // 1. 复制整个 .app
  log(`[patch] 1. cloning .app bundle...`);
  await copyDir(appPath, targetPath);

  // 2. 更新 Info.plist
  log(`[patch] 2. updating Info.plist...`);
  const targetInfoPlist = path.join(targetPath, "Contents", "Info.plist");
  let targetPlistContent = await fsp.readFile(targetInfoPlist, "utf-8");
  // 移除 ElectronAsarIntegrity (我们要改 asar)
  targetPlistContent = targetPlistContent.replace(
    /<key>ElectronAsarIntegrity<\/key>[\s\S]*?<\/dict>/,
    ""
  );
  // 改 CFBundleIdentifier
  const newBundleId = (plist.CFBundleIdentifier || "unknown") + ".patched";
  targetPlistContent = targetPlistContent.replace(
    /(<key>CFBundleIdentifier<\/key>\s*<string>)[^<]+(<\/string>)/,
    `$1${newBundleId}$2`
  );
  // 改 CFBundleName
  const newName = baseName + "++";
  targetPlistContent = targetPlistContent.replace(
    /(<key>CFBundleName<\/key>\s*<string>)[^<]+(<\/string>)/,
    `$1${newName}$2`
  );
  targetPlistContent = targetPlistContent.replace(
    /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]+(<\/string>)/,
    `$1${newName}$2`
  );
  // 加 patch 标记
  if (!targetPlistContent.includes("GPTPlusPatched")) {
    targetPlistContent = targetPlistContent.replace(
      /<\/dict>/,
      `  <key>GPTPlusPatched</key>\n  <string>1</string>\n  <key>GPTPlusOriginalBundleId</key>\n  <string>${plist.CFBundleIdentifier || ""}</string>\n</dict>`
    );
  }
  await fsp.writeFile(targetInfoPlist, targetPlistContent);
  log(`[patch]    bundleId: ${newBundleId}`);
  log(`[patch]    name: ${newName}`);

  // 3. 注入 hook 到原 main entry
  log(`[patch] 3. injecting hook into main entry...`);
  const resourcesDir = path.join(targetPath, "Contents", "Resources");
  const appAsar = path.join(resourcesDir, "app.asar");
  const appDir = path.join(resourcesDir, "app");

  if (existsSync(appAsar)) {
    // 提取 → 改 main → 重打包
    await injectIntoAsar(appAsar, log);
  } else if (existsSync(appDir)) {
    // 直接改文件
    await injectIntoAppDir(appDir, log);
  } else {
    throw new Error("找不到 app.asar 或 app/ 目录 (不是 Electron app?)");
  }

  // 4. 嵌入 admin UI
  log(`[patch] 4. embedding admin UI...`);
  const adminUiSrc = app.isPackaged
    ? path.join(process.resourcesPath, "patcher-resources", "admin-ui")
    : path.join(__dirname, "..", "inject", "admin-ui");
  const adminUiDst = path.join(targetPath, "Contents", "Resources", "patcher-resources", "admin-ui");
  if (!existsSync(adminUiSrc)) {
    throw new Error(`patcher-resources/admin-ui 不存在: ${adminUiSrc}`);
  }
  await copyDir(adminUiSrc, adminUiDst);
  log(`[patch]    admin UI at: ${adminUiDst}`);

  // 5. 嵌入 hook.js (在 patcher-resources/inject/)
  log(`[patch] 5. embedding hook.js...`);
  const hookSrc = app.isPackaged
    ? path.join(process.resourcesPath, "patcher-resources", "inject", "hook.js")
    : path.join(__dirname, "..", "inject", "hook.js");
  const hookDst = path.join(targetPath, "Contents", "Resources", "patcher-resources", "inject", "hook.js");
  await fsp.mkdir(path.dirname(hookDst), { recursive: true });
  await fsp.copyFile(hookSrc, hookDst);
  log(`[patch]    hook at: ${hookDst}`);

  // 5.5. helper apps 重命名匹配新 CFBundleName
  log(`[patch] 5.5. renaming helper apps...`);
  const helperBaseName = newName;  // e.g. "Test Electron App++"
  const helperOriginalBase = plist.CFBundleName || baseName;
  const frameworksDir = path.join(targetPath, "Contents", "Frameworks");
  const items = await fsp.readdir(frameworksDir).catch(() => []);
  for (const name of items) {
    if (name.endsWith(".app") && name.startsWith(helperOriginalBase)) {
      const oldPath = path.join(frameworksDir, name);
      const newHelperName = name.replace(helperOriginalBase, helperBaseName);
      const newPath = path.join(frameworksDir, newHelperName);
      const oldBinary = name.replace(/\.app$/, "");
      const newBinary = newHelperName.replace(/\.app$/, "");
      await fsp.rename(oldPath, newPath);
      const oldBinPath = path.join(newPath, "Contents", "MacOS", oldBinary);
      const newBinPath = path.join(newPath, "Contents", "MacOS", newBinary);
      try { await fsp.rename(oldBinPath, newBinPath); } catch {}
      const helperInfoPlist = path.join(newPath, "Contents", "Info.plist");
      if (existsSync(helperInfoPlist)) {
        let hpl = await fsp.readFile(helperInfoPlist, "utf-8");
        hpl = hpl.replace(new RegExp(`<string>${oldBinary}<\\/string>`, "g"), `<string>${newBinary}</string>`);
        await fsp.writeFile(helperInfoPlist, hpl);
      }
      log(`[patch]    ${name} -> ${newHelperName}`);
    }
  }

  // 6. Developer ID 重签
  log(`[patch] 6. code signing with Developer ID...`);
  await reSignApp(targetPath, log);

  log(`[patch] DONE: ${targetPath}`);
  return {
    target: targetPath,
    original: appPath,
  };
}

// ===== 注入到 app.asar =====
async function injectIntoAsar(asarPath, log) {
  const asar = require("/Users/aiden/Projects/GPTWorkPlusPlus/apps/codex-plus-manager/node_modules/@electron/asar");
  // 读 package.json 找 main
  const pkgBuf = asar.extractFile(asarPath, "package.json");
  const pkg = JSON.parse(pkgBuf.toString("utf-8"));
  const mainEntry = pkg.main || "index.js";
  log(`[patch]    asar main entry: ${mainEntry}`);

  // 读 main 内容
  const mainBuf = asar.extractFile(asarPath, mainEntry);
  let mainContent = mainBuf.toString("utf-8");
  const beforeSnippet = "// === ChatGPT++ Patcher inject start ===\n// (do not edit - this block is auto-injected by ChatGPT Patcher)\nrequire('../patcher-resources/inject/hook.js');\n// === ChatGPT++ Patcher inject end ===\n";
  // 检查是否已经注入过
  if (mainContent.includes("ChatGPT++ Patcher inject start")) {
    log(`[patch]    already injected, skipping`);
    return;
  }
  // prepend
  const newContent = beforeSnippet + mainContent;

  // 重新打包 asar
  // 用 asar 的 API: 提取所有文件，改 main 内容，重打包
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "patcher-asar-"));
  asar.extractAll(asarPath, tmpDir);
  await fsp.writeFile(path.join(tmpDir, mainEntry), newContent);
  // 删除原 asar，重打包
  await fsp.unlink(asarPath);
  await asar.createPackage(tmpDir, asarPath);
  await fsp.rm(tmpDir, { recursive: true, force: true });
  log(`[patch]    asar repacked: ${asarPath}`);
}

// ===== 注入到 app/ 目录 =====
async function injectIntoAppDir(appDir, log) {
  // 读 package.json 找 main
  const pkgPath = path.join(appDir, "package.json");
  const pkg = JSON.parse(await fsp.readFile(pkgPath, "utf-8"));
  const mainEntry = pkg.main || "index.js";
  const mainPath = path.join(appDir, mainEntry);
  if (!existsSync(mainPath)) {
    throw new Error(`main entry 不存在: ${mainPath}`);
  }
  log(`[patch]    app main entry: ${mainPath}`);

  let mainContent = await fsp.readFile(mainPath, "utf-8");
  if (mainContent.includes("ChatGPT++ Patcher inject start")) {
    log(`[patch]    already injected, skipping`);
    return;
  }
  // prepend (require 路径从 main.js 算到 patcher-resources/inject/hook.js)
  // main 在 app/main.js, hook 在 app/../patcher-resources/inject/hook.js
  // 相对: ./../patcher-resources/inject/hook.js
  const hookRel = "./../patcher-resources/inject/hook.js";
  const beforeSnippet = `// === ChatGPT++ Patcher inject start ===\n// (do not edit - this block is auto-injected by ChatGPT Patcher)\nrequire('${hookRel}');\n// === ChatGPT++ Patcher inject end ===\n`;
  const newContent = beforeSnippet + mainContent;
  await fsp.writeFile(mainPath, newContent);
  log(`[patch]    hook injected`);
}

// ===== Developer ID 重签 =====
async function reSignApp(appPath, log) {
  // 找 inject 目录的 patcher-resources (在 patched app 内部)
  const injectDir = path.join(appPath, "Contents", "Resources", "patcher-resources");
  if (existsSync(injectDir)) {
    // 嵌入到 asar (因为 Patcher 自带的 hook + admin UI 也要进 asar)
    // 实际: 我们已经把 hook + admin UI 放在 Resources/patcher-resources/
    // 不需要 asar
  }

  // 用 codesign 命令重签
  log(`[patch]    signing with: ${CODE_SIGN_IDENTITY}`);

  // 先 sign helper apps + frameworks (深度签)
  const helperApps = await fsp.readdir(path.join(appPath, "Contents", "Frameworks")).catch(() => []);
  for (const name of helperApps) {
    if (name.endsWith(".app")) {
      const p = path.join(appPath, "Contents", "Frameworks", name);
      try {
        execSync(`codesign --force --deep --sign "${CODE_SIGN_IDENTITY}" --options runtime --entitlements ${JSON.stringify(getEntitlements())} "${p}"`, { stdio: "pipe" });
      } catch (e) {
        log(`[patch]    warn: failed to sign ${name}: ${e.message.slice(0, 100)}`);
      }
    }
  }
  // sign frameworks
  const frameworks = await fsp.readdir(path.join(appPath, "Contents", "Frameworks")).catch(() => []);
  for (const name of frameworks) {
    if (name.endsWith(".framework")) {
      const p = path.join(appPath, "Contents", "Frameworks", name);
      try {
        execSync(`codesign --force --sign "${CODE_SIGN_IDENTITY}" --options runtime "${p}"`, { stdio: "pipe" });
      } catch (e) {
        log(`[patch]    warn: failed to sign framework ${name}: ${e.message.slice(0, 100)}`);
      }
    }
  }
  // sign .app
  try {
    execSync(`codesign --force --deep --sign "${CODE_SIGN_IDENTITY}" --options runtime --entitlements ${JSON.stringify(getEntitlements())} "${appPath}"`, { stdio: "pipe" });
    log(`[patch]    signed: ${appPath}`);
  } catch (e) {
    log(`[patch]    ERROR signing app: ${e.message}`);
    throw new Error(`重签失败: ${e.message.slice(0, 200)}`);
  }
}

function getEntitlements() {
  // 简化版: 用 inline plist
  // 实际应该写文件
  return '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/><key>com.apple.security.cs.disable-library-validation</key><true/><key>com.apple.security.app-sandbox</key><false/></dict></plist>';
}

// ===== 工具 =====
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
      const { readlink, symlink } = require("node:fs/promises");
      await symlink(await readlink(s), d);
    } else await fsp.copyFile(s, d);
  }
}

// ===== App lifecycle =====
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
