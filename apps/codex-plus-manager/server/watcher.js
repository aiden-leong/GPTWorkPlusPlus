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

// Watcher 进程调用的 shell 脚本 — 当前只保持 launchd happy，
// 不死循环。后续接真实 chokidar/fs.watch 时替换。
const WATCHER_PROGRAM_SCRIPT = `#!/bin/sh
# Codex++ watcher placeholder
# 持续运行 launchd 要求（interval > 30s 会被 throttle）
# 真实的事件监听未来在这里启动
while true; do
  sleep 300
done
`;

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
    await fs.writeFile(scriptPath, WATCHER_PROGRAM_SCRIPT);
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
