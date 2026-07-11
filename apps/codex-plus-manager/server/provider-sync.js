// Provider sync：扫 config.toml / state.sqlite / archived_sessions/*.jsonl
// 找到所有可用 provider，给用户选一个作为目标。
//
// 对应 Rust crates/codex-plus-core/src/provider_sync.rs

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { EventEmitter } from "node:events";
import Database from "better-sqlite3";
import { CODEX_HOME } from "./settings.js";
import { CONFIG_PATH, AUTH_PATH } from "./relay-config.js";

const HOME = os.homedir();
const STATE_SQLITE = path.join(CODEX_HOME, "state.sqlite");
const ARCHIVED_DIR = path.join(CODEX_HOME, "archived_sessions");

// 全局 EventEmitter — 给 SSE endpoint 订阅用
// 单进程多客户端共享，简单够用
export const providerSyncEvents = new EventEmitter();
providerSyncEvents.setMaxListeners(50);

function emitProgress(stage, percent, message, result = null) {
  // emit shape 给 SSE：percent / message / result 三个字段对齐前端
  // ProviderSyncProgress；额外 stage + ts 给调试用。
  const progress = { stage, percent, message, result, ts: Date.now() };
  providerSyncEvents.emit("progress", progress);
  return progress;
}

async function readTomlOrEmpty(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const { parse } = await import("smol-toml");
    return parse(text);
  } catch {
    return {};
  }
}

function listConfigProviders(doc) {
  const out = [];
  const providers = doc?.model_providers ?? {};
  for (const [id, info] of Object.entries(providers)) {
    if (!info || typeof info !== "object") continue;
    out.push({
      id,
      label: info.name || id,
      baseUrl: info.base_url || "",
      hasBearer: !!(info.experimental_bearer_token && String(info.experimental_bearer_token).trim()),
      requiresAuth: !!info.requires_openai_auth,
    });
  }
  return out;
}

async function listSqliteProviders() {
  const out = [];
  try {
    const db = new Database(STATE_SQLITE, { readonly: true, fileMustExist: true });
    try {
      const stmt = db.prepare(
        "SELECT DISTINCT model_provider FROM threads WHERE model_provider IS NOT NULL AND model_provider != ''"
      );
      const rows = stmt.all();
      for (const r of rows) {
        out.push(r.model_provider);
      }
    } catch {} finally {
      try { db.close(); } catch {}
    }
  } catch {}
  return out;
}

async function listRolloutProviders() {
  const out = new Set();
  async function scan(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scan(full);
        } else if (entry.name.endsWith(".jsonl")) {
          try {
            const text = await fs.readFile(full, "utf8");
            // jsonl 里每行可能有 "model_provider" 字段
            for (const line of text.split("\n").slice(0, 50)) {
              try {
                const obj = JSON.parse(line);
                if (typeof obj?.model_provider === "string" && obj.model_provider) {
                  out.add(obj.model_provider);
                }
                if (typeof obj?.provider === "string" && obj.provider) {
                  out.add(obj.provider);
                }
              } catch {}
            }
          } catch {}
        }
      }
    } catch {}
  }
  await scan(ARCHIVED_DIR);
  return [...out];
}

export async function loadProviderSyncTargets() {
  const doc = await readTomlOrEmpty(CONFIG_PATH);
  const configProviders = listConfigProviders(doc);
  const sqliteProviders = await listSqliteProviders();
  const rolloutProviders = await listRolloutProviders();
  const targets = [];

  // 来源 1: config.toml
  for (const p of configProviders) {
    targets.push({
      id: `config:${p.id}`,
      label: `[config.toml] ${p.label}`,
      source: "config",
      detail: `baseUrl=${p.baseUrl || "(空)"}`,
      recommended: p.id === "codex-plus-relay" || p.hasBearer,
      available: true,
    });
  }
  // 来源 2: sqlite
  for (const id of sqliteProviders) {
    if (configProviders.find((p) => p.id === id)) continue;
    targets.push({
      id: `sqlite:${id}`,
      label: `[sqlite] ${id}`,
      source: "sqlite",
      detail: "来自会话历史",
      recommended: false,
      available: false,
    });
  }
  // 来源 3: rollout
  for (const id of rolloutProviders) {
    if (configProviders.find((p) => p.id === id)) continue;
    if (sqliteProviders.includes(id)) continue;
    targets.push({
      id: `rollout:${id}`,
      label: `[rollout] ${id}`,
      source: "rollout",
      detail: "来自归档会话文件",
      recommended: false,
      available: false,
    });
  }

  const recommended =
    targets.find((t) => t.id === "config:codex-plus-relay")?.id ||
    targets.find((t) => t.recommended)?.id ||
    targets[0]?.id ||
    "";

  return {
    configPath: CONFIG_PATH,
    authPath: AUTH_PATH,
    recommendedTargetId: recommended,
    targets,
  };
}

export async function syncProvidersNow(targetProvider, options = {}) {
  // targetProvider 形如 "config:codex-plus-relay"
  // 把这个 provider 的 baseUrl + bearer 写到 config.toml（如果来自 config），
  // 并写 auth.json
  //
  // options.emit: 可选 callback，参数 (stage, percent, message)，
  // 同步时供 SSE 订阅者接收进度
  const { emit } = options;
  const broadcast = (stage, percent, message) => {
    if (emit) emit(stage, percent, message);
    emitProgress(stage, percent, message);
  };

  if (!targetProvider || !targetProvider.startsWith("config:")) {
    return { status: "failed", message: "目前只支持 config 来源的 provider" };
  }
  const providerId = targetProvider.slice("config:".length);
  broadcast("reading", 10, `读取 config.toml (provider=${providerId})`);
  const doc = await readTomlOrEmpty(CONFIG_PATH);
  const provider = doc?.model_providers?.[providerId];
  if (!provider) {
    return { status: "failed", message: `provider 不存在：${providerId}` };
  }
  const baseUrl = provider.base_url || "";
  const apiKey = provider.experimental_bearer_token || "";
  broadcast("writing-auth", 40, "写 auth.json");
  const authPayload = JSON.stringify({ OPENAI_API_KEY: apiKey }, null, 2);
  const tmp = `${AUTH_PATH}.tmp`;
  await fs.mkdir(path.dirname(AUTH_PATH), { recursive: true });
  await fs.writeFile(tmp, authPayload, "utf8");
  await fs.rename(tmp, AUTH_PATH);
  broadcast("writing-config", 70, "写 config.toml");
  doc.model_provider = providerId;
  if (!doc.model_providers[providerId].name) {
    doc.model_providers[providerId].name = providerId;
  }
  const { stringify } = await import("smol-toml");
  const updated = stringify(doc);
  const tmp2 = `${CONFIG_PATH}.tmp`;
  await fs.writeFile(tmp2, updated, "utf8");
  await fs.rename(tmp2, CONFIG_PATH);
  const result = {
    status: "ok",
    message: `已同步到 ${providerId}`,
    payload: {
      changedSessionFiles: 0,
      sqliteRowsUpdated: 0,
      skippedLockedRolloutFiles: [],
      targetProvider: providerId,
      configWritten: true,
      authWritten: true,
    },
  };
  broadcast("done", 100, result.message);
  return result;
}
