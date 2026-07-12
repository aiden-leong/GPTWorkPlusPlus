// Launch helpers — 跨平台启动 Codex
// 对应 Rust crates/codex-plus-core/src/launcher.rs

import { spawn, exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";
const IS_LINUX = process.platform === "linux";

export async function launchCodexPlus(appPath, debugPort = 9229, helperPort = 57321) {
  const args = [
    "--remote-debugging-port=" + debugPort,
    "--remote-debugging-address=127.0.0.1",
  ];
  if (helperPort) {
    args.push("--codex-helper-port=" + helperPort);
  }
  if (IS_MAC) {
    const target = appPath && appPath.trim() ? appPath : "Codex";
    try {
      await execAsync(`open -na "${target}" --args ${args.map((a) => `"${a}"`).join(" ")}`);
      return { status: "ok", message: `已启动 ${target}` };
    } catch (err) {
      return { status: "failed", message: err.message };
    }
  }
  if (IS_WIN) {
    const target = appPath && appPath.trim() ? appPath : "codex";
    try {
      const child = spawn(target, args, { detached: true, stdio: "ignore" });
      child.unref();
      return { status: "ok", message: `已启动 ${target}` };
    } catch (err) {
      return { status: "failed", message: err.message };
    }
  }
  // linux: assume codex in PATH
  try {
    const child = spawn("codex", args, { detached: true, stdio: "ignore" });
    child.unref();
    return { status: "ok", message: "已启动 codex" };
  } catch (err) {
    return { status: "failed", message: err.message };
  }
}

export async function openExternalUrl(url) {
  if (!url || typeof url !== "string") {
    return { status: "failed", message: "url 不能为空" };
  }
  let cmd, args;
  if (IS_MAC) {
    cmd = "open";
    args = [url];
  } else if (IS_WIN) {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.unref();
    return { status: "ok", message: `已打开 ${url}` };
  } catch (err) {
    return { status: "failed", message: err.message };
  }
}
