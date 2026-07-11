// 文件系统监听（launchd 包装）— 对应 Rust crates/codex-plus-core/src/watcher.rs
//
// 概念：watcher 是个常驻进程，监听 Codex config 变化（toml/auth）。
// Rust 版的 watcher 是 Windows-only（注册表 + .lnk 启动项）；
// macOS 版的等价物是 launchd LaunchAgent plist。
//
// 实际语义简化：
// - install: 写 ~/Library/LaunchAgents/<label>.plist + launchctl load
// - uninstall: launchctl unload + 删 plist
// - enable: 删 disabled flag（plist 存在则视为启用）
// - disable: 写 disabled flag（即使 plist 存在也禁用）
// - loadState: 看 plist + disabled flag 的组合状态
//
// 现阶段 plist 调一个轻量级 no-op watcher（保持 launchd 进程活着，
// 不死循环）— 真正的事件监听留给后续 watch 子模块。
// 这样 install 链路完整可验证，UI 能正确显示状态。

import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const IS_MAC = process.platform === "darwin";

const LABEL = "com.codexplusplus.watcher";
const PLIST_FILENAME = `${LABEL}.plist`;

function watcherDisabledFlag() {
  // ~/.codex-plus-plus/watcher.disabled
  return path.join(os.homedir(), ".codex-plus-plus", "watcher.disabled");
}

function launchAgentsDir() {
  return path.join(os.homedir(), "Library", "LaunchAgents");
}

function plistPath() {
  return path.join(launchAgentsDir(), PLIST_FILENAME);
}

// 监听目标目录 — Codex++ 的 settings / config / auth 变更
// 这是 watcher 的核心价值：捕获外部修改（比如 codex CLI 直接写 config.toml），
// 后续可触发 server 端 invalidate cache 或重载。
const WATCH_TARGETS = [
  path.join(os.homedir(), ".codex-plus-plus"),
  path.join(os.homedir(), ".codex"),
];

// Watcher 进程调用的 shell 脚本 — 用 `node --daemon` 调 startWatcher()
// 让 launchd 拉起独立进程，进程内跑 fs.watch 循环
function buildWatcherScript() {
  // server/watcher.js -> server/ <this file>
  const watcherJs = new URL(import.meta.url).pathname;
  return `#!/bin/sh
# Codex++ watcher — 监听 config 变化
exec node "${watcherJs}" --daemon
`;
}

function buildPlist() {
  // 找 watcher script 写到哪里 — bundle 资源目录外
  // 简单方案：写到 ~/.codex-plus-plus/watcher.sh
  const watcherScript = path.join(os.homedir(), ".codex-plus-plus", "watcher.sh");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>${watcherScript}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${path.join(os.homedir(), ".codex-plus-plus", "logs", "watcher.out.log")}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(os.homedir(), ".codex-plus-plus", "logs", "watcher.err.log")}</string>
