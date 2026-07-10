// 环境变量冲突检测
// 对应 Rust crates/codex-plus-core/src/env_conflicts.rs
//
// 扫描 process.env 与常见 shell rc 文件（~/.zshenv / ~/.zshrc / ~/.bashrc / ~/.bash_profile）
// 报告可能影响 Codex 的环境变量（CODEX_* / OPENAI_* 等）。

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const HOME = os.homedir();

const CODEX_ENV_NAMES = [
  "CODEX_HOME",
  "CODEX_API_KEY",
  "CODEX_BASE_URL",
  "CODEX_MODEL",
  "CODEX_RUNTIME",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "CODEX_STEPWISE_API_KEY",
  "CODEX_STEPWISE_BASE_URL",
];

// name → matching shell rc file patterns to scan
const RC_FILES = [".zshenv", ".zshrc", ".bashrc", ".bash_profile", ".profile"];

async function readRcFile(name) {
  const filePath = path.join(HOME, name);
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    return null;
  }
}

// Returns a map: name → [{ source, line }]
async function scanRcFiles() {
  const results = {};
  for (const rc of RC_FILES) {
    const text = await readRcFile(rc);
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    lines.forEach((line, idx) => {
      // match: export NAME=value  or  NAME=value
      const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) return;
      const [, name, rawValue] = m;
      if (!CODEX_ENV_NAMES.includes(name)) return;
      const value = rawValue.replace(/^['"]|['"]$/g, "").trim();
      if (!value) return; // empty value, skip
      if (!results[name]) results[name] = [];
      results[name].push({ source: path.join(HOME, rc), line: idx + 1, value });
    });
  }
  return results;
}

export async function checkEnvConflicts() {
  const conflicts = [];
  const rcMap = await scanRcFiles();
  for (const name of CODEX_ENV_NAMES) {
    const inProcess = !!process.env[name];
    const inRc = (rcMap[name] || []).length > 0;
    if (inProcess) {
      conflicts.push({ name, source: "process", valuePresent: true });
    } else if (inRc) {
      // 取第一个 rc 来源
      conflicts.push({
        name,
        source: "user",
        valuePresent: true,
        detail: rcMap[name][0].source,
      });
    }
  }
  return { conflicts };
}

// 简单"remove"：从 rc 文件里把那一行注释掉（# prefix）
export async function removeEnvConflicts(names) {
  const removed = [];
  for (const name of names) {
    for (const rc of RC_FILES) {
      const filePath = path.join(HOME, rc);
      let text;
      try {
        text = await fs.readFile(filePath, "utf8");
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      let changed = false;
      const newLines = lines.map((line) => {
        const m = line.match(/^(\s*)(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/);
        if (m && m[2] === name) {
          changed = true;
          removed.push({ name, source: filePath });
          return `${m[1]}# ${line.trim()}`;
        }
        return line;
      });
      if (changed) {
        await fs.writeFile(filePath, newLines.join("\n"), "utf8");
      }
    }
  }
  return { removed };
}
