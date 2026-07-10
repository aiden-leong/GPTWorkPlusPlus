// Local sessions：从 Codex 的 state.sqlite 读会话列表
// 对应 Rust crates/codex-plus-core/src/codex_local_storage.rs
// 主要表：threads(id, title, cwd, model_provider, archived, updated_at, rollout_path, source_db)

import Database from "better-sqlite3";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const HOME = os.homedir();
const CODEX_HOME = path.join(HOME, ".codex");

// 候选 db 路径（user / system）
const CANDIDATE_DB_PATHS = [
  path.join(CODEX_HOME, "state.sqlite"),
];

async function findDbPaths() {
  const found = [];
  for (const p of CANDIDATE_DB_PATHS) {
    try {
      await fs.access(p);
      found.push(p);
    } catch {}
  }
  return found;
}

function openDbReadonly(p) {
  return new Database(p, { readonly: true, fileMustExist: true });
}

export async function listLocalSessions() {
  const dbPaths = await findDbPaths();
  if (dbPaths.length === 0) {
    return { dbPath: "", dbPaths: [], sessions: [] };
  }
  const sessions = [];
  for (const dbPath of dbPaths) {
    let db;
    try {
      db = openDbReadonly(dbPath);
    } catch (err) {
      continue;
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
    } catch (err) {
      // 表不存在 → 跳过
    } finally {
      try {
        db.close();
      } catch {}
    }
  }
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