</dict>
</plist>
`;
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDisabledByFlag() {
  return pathExists(watcherDisabledFlag());
}

async function isPlistLoaded() {
  if (!IS_MAC) return false;
  try {
    const { stdout } = await execFileAsync("launchctl", ["list", LABEL]);
    // launchctl list <label> 输出 PID 或 "-" + LastExitStatus
    return stdout.trim().split("\n").length > 0 && !stdout.includes("Could not find");
  } catch {
    return false;
  }
}

async function loadPlist() {
  if (!IS_MAC) return;
  try {
    await execFileAsync("launchctl", ["load", "-w", plistPath()]);
  } catch (err) {
    throw new Error(`launchctl load 失败：${err.message}`);
  }
}

async function unloadPlist() {
  if (!IS_MAC) return;
  try {
    await execFileAsync("launchctl", ["unload", "-w", plistPath()]);
  } catch (err) {
    // 没装载过也 OK
    if (!/No such file|service not loaded/i.test(err.message)) {
      throw new Error(`launchctl unload 失败：${err.message}`);
    }
  }
}

// ====== Public API ======

export async function loadWatcherState() {
  if (!IS_MAC) {
    return {
      status: "ok",
      enabled: false,
      disabled_flag: "watcher 在非 macOS 平台不支持",
    };
  }
  const plistInstalled = await pathExists(plistPath());
  const disabled = await isDisabledByFlag();
  const loaded = plistInstalled ? await isPlistLoaded() : false;
  return {
    status: "ok",
    enabled: plistInstalled && loaded && !disabled,
    disabled_flag: disabled ? watcherDisabledFlag() : "",
  };
}

export async function installWatcher() {
  if (!IS_MAC) {
    return {
      status: "failed",
      message: "watcher 在非 macOS 平台不支持",
      enabled: false,
      disabled_flag: "",
    };
  }
  try {
    // 1. 写 watcher script
    const scriptPath = path.join(os.homedir(), ".codex-plus-plus", "watcher.sh");
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.mkdir(path.join(os.homedir(), ".codex-plus-plus", "logs"), { recursive: true });
    await fs.writeFile(scriptPath, buildWatcherScript());
    await fs.chmod(scriptPath, 0o755);

    // 2. 写 plist
    await fs.mkdir(launchAgentsDir(), { recursive: true });
    await fs.writeFile(plistPath(), buildPlist());

    // 3. launchctl load
    await loadPlist();

    // 4. 移除 disabled flag（如果存在）
    try {
      await fs.unlink(watcherDisabledFlag());
    } catch {}

    return {
      status: "ok",
      message: `watcher 已安装并启动：${plistPath()}`,
      enabled: true,
      disabled_flag: "",
    };
  } catch (err) {
    return {
      status: "failed",
      message: `安装失败：${err.message}`,
      enabled: false,
      disabled_flag: "",
    };
  }
}

export async function uninstallWatcher() {
  if (!IS_MAC) {
    return {
      status: "ok",
      enabled: false,
      disabled_flag: "",
    };
  }
  try {
    await unloadPlist();
    try { await fs.unlink(plistPath()); } catch {}
    try { await fs.unlink(watcherDisabledFlag()); } catch {}
    return {
      status: "ok",
      message: "watcher 已卸载",
      enabled: false,
      disabled_flag: "",
    };
  } catch (err) {
    return {
      status: "failed",
      message: `卸载失败：${err.message}`,
      enabled: false,
      disabled_flag: "",
    };
  }
}

export async function enableWatcher() {
  if (!IS_MAC) {
    return {
      status: "failed",
      message: "watcher 在非 macOS 平台不支持",
      enabled: false,
      disabled_flag: "",
    };
  }
  try {
    // 1. 删 disabled flag
    try { await fs.unlink(watcherDisabledFlag()); } catch {}
    // 2. 如果 plist 存在，load
    if (await pathExists(plistPath())) {
      await loadPlist();
    } else {
      // 没装 plist 就装一个
      return installWatcher();
    }
    return {
      status: "ok",
      message: "watcher 已启用",
      enabled: true,
      disabled_flag: "",
    };
  } catch (err) {
    return {
      status: "failed",
      message: `启用失败：${err.message}`,
      enabled: false,
      disabled_flag: "",
    };
  }
}

export async function disableWatcher() {
  if (!IS_MAC) {
    return {
      status: "ok",
      enabled: false,
      disabled_flag: "",
    };
  }
  try {
    // 1. 写 disabled flag
    await fs.mkdir(path.dirname(watcherDisabledFlag()), { recursive: true });
    await fs.writeFile(watcherDisabledFlag(), "disabled by user");
    // 2. unload plist（不删）
    if (await pathExists(plistPath())) {
      await unloadPlist();
    }
    return {
      status: "ok",
      message: `watcher 已禁用（disabled flag: ${watcherDisabledFlag()}）`,
      enabled: false,
      disabled_flag: watcherDisabledFlag(),
    };
  } catch (err) {
    return {
      status: "failed",
      message: `禁用失败：${err.message}`,
      enabled: false,
      disabled_flag: "",
    };
  }
}

// ====== Daemon mode (launchd 拉起的独立进程) ======
//
// `node watcher.js --daemon` 启动后跑 fs.watch 循环：
// - 监听 ~/.codex-plus-plus 和 ~/.codex 下的 toml/json 变化
// - 变化时 append 一行到 ~/.codex-plus-plus/logs/watcher.events.log
// - 进程不死，launchd KeepAlive 兜底
//
// 这是真实功能：给后续 server 端 cache invalidation / UI reload 信号留 hook。

function logEvent(event, filename) {
  const logPath = path.join(os.homedir(), ".codex-plus-plus", "logs", "watcher.events.log");
  const line = `${new Date().toISOString()} ${event} ${filename}\n`;
  fs.mkdir(path.dirname(logPath), { recursive: true })
    .then(() => fs.appendFile(logPath, line))
    .catch(() => {});
}

async function startWatcher() {
  // 检查 disabled flag
  if (await pathExists(watcherDisabledFlag())) {
    process.stdout.write("watcher: disabled flag present, exiting\n");
    return;
  }
  const watchers = [];
  for (const target of WATCH_TARGETS) {
    try {
      await fs.access(target);
    } catch {
      continue; // 目录不存在就跳过
    }
    try {
      const w = fsSync.watch(target, { recursive: false }, (event, filename) => {
        if (!filename) return;
        // 只关心 toml / json / jsonc
        if (!/\.(toml|json|jsonc)$/i.test(filename)) return;
        logEvent(event, filename);
      });
      watchers.push(w);
      process.stdout.write(`watcher: watching ${target}\n`);
    } catch (err) {
      process.stderr.write(`watcher: failed to watch ${target}: ${err.message}\n`);
    }
  }
  if (watchers.length === 0) {
    process.stdout.write("watcher: no watchable directories, sleeping for keepalive\n");
    // 仍要 keepalive 让 launchd 满意，但本身没活干
    setInterval(() => {}, 1 << 30);
  }
  // 等 SIGTERM / SIGINT 干净退出
  const shutdown = () => {
    for (const w of watchers) {
      try { w.close(); } catch {}
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// 启动入口：node watcher.js --daemon
if (process.argv.includes("--daemon")) {
  startWatcher().catch((err) => {
    process.stderr.write(`watcher daemon failed: ${err.message}\n`);
    process.exit(1);
  });
}
