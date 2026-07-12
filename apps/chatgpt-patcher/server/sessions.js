// Local sessions：从 Codex 的 state.sqlite 读会话列表
// 对应 Rust crates/codex-plus-core/src/codex_local_storage.rs
// 主要表：threads(id, title, cwd, model_provider, archived, updated_at, rollout_path, source_db)
//
// Codex CLI 实际生成 state_<n>.sqlite 数字后缀的 db（按使用顺序递增），
// 老的 state.sqlite 可能是空的。candidate 顺序：带后缀的优先 + state.sqlite 兜底。

import Database from "better-sqlite3";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const HOME = os.homedir();
const CODEX_HOME = path.join(HOME, ".codex");

const STATE_PREFIX = "state_";
const STATE_SUFFIX = ".sqlite";
const LEGACY_STATE = "state.sqlite";

async function findDbPaths() {
  // 扫 ~/.codex 下所有 state_*.sqlite + legacy state.sqlite
  const found = [];
  try {
    const entries = await fs.readdir(CODEX_HOME);
    // 收集带后缀的（按数字倒序 — 最大的最新）
    const suffixed = entries
      .filter((e) => e.startsWith(STATE_PREFIX) && e.endsWith(STATE_SUFFIX))
      .map((e) => path.join(CODEX_HOME, e))
      .sort()
      .reverse();
    for (const p of suffixed) {
      try {
        await fs.access(p);
        found.push(p);
      } catch {}
    }
    // legacy 兜底（如果存在）
    const legacy = path.join(CODEX_HOME, LEGACY_STATE);
    if (!found.includes(legacy)) {
      try {
        await fs.access(legacy);
        found.push(legacy);
      } catch {}
    }
  } catch {}
  return found;
}

function openDbReadonly(p) {
  return new Database(p, { readonly: true, fileMustExist: true });
}

async function readThreadsFromDb(dbPath) {
  const sessions = [];
  let db;
  try {
    db = openDbReadonly(dbPath);
  } catch {
    return sessions;
  }
  try {
    const stmt = db.prepare(`
      SELECT id, title, cwd, model_provider, archived,
             updated_at, rollout_path
      FROM threads
      ORDER BY updated_at DESC
      LIMIT 500
    `);
    const rows = stmt.all();
    for (const row of rows) {
      sessions.push({
        id: row.id,
        title: row.title ?? "",
        cwd: row.cwd ?? "",
        modelProvider: row.model_provider ?? "",
        archived: !!row.archived,
        updatedAtMs: row.updated_at ?? null,
        rolloutPath: row.rollout_path ?? "",
        dbPath,
      });
    }
  } catch {
    // 表不存在 → 跳过
  } finally {
    try { db.close(); } catch {}
  }
  return sessions;
}

export async function listLocalSessions() {
  const dbPaths = await findDbPaths();
  if (dbPaths.length === 0) {
    return { dbPath: "", dbPaths: [], sessions: [] };
  }
  let sessions = [];
  for (const dbPath of dbPaths) {
    const fromDb = await readThreadsFromDb(dbPath);
    sessions = sessions.concat(fromDb);
  }
  // 按 updatedAtMs 降序，最大 500
  sessions.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
  sessions = sessions.slice(0, 500);
  return {
    dbPath: dbPaths[0] ?? "",
    dbPaths,
    sessions,
  };
}

export async function deleteLocalSession({ sessionId, dbPath }) {
  if (!dbPath) {
    throw new Error("dbPath is required");
  }
  const db = new Database(dbPath);
  try {
    const stmt = db.prepare("DELETE FROM threads WHERE id = ?");
    const info = stmt.run(sessionId);
    return {
      status: info.changes > 0 ? "ok" : "not_found",
      session_id: sessionId,
      message: info.changes > 0 ? "已删除" : "未找到",
      undo_token: null,
      backup_path: null,
    };
  } finally {
    db.close();
  }
}
