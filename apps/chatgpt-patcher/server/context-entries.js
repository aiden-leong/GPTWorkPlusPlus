// Relay context entries：mcp_servers / skills / plugins 三类
// 对应 Rust crates/codex-plus-core/src/relay_config.rs 的
// list_context_entries_from_common_config + upsert/delete/sync
//
// 读 ~/.codex/config.toml，列出 [mcp_servers] / [skills] / [plugins] 下的 entry
// 每个 entry 含 id / kind / title / summary / tomlBody / enabled
// 写回时也用 toml_edit 风格的精确 patch（这里用 smol-toml stringify 整体重写，
// 因为我们的 entry 数量小，丢失 inline 注释也可接受）

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse, stringify } from "smol-toml";
import { CODEX_HOME } from "./settings.js";

const CONFIG_PATH = path.join(CODEX_HOME, "config.toml");

const KIND_TABLE = {
  mcpServer: "mcp_servers",
  skill: "skills",
  plugin: "plugins",
};

function kindFromTable(tableName) {
  if (tableName === "mcp_servers") return "mcpServer";
  if (tableName === "skills") return "skill";
  if (tableName === "plugins") return "plugin";
  return tableName;
}

function tableForKind(kind) {
  return KIND_TABLE[kind] || kind;
}

async function readConfigOrEmpty() {
  try {
    const text = await fs.readFile(CONFIG_PATH, "utf8");
    return parse(text);
  } catch {
    return {};
  }
}

function buildSummary(item) {
  if (!item || typeof item !== "object") return "";
  // 找第一个 string 字段做 summary
  for (const key of ["description", "name", "command", "label", "title"]) {
    const v = item[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  // 或者 args[0]
  if (Array.isArray(item.args) && item.args.length > 0) {
    return String(item.args[0]);
  }
  return "";
}

function buildTitle(id, item) {
  if (item && typeof item === "object" && typeof item.name === "string" && item.name.trim()) {
    return item.name.trim();
  }
  return id;
}

function entryEnabled(item) {
  // 缺省 enabled = true（很多 mcp_servers 不显式写 enabled）
  if (!item || typeof item !== "object") return true;
  if (item.enabled === undefined || item.enabled === null) return true;
  return Boolean(item.enabled);
}

function entryToTomlBody(item) {
  // 把内联 table 转回 TOML 文本
  return stringify({ inner: item }).replace(/^\[inner\]\n/, "");
}

function itemToEntry(tableName, id, item) {
  return {
    id,
    kind: kindFromTable(tableName),
    title: buildTitle(id, item),
    summary: buildSummary(item),
    tomlBody: entryToTomlBody(item),
    enabled: entryEnabled(item),
  };
}

function readTableEntries(doc, tableName) {
  const table = doc?.[tableName];
  if (!table || typeof table !== "object") return [];
  return Object.entries(table)
    .filter(([, item]) => item && typeof item === "object" && !Array.isArray(item))
    .map(([id, item]) => itemToEntry(tableName, id, item));
}

// ====== Public API ======

export async function listContextEntries() {
  const doc = await readConfigOrEmpty();
  return {
    mcpServers: readTableEntries(doc, "mcp_servers"),
    skills: readTableEntries(doc, "skills"),
    plugins: readTableEntries(doc, "plugins"),
  };
}

export async function readLiveContextEntries() {
  // 现阶段 live = 静态 config.toml 读（Codex 运行时状态在 Electron 里，
  // Node 端无法直接访问；这里返回的是磁盘最新内容）
  return listContextEntries();
}

export async function upsertContextEntry({ kind, name, entry }) {
  if (!name || typeof name !== "string" || !name.trim()) {
    return { status: "failed", message: "entry name 不能为空" };
  }
  const tableName = tableForKind(kind);
  if (!tableName) {
    return { status: "failed", message: `未知 kind：${kind}` };
  }
  let body = entry?.tomlBody ?? "";
  let parsedInner;
  try {
    parsedInner = body.trim() ? parse(body) : {};
  } catch (err) {
    return { status: "failed", message: `tomlBody 不是合法 TOML：${err.message}` };
  }

  const doc = await readConfigOrEmpty();
  if (!doc[tableName] || typeof doc[tableName] !== "object") {
    doc[tableName] = {};
  }
  doc[tableName][name] = parsedInner;

  try {
    const text = stringify(doc);
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    const tmp = `${CONFIG_PATH}.tmp`;
    await fs.writeFile(tmp, text, "utf8");
    await fs.rename(tmp, CONFIG_PATH);
  } catch (err) {
    return { status: "failed", message: `写 config.toml 失败：${err.message}` };
  }
  return { status: "ok", message: `已写入 ${tableName}.${name}` };
}

export async function deleteContextEntry({ kind, name }) {
  if (!name || typeof name !== "string" || !name.trim()) {
    return { status: "failed", message: "entry name 不能为空" };
  }
  const tableName = tableForKind(kind);
  if (!tableName) {
    return { status: "failed", message: `未知 kind：${kind}` };
  }
  const doc = await readConfigOrEmpty();
  if (doc[tableName]?.[name] !== undefined) {
    delete doc[tableName][name];
    if (Object.keys(doc[tableName]).length === 0) {
      delete doc[tableName];
    }
  } else {
    return { status: "failed", message: `${tableName}.${name} 不存在` };
  }
  try {
    const text = stringify(doc);
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    const tmp = `${CONFIG_PATH}.tmp`;
    await fs.writeFile(tmp, text, "utf8");
    await fs.rename(tmp, CONFIG_PATH);
  } catch (err) {
    return { status: "failed", message: `写 config.toml 失败：${err.message}` };
  }
  return { status: "ok", message: `已删除 ${tableName}.${name}` };
}

export async function syncLiveContextEntries() {
  // 真同步 = 把 config.toml 的 mcp/skill/plugin 重新读一遍回前端
  // 现阶段不区分 live vs settings（Node 端没有 Codex runtime CDP）
  const entries = await listContextEntries();
  return { status: "ok", message: "已重新读取", entries };
}
