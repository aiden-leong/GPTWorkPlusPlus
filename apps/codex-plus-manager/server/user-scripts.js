// User scripts：扫描 ~/.codex/scripts/ 下的 .js / .ts 文件
// 对应 Rust crates/codex-plus-core/src/user_scripts.rs

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CODEX_HOME } from "./settings.js";

const SCRIPTS_DIR_CANDIDATES = [
  path.join(CODEX_HOME, "scripts"),
  path.join(CODEX_HOME, "user-scripts"),
];

async function findScriptsDir() {
  for (const p of SCRIPTS_DIR_CANDIDATES) {
    try {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) return p;
    } catch {}
  }
  return null;
}

export async function listUserScripts() {
  const dir = await findScriptsDir();
  if (!dir) {
    return { enabled: false, installed: {} };
  }
  const installed = {};
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/\.(js|ts|mjs|cjs)$/.test(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const key = entry.name.replace(/\.(js|ts|mjs|cjs)$/, "");
      installed[key] = {
        enabled: true,
        path: fullPath,
        source: "local",
      };
    }
  } catch {}
  return { enabled: Object.keys(installed).length > 0, installed };
}
