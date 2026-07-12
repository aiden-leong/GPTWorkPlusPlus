// CCS providers：扫 ~/.codex/ 下的 .ccs/ 或 providers/ 目录里的 .json 配置
// 对应 Rust crates/codex-plus-core/src/ccs_import.rs
//
// 第三方 provider 导入流程：用户从一个 URL 拉一个 .json（包含 provider 信息），
// 我们把它写进 ~/.codex/config.toml 的 [model_providers.<id>] 段。

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CODEX_HOME } from "./settings.js";
import { CONFIG_PATH } from "./relay-config.js";

const CCS_CANDIDATE_DIRS = [
  path.join(CODEX_HOME, ".ccs"),
  path.join(CODEX_HOME, "providers"),
  path.join(CODEX_HOME, "ccs-providers"),
];

async function findCcsDir() {
  for (const p of CCS_CANDIDATE_DIRS) {
    try {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) return p;
    } catch {}
  }
  return null;
}

export async function loadCcsProviders() {
  const dir = await findCcsDir();
  if (!dir) {
    return { dbPath: dir || "", providers: [] };
  }
  const providers = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const fullPath = path.join(dir, entry.name);
      try {
        const text = await fs.readFile(fullPath, "utf8");
        const data = JSON.parse(text);
        if (!data || typeof data !== "object") continue;
        providers.push({
          sourceId: data.id || entry.name.replace(/\.json$/, ""),
          name: data.name || data.id || entry.name,
          baseUrl: data.baseUrl || data.base_url || "",
          apiKey: data.apiKey || data.api_key || "",
          protocol: data.protocol || "responses",
          configContents: data.configContents || "",
          authContents: data.authContents || "",
        });
      } catch {}
    }
  } catch {}
  return { dbPath: dir, providers };
}

// 从 URL 拉 .json，然后存到 ccs 目录
export async function importCcsProviders() {
  // 没有现成的"待导入列表"，返回空。导入实际通过 confirmPendingProviderImport 完成。
  return { imported: 0, skipped: 0, message: "暂无待导入的 provider" };
}

// 待导入的 provider（前端在 confirm 之前会显示）
export function loadPendingProviderImport() {
  return { pending: null };
}

// 确认导入：把 provider 信息写到 config.toml [model_providers.<id>] 段
export async function confirmPendingProviderImport(request) {
  if (!request || !request.name) {
    return { status: "failed", message: "request.name 必填" };
  }
  const providerId = request.name.replace(/[^a-zA-Z0-9_-]/g, "_");
  let text = "";
  try {
    text = await fs.readFile(CONFIG_PATH, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  let doc = {};
  try {
    const { parse } = await import("smol-toml");
    doc = parse(text || "{}");
  } catch {}
  if (!doc.model_providers || typeof doc.model_providers !== "object") {
    doc.model_providers = {};
  }
  doc.model_providers[providerId] = {
    name: providerId,
    base_url: request.baseUrl || "",
    experimental_bearer_token: request.apiKey || "",
    requires_openai_auth: true,
    wire_api: request.wireApi === "chat" ? "chat" : undefined,
  };
  doc.model_provider = providerId;
  if (request.relayMode) {
    doc.model_providers[providerId].relay_mode = request.relayMode;
  }
  const { stringify } = await import("smol-toml");
  const updated = stringify(doc);
  // backup
  if (text) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(CODEX_HOME, "backups");
    await fs.mkdir(backupDir, { recursive: true });
    await fs.writeFile(
      path.join(backupDir, `config.${stamp}.toml.bak`),
      text,
      "utf8",
    );
  }
  // atomic write
  const tmp = `${CONFIG_PATH}.tmp`;
  await fs.writeFile(tmp, updated, "utf8");
  await fs.rename(tmp, CONFIG_PATH);
  return {
    status: "ok",
    message: `已导入 provider：${providerId}`,
    providerId,
  };
}

export function dismissPendingProviderImport() {
  return { status: "ok", message: "已忽略" };
}
