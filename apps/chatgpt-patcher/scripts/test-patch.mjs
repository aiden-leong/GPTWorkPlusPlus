#!/usr/bin/env node
// 测试 Patcher 的 patch 流程（不通过 UI，直接调 patcher-main 的 IPC handler 等价逻辑）
// 实际生产中 Patcher UI 调 ipcRenderer.invoke('patch', appPath)，这里模拟

import { cp, rm, mkdir, rename, readFile, writeFile, chmod, copyFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const SOURCE = process.argv[2] || "/tmp/dummy-chatgpt.app";
const PAYLOAD_MANAGER = path.resolve(process.cwd(), "payload/manager");
const WRAPPER = process.execPath;  // node binary in this test, but in real Patcher it's electron binary

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
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (skipNames.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d, skipNames);
    else if (entry.isSymbolicLink()) {
      const { readlink, symlink } = await import("node:fs/promises");
      const link = await readlink(s);
      await symlink(link, d);
    } else await copyFile(s, d);
  }
}

async function updatePlist(p, updates) {
  let xml = await readFile(p, "utf-8");
  for (const [key, value] of Object.entries(updates)) {
    const safe = String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (xml.includes(`<key>${key}</key>`)) {
      xml = xml.replace(
        new RegExp(`(<key>${key}<\\/key>\\s*)<string>[^<]+<\\/string>`),
        `$1<string>${safe}</string>`
      );
    } else {
      xml = xml.replace(/<\/dict>/, `  <key>${key}</key>\n  <string>${safe}</string>\n</dict>`);
    }
  }
  return xml;
}

async function patch(appPath) {
  console.log(`[test] patching ${appPath}`);
  if (!existsSync(appPath)) throw new Error(`source not found: ${appPath}`);
  const infoPlist = path.join(appPath, "Contents", "Info.plist");
  if (!existsSync(infoPlist)) throw new Error("no Info.plist");
  const plist = await parsePlist(infoPlist);
  console.log(`[test] plist:`, plist);
  const execName = plist.CFBundleExecutable;
  if (!execName) throw new Error("no CFBundleExecutable");

  const parent = path.dirname(appPath);
  const baseName = path.basename(appPath, ".app");
  const target = path.join(parent, `${baseName}++.app`);

  if (existsSync(target)) throw new Error(`target exists: ${target}`);
  console.log(`[test] target: ${target}`);

  // 1. 复制
  await copyDir(appPath, target);
  console.log(`[test] 1. copied .app`);

  // 2. 备份原 exec + 拷贝 Info.plist
  const origExec = path.join(target, "Contents", "MacOS", execName);
  const backupDir = path.join(target, "Contents", "Resources", ".original_chatgpt", "Contents", "MacOS");
  await mkdir(backupDir, { recursive: true });
  const backupExec = path.join(backupDir, execName);
  await rename(origExec, backupExec);
  console.log(`[test] 2. moved ${execName} to backup`);

  // 3. 备份 Info.plist + Resources
  await copyFile(path.join(target, "Contents", "Info.plist"), path.join(target, "Contents", "Resources", ".original_chatgpt", "Info.plist"));
  const origResDir = path.join(appPath, "Contents", "Resources");
  if (existsSync(origResDir)) {
    await copyDir(origResDir, path.join(target, "Contents", "Resources", ".original_chatgpt", "Resources"), new Set([".original_chatgpt", "manager"]));
  }
  console.log(`[test] 3. backed up Info.plist + Resources`);

  // 4. 复制 wrapper 到 MacOS/<exec>
  await copyFile(WRAPPER, origExec);
  await chmod(origExec, 0o755);
  console.log(`[test] 4. wrapper placed at MacOS/${execName} (using test binary: ${WRAPPER})`);

  // 5. 嵌入 payload
  const targetManager = path.join(target, "Contents", "Resources", "manager");
  if (!existsSync(PAYLOAD_MANAGER)) throw new Error(`payload missing: ${PAYLOAD_MANAGER}`);
  await copyDir(PAYLOAD_MANAGER, targetManager);
  console.log(`[test] 5. embedded payload/manager/`);

  // 6. 改 Info.plist
  const targetPlist = path.join(target, "Contents", "Info.plist");
  const updated = await updatePlist(targetPlist, {
    CFBundleIdentifier: (plist.CFBundleIdentifier || "x") + ".patched",
    CFBundleName: (plist.CFBundleName || baseName) + "++",
    CFBundleDisplayName: (plist.CFBundleDisplayName || plist.CFBundleName || baseName) + "++",
    GPTPlusPatched: "1",
  });
  await writeFile(targetPlist, updated);
  console.log(`[test] 6. updated Info.plist`);

  console.log(`[test] DONE: ${target}`);
  return { target, original: appPath };
}

const r = await patch(SOURCE);
console.log(JSON.stringify(r, null, 2));
