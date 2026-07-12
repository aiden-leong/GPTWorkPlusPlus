#!/usr/bin/env node
// 独立测试 patch 流程 (不通过 UI)
// 直接复用 patcher-main.cjs 的逻辑

import { readFile, writeFile, mkdir, rm, cp, copyFile, readdir, stat, rename, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import asar from "/Users/aiden/Projects/GPTWorkPlusPlus/apps/codex-plus-manager/node_modules/@electron/asar/lib/asar.js";

const SOURCE = process.argv[2] || "/tmp/test-electron-app/release/mac-arm64/Test Electron App.app";
const HOOK_SRC = "/Users/aiden/Projects/GPTWorkPlusPlus/.worktrees/chatgpt-patcher/apps/chatgpt-patcher/inject/hook.js";
const ADMIN_UI_SRC = "/Users/aiden/Projects/GPTWorkPlusPlus/.worktrees/chatgpt-patcher/apps/chatgpt-patcher/inject/admin-ui";
const CODE_SIGN_IDENTITY = "Developer ID Application: Hefei Ragdoll Technology Co.,Ltd. (BR8ZH293JZ)";

const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.app-sandbox</key>
  <false/>
</dict>
</plist>`;

async function parsePlist(p) {
  const xml = await readFile(p, "utf-8");
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
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (skipNames.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d, skipNames);
    else if (entry.isSymbolicLink()) {
      // 处理 symlink
      const { readlink, symlink } = await import("node:fs/promises");
      const link = await readlink(s);
      try { await symlink(link, d); } catch {}
    } else await copyFile(s, d);
  }
}

async function doPatch(sourcePath) {
  console.log(`[patch] source: ${sourcePath}`);
  if (!existsSync(sourcePath)) throw new Error("source 不存在");
  const infoPlist = path.join(sourcePath, "Contents", "Info.plist");
  if (!existsSync(infoPlist)) throw new Error("没有 Info.plist");
  const plist = await parsePlist(infoPlist);
  console.log(`[patch] plist:`, plist);
  const execName = plist.CFBundleExecutable;
  const parent = path.dirname(sourcePath);
  const baseName = path.basename(sourcePath, ".app");
  const target = path.join(parent, `${baseName}++.app`);
  if (existsSync(target)) throw new Error(`target exists: ${target}`);

  console.log(`[patch] 1. cloning Patcher.app as template (NOT source app)...`);
  // 关键: 用 Patcher.app 整体作为 template，因为它的 Electron framework 的
  // ELECTRON_PRODUCT_NAME = "ChatGPT Patcher" 跟 helper 名字 ("ChatGPT Patcher Helper") 匹配
  // source app 自己的 framework 不行 (productName 不一致)
  const patcherApp = "/Users/aiden/Projects/GPTWorkPlusPlus/.worktrees/chatgpt-patcher/apps/chatgpt-patcher/release/mac-arm64/ChatGPT Patcher.app";
  if (!existsSync(patcherApp)) {
    throw new Error("Patcher.app 不存在, 先 npm run patcher:build:dir");
  }
  execSync(`cp -R "${patcherApp}" "${target}"`);
  console.log(`[patch]    template: ${patcherApp}`);

  // 从 source app 拷 app.asar (含原 main + 我们注入的 hook) + 备份原 Info.plist
  // 注意: 我们已经在 step 2 改 target 的 Info.plist (用 source 的字段)
  // 这里只拷 source 的 app.asar
  const sourceAppAsar = path.join(sourcePath, "Contents", "Resources", "app.asar");
  if (!existsSync(sourceAppAsar)) {
    throw new Error("source app 缺少 app.asar (不是 Electron app?)");
  }
  console.log(`[patch] 1b. copy source's app.asar...`);
  execSync(`cp "${sourceAppAsar}" "${path.join(target, "Contents", "Resources", "app.asar")}"`);
  console.log(`[patch]    ok`);

  console.log(`[patch] 2. updating Info.plist...`);
  const targetInfoPlist = path.join(target, "Contents", "Info.plist");
  let pl = await readFile(targetInfoPlist, "utf-8");
  pl = pl.replace(/<key>ElectronAsarIntegrity<\/key>[\s\S]*?<\/dict>/, "");
  pl = pl.replace(/(<key>CFBundleIdentifier<\/key>\s*<string>)[^<]+(<\/string>)/, `$1${(plist.CFBundleIdentifier || "x") + ".patched"}$2`);
  const newName = baseName + "++";
  pl = pl.replace(/(<key>CFBundleName<\/key>\s*<string>)[^<]+(<\/string>)/, `$1${newName}$2`);
  pl = pl.replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]+(<\/string>)/, `$1${newName}$2`);
  if (!pl.includes("GPTPlusPatched")) {
    pl = pl.replace(/<\/dict>/, `  <key>GPTPlusPatched</key>\n  <string>1</string>\n  <key>GPTPlusOriginalBundleId</key>\n  <string>${plist.CFBundleIdentifier || ""}</string>\n</dict>`);
  }
  await writeFile(targetInfoPlist, pl);
  console.log(`[patch]    bundleId: ${plist.CFBundleIdentifier}.patched, name: ${newName}`);

  console.log(`[patch] 3. injecting hook...`);
  const resourcesDir = path.join(target, "Contents", "Resources");
  const appAsar = path.join(resourcesDir, "app.asar");
  const appDir = path.join(resourcesDir, "app");
  if (existsSync(appAsar)) {
    const pkgBuf = asar.extractFile(appAsar, "package.json");
    const pkg = JSON.parse(pkgBuf.toString("utf-8"));
    const mainEntry = pkg.main || "index.js";
    console.log(`[patch]    asar main: ${mainEntry}`);
    const mainBuf = asar.extractFile(appAsar, mainEntry);
    let mainContent = mainBuf.toString("utf-8");
    if (mainContent.includes("ChatGPT++ Patcher inject start")) {
      console.log(`[patch]    already injected, skip`);
    } else {
      const hookRel = "../patcher-resources/inject/hook.js";
      const beforeSnippet = `// === ChatGPT++ Patcher inject start ===\nrequire('${hookRel}');\n// === ChatGPT++ Patcher inject end ===\n`;
      const newContent = beforeSnippet + mainContent;
      // 重新打包 asar
      const tmpDir = await mkdtemp(path.join(os.tmpdir(), "patcher-asar-"));
      asar.extractAll(appAsar, tmpDir);
      await writeFile(path.join(tmpDir, mainEntry), newContent);
      await rm(appAsar);
      await asar.createPackage(tmpDir, appAsar);
      await rm(tmpDir, { recursive: true, force: true });
      console.log(`[patch]    asar repacked`);
    }
  } else if (existsSync(appDir)) {
    const pkg = JSON.parse(await readFile(path.join(appDir, "package.json"), "utf-8"));
    const mainEntry = pkg.main || "index.js";
    const mainPath = path.join(appDir, mainEntry);
    console.log(`[patch]    app dir main: ${mainPath}`);
    let mainContent = await readFile(mainPath, "utf-8");
    if (!mainContent.includes("ChatGPT++ Patcher inject start")) {
      const hookRel = "./../patcher-resources/inject/hook.js";
      const beforeSnippet = `// === ChatGPT++ Patcher inject start ===\nrequire('${hookRel}');\n// === ChatGPT++ Patcher inject end ===\n`;
      await writeFile(mainPath, beforeSnippet + mainContent);
      console.log(`[patch]    injected`);
    }
  } else {
    throw new Error("找不到 app.asar 或 app/");
  }

  console.log(`[patch] 4. embedding admin UI...`);
  const adminUiDst = path.join(resourcesDir, "patcher-resources", "admin-ui");
  await copyDir(ADMIN_UI_SRC, adminUiDst);

  console.log(`[patch] 5. embedding hook...`);
  const hookDst = path.join(resourcesDir, "patcher-resources", "inject", "hook.js");
  await mkdir(path.dirname(hookDst), { recursive: true });
  await copyFile(HOOK_SRC, hookDst);

  console.log(`[patch] 5.5. no helper rename needed (using Patcher template)...`);
  console.log(`[patch]    Patcher template's helpers are "ChatGPT Patcher Helper" matching ELECTRON_PRODUCT_NAME`);

  // 5.6. MacOS binary 改名匹配 source app 的 CFBundleExecutable
  // Patcher template 的 MacOS binary 是 "ChatGPT Patcher"
  // 我们要 source 的 CFBundleExecutable (如 "Test Electron App")
  // rename: ChatGPT Patcher -> Test Electron App
  console.log(`[patch] 5.6. renaming MacOS binary...`);
  const macosDir = path.join(target, "Contents", "MacOS");
  const oldMacosBin = path.join(macosDir, "ChatGPT Patcher");
  const newMacosBin = path.join(macosDir, execName);
  if (oldMacosBin !== newMacosBin) {
    await rename(oldMacosBin, newMacosBin);
    console.log(`[patch]    ChatGPT Patcher -> ${execName}`);
  }

  console.log(`[patch] 6. signing...`);
  // sign helper apps + frameworks + 内嵌 dylibs
  const frameworksDir = path.join(target, "Contents", "Frameworks");
  const items2 = await readdir(frameworksDir).catch(() => []);
  for (const name of items2) {
    const p = path.join(frameworksDir, name);
    if (name.endsWith(".app")) {
      console.log(`[patch]    sign helper: ${name}`);
      execSync(`codesign --force --deep --sign "${CODE_SIGN_IDENTITY}" --options runtime --entitlements /tmp/patcher-entitlements.plist "${p}"`, { stdio: "pipe" });
    } else if (name.endsWith(".framework")) {
      // 先签 framework 内的 dylibs (Libraries/)
      const libsDir = path.join(p, "Versions", "A", "Libraries");
      if (existsSync(libsDir)) {
        const libs = await readdir(libsDir);
        for (const lib of libs) {
          if (lib.endsWith(".dylib")) {
            const libPath = path.join(libsDir, lib);
            try {
              execSync(`codesign --force --sign "${CODE_SIGN_IDENTITY}" --options runtime "${libPath}"`, { stdio: "pipe" });
            } catch (e) {
              console.log(`[patch]    warn: dylib sign failed: ${lib}: ${e.message.slice(0, 80)}`);
            }
          }
        }
      }
      // sign framework
      console.log(`[patch]    sign framework: ${name}`);
      execSync(`codesign --force --sign "${CODE_SIGN_IDENTITY}" --options runtime "${p}"`, { stdio: "pipe" });
    }
  }
  // sign top-level
  console.log(`[patch]    sign top-level`);
  execSync(`codesign --force --deep --sign "${CODE_SIGN_IDENTITY}" --options runtime --entitlements /tmp/patcher-entitlements.plist "${target}"`, { stdio: "pipe" });

  console.log(`[patch] DONE: ${target}`);
  return { target };
}

const r = await doPatch(SOURCE);
console.log(JSON.stringify(r, null, 2));
