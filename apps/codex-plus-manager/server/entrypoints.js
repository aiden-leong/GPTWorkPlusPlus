// macOS 入口（.app bundles）— 对应 Rust crates/codex-plus-core/src/install/macos.rs
//
// 在用户 ~/Applications/ 下创建两个 .app bundle：
// - Codex++.app：静默启动 Codex（远程调试端口注入）
// - Codex++ 管理工具.app：启动管理界面 HTTP server
//
// bundle 结构（标准 macOS .app）：
//   <Name>.app/Contents/
//     Info.plist
//     MacOS/<executable>  (shell script wrapper, chmod 755)
//     Resources/REPO_PATH (记录仓库根的纯文本文件)
//
// shell script 通过 Resources/REPO_PATH 找到仓库根，
// 然后 exec node 调对应的 server 脚本。
//
// 非 macOS 平台：返回 failed（前端会忽略，UI 降级）

import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

const IS_MAC = process.platform === "darwin";

const SILENT_NAME = "Codex++";
const MANAGER_NAME = "Codex++ 管理工具";
const VERSION = "0.0.0-node";

// REPO 根 = server 脚本所在目录的 4 级父目录
// server/ -> codex-plus-manager/ -> apps/ -> <root>
function detectRepoRoot() {
  // server/entrypoints.js -> apps/codex-plus-manager/server/
  // apps/codex-plus-manager/server/../../.. = <root>
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
}

const REPO_ROOT = detectRepoRoot();

function defaultInstallRoot() {
  if (!IS_MAC) return null;
  // 用户级 ~/Applications，避开系统 /Applications
  return path.join(os.homedir(), "Applications");
}

function buildInfoPlist(displayName, executableName, identifierSuffix) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${displayName}</string>
  <key>CFBundleDisplayName</key>
  <string>${displayName}</string>
  <key>CFBundleIdentifier</key>
  <string>com.codexplusplus${identifierSuffix}</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>${executableName}</string>
  <key>LSUIElement</key>
  <true/>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
</dict>
</plist>
`;
}

function buildLaunchScript(mode) {
  // mode = "silent" | "manager"
  // silent: 调 server/launcher.js 启动 Codex.app + 注入
  // manager: 调 server/index.js 启动 HTTP API + 浏览器打开
  const target = mode === "manager"
    ? "apps/codex-plus-manager/server/index.js"
    : "apps/codex-plus-manager/server/launcher.js";

  return `#!/bin/sh
# Codex++ bundle launcher (${mode})
# 从 Resources/REPO_PATH 读取仓库根，再 exec node
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RES_DIR="$DIR/../Resources"
if [ -f "$RES_DIR/REPO_PATH" ]; then
  REPO=$(cat "$RES_DIR/REPO_PATH")
else
  REPO=""
fi
if [ -z "$REPO" ] || [ ! -d "$REPO" ]; then
  echo "Codex++: 找不到仓库根 ($REPO)，请重新运行 install entrypoints" >&2
  exit 1
fi
exec node "$REPO/${target}" "$@"
`;
}

async function writeBundle({ appPath, displayName, executableName, identifierSuffix, mode }) {
  const contents = path.join(appPath, "Contents");
  const macos = path.join(contents, "MacOS");
  const resources = path.join(contents, "Resources");

  await fs.mkdir(macos, { recursive: true });
  await fs.mkdir(resources, { recursive: true });

  await fs.writeFile(path.join(contents, "Info.plist"), buildInfoPlist(displayName, executableName, identifierSuffix));

  const executable = path.join(macos, executableName);
  await fs.writeFile(executable, buildLaunchScript(mode));
  await fs.chmod(executable, 0o755);

  // Resources/REPO_PATH — 记录仓库根（launcher 读这个找入口）
  await fs.writeFile(path.join(resources, "REPO_PATH"), REPO_ROOT);
}

async function removeBundle(appPath) {
  try {
    await fs.rm(appPath, { recursive: true, force: true });
  } catch {}
}

function buildAppBundle(installRoot, manager) {
  const displayName = manager ? MANAGER_NAME : SILENT_NAME;
  const executableName = manager ? "CodexPlusPlusManager" : "CodexPlusPlus";
  const identifierSuffix = manager ? ".manager" : "";
  return {
    appPath: path.join(installRoot, `${displayName}.app`),
    displayName,
    executableName,
    identifierSuffix,
    mode: manager ? "manager" : "silent",
  };
}

async function inspectShortcuts(installRoot) {
  const silentApp = path.join(installRoot, `${SILENT_NAME}.app`);
  const managerApp = path.join(installRoot, `${MANAGER_NAME}.app`);
  const [silentExists, managerExists] = await Promise.all([
    pathExists(silentApp),
    pathExists(managerApp),
  ]);
  return {
    silent_shortcut: { installed: silentExists, path: silentApp },
    management_shortcut: { installed: managerExists, path: managerApp },
  };
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// ====== Public API ======

export async function installEntrypoints(options = {}) {
  if (!IS_MAC) {
    return {
      status: "failed",
      message: "当前平台暂不支持安装 Codex++ 入口（仅 macOS）",
      silent_shortcut: { installed: false, path: null },
      management_shortcut: { installed: false, path: null },
    };
  }
  const installRoot = options.installRoot || defaultInstallRoot();
  try {
    await fs.mkdir(installRoot, { recursive: true });
    await writeBundle({ ...buildAppBundle(installRoot, false), mode: "silent" });
    await writeBundle({ ...buildAppBundle(installRoot, true), mode: "manager" });
    return {
      status: "ok",
      message: `入口已安装到 ${installRoot}`,
      ...(await inspectShortcuts(installRoot)),
    };
  } catch (err) {
    return {
      status: "failed",
      message: `安装失败：${err.message}`,
      ...(await inspectShortcuts(installRoot)),
    };
  }
}

export async function uninstallEntrypoints(options = {}) {
  if (!IS_MAC) {
    return {
      status: "failed",
      message: "当前平台暂不支持卸载 Codex++ 入口（仅 macOS）",
      silent_shortcut: { installed: false, path: null },
      management_shortcut: { installed: false, path: null },
    };
  }
  const installRoot = options.installRoot || defaultInstallRoot();
  try {
    await removeBundle(path.join(installRoot, `${SILENT_NAME}.app`));
    await removeBundle(path.join(installRoot, `${MANAGER_NAME}.app`));
    return {
      status: "ok",
      message: `入口已从 ${installRoot} 卸载`,
      ...(await inspectShortcuts(installRoot)),
    };
  } catch (err) {
    return {
      status: "failed",
      message: `卸载失败：${err.message}`,
      ...(await inspectShortcuts(installRoot)),
    };
  }
}

export async function repairShortcuts(options = {}) {
  // 修复 = 重新安装（Info.plist 损坏、binary 丢失、权限错误都能修）
  return installEntrypoints(options);
}

export async function inspectEntrypoints() {
  if (!IS_MAC) {
    return {
      silent_shortcut: { installed: false, path: null },
      management_shortcut: { installed: false, path: null },
    };
  }
  return inspectShortcuts(defaultInstallRoot());
}
