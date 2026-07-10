// Zed remote 项目列表 + 打开
// 对应 Rust crates/codex-plus-core/src/zed_remote.rs
//
// 从 ~/.config/zed/settings.json 读 ssh_projects
// 每个项目：{ id, label, host, ssh: {user, host, port}, path, ... }

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";

const HOME = os.homedir();

const ZED_SETTINGS_CANDIDATES = [
  path.join(HOME, ".config", "zed", "settings.json"),
  path.join(HOME, "Library", "Application Support", "Zed", "settings.json"),
];

async function readZedSettings() {
  for (const p of ZED_SETTINGS_CANDIDATES) {
    try {
      const text = await fs.readFile(p, "utf8");
      return { path: p, json: JSON.parse(text) };
    } catch (err) {
      if (err.code !== "ENOENT") continue;
    }
  }
  return { path: null, json: null };
}

export async function listZedRemoteProjects() {
  const { path: zedPath, json } = await readZedSettings();
  if (!json) {
    return { projects: [] };
  }
  const projects = [];
  const sshProjects = json.ssh_projects ?? {};
  for (const [key, value] of Object.entries(sshProjects)) {
    if (!value || typeof value !== "object") continue;
    projects.push({
      id: key,
      label: value.label ?? key,
      hostId: value.host_id ?? key,
      ssh: {
        user: value.ssh_user ?? value.user ?? "",
        host: value.host ?? "",
        port: typeof value.port === "number" ? value.port : null,
      },
      path: value.path ?? "",
      url: value.url ?? `zed://ssh/${key}${value.path ?? ""}`,
      source: zedPath,
      lastOpenedAtMs: value.last_opened_at ?? null,
      isCurrent: false,
    });
  }
  return { projects };
}

export async function openZedRemote({ project, strategy }) {
  if (!project) {
    return { status: "failed", message: "project 不能为空" };
  }
  const url = project.url || (project.ssh?.host
    ? `zed://ssh/${project.ssh.user}@${project.ssh.host}${project.ssh.port ? `:${project.ssh.port}` : ""}${project.path || ""}`
    : null);
  if (!url) {
    return { status: "failed", message: "无法构造 zed URL" };
  }
  // 策略：default / newWindow / reuseWindow / addToFocusedWorkspace
  // macOS 用 `open`，Windows 用 `start`，Linux 用 `xdg-open`
  let cmd, args;
  if (process.platform === "darwin") {
    cmd = "open";
    args = strategy === "newWindow" ? ["-n", url] : [url];
  } else if (process.platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.unref();
    return { status: "ok", url, strategy: strategy || "default", message: `已打开 ${url}` };
  } catch (err) {
    return { status: "failed", message: err.message };
  }
}
