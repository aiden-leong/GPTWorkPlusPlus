#!/usr/bin/env node
// 构建 payload/ — 把 dist/ (管理工具 UI) + server/ (后端) 嵌入到 payload/manager/
// 运行时 Patcher.app 的 wrapper 会把 payload/manager/ 拷到 ChatGPT++.app/Contents/Resources/manager/

import { cp, rm, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PAYLOAD_MANAGER = path.join(ROOT, "payload", "manager");
const DIST = path.join(ROOT, "dist");
const SERVER = path.join(ROOT, "server");

console.log("[payload] building payload/manager/ ...");
console.log(`[payload] from: ${DIST}`);
console.log(`[payload]    + ${SERVER}`);
console.log(`[payload] to:   ${PAYLOAD_MANAGER}`);

if (!existsSync(DIST)) {
  console.error(`[payload] FAIL: dist/ not found. Run \`npm run build\` first.`);
  process.exit(1);
}

// 清空旧的 payload/manager/
await rm(PAYLOAD_MANAGER, { recursive: true, force: true });
await mkdir(PAYLOAD_MANAGER, { recursive: true });

// 1. 拷 dist/ -> payload/manager/dist/
console.log("[payload] copying dist/ ...");
await cp(DIST, path.join(PAYLOAD_MANAGER, "dist"), { recursive: true });

// 2. 拷 server/ -> payload/manager/server/ (含 node_modules)
//    排除 dev-only 依赖：electron / electron-builder / asar
//    这些不应该嵌到最终 .app（macOS Xprotect 报 nested rpath）
console.log("[payload] copying server/ ...");
const EXCLUDE_DIRS = new Set([
  ".cache",
  "electron",
  "electron-builder",
  "@electron",
  // native 工具不需要嵌（better-sqlite3 的 prebuilt binary 保留）
  "node-gyp",
  "node-pre-gyp",
  "prebuild-install",
  // 文档
  ".bin",
]);
await cp(SERVER, path.join(PAYLOAD_MANAGER, "server"), {
  recursive: true,
  filter: (src) => {
    const base = path.basename(src);
    if (EXCLUDE_DIRS.has(base)) return false;
    if (base === ".DS_Store") return false;
    if (base.endsWith(".map")) return false;
    if (base.endsWith(".d.ts")) return false;
    if (base.endsWith(".d.ts.map")) return false;
    return true;
  },
});

const size = await dirSize(PAYLOAD_MANAGER);
console.log(`[payload] DONE: ${PAYLOAD_MANAGER} (${(size / 1024 / 1024).toFixed(1)} MB)`);

async function dirSize(p) {
  let total = 0;
  const entries = await readdir(p, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(p, e.name);
    if (e.isDirectory()) total += await dirSize(s);
    else if (e.isFile()) {
      const st = await stat(s);
      total += st.size;
    }
  }
  return total;
}
