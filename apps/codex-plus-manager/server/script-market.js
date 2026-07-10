// Script market：拉远程脚本索引 + 本地已安装脚本
// 对应 Rust crates/codex-plus-core/src/script_market.rs
//
// 远程索引：默认 https://raw.githubusercontent.com/BigPizzaV3/CodexPlusPlus-script-market/main/index.json
// 格式：{ scripts: [{ id, name, description, author, tags, url, size, updatedAt }] }

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { listUserScripts } from "./user-scripts.js";
import { settingsStore } from "./settings.js";

const HOME = os.homedir();
const DEFAULT_INDEX_URL =
  process.env.SCRIPT_MARKET_URL ||
  "https://raw.githubusercontent.com/BigPizzaV3/CodexPlusPlus-script-market/main/index.json";

async function readCachedIndex() {
  const cachePath = path.join(HOME, ".codex", ".script-market-cache.json");
  try {
    const text = await fs.readFile(cachePath, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeCachedIndex(data) {
  const cachePath = path.join(HOME, ".codex", ".script-market-cache.json");
  try {
    await fs.writeFile(cachePath, JSON.stringify(data, null, 2), "utf8");
  } catch {}
}

export async function refreshScriptMarket() {
  const userScripts = await listUserScripts();
  const installedIds = new Set(Object.keys(userScripts.installed));
  let scripts = [];
  let status = "ok";
  let message = "已加载本地缓存";
  let indexUrl = DEFAULT_INDEX_URL;
  let updatedAt = "";

  // 尝试拉远程
  try {
    const res = await fetch(DEFAULT_INDEX_URL, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      indexUrl = data.indexUrl || DEFAULT_INDEX_URL;
      updatedAt = data.updatedAt || new Date().toISOString();
      const remoteScripts = Array.isArray(data.scripts) ? data.scripts : [];
      scripts = remoteScripts.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description ?? "",
        author: s.author ?? "",
        tags: Array.isArray(s.tags) ? s.tags : [],
        url: s.url,
        size: s.size ?? 0,
        updatedAt: s.updatedAt ?? updatedAt,
        installed: installedIds.has(s.id),
        enabled: installedIds.has(s.id) ? userScripts.installed[s.id].enabled : false,
      }));
      await writeCachedIndex({ indexUrl, updatedAt, scripts: remoteScripts });
      message = `已从远程加载 ${scripts.length} 个脚本`;
    } else {
      const cached = await readCachedIndex();
      if (cached) {
        const remoteScripts = Array.isArray(cached.scripts) ? cached.scripts : [];
        indexUrl = cached.indexUrl || DEFAULT_INDEX_URL;
        updatedAt = cached.updatedAt || "";
        scripts = remoteScripts.map((s) => ({
          ...s,
          installed: installedIds.has(s.id),
          enabled: installedIds.has(s.id) ? userScripts.installed[s.id].enabled : false,
        }));
        status = "ok";
        message = `远程不可达 (HTTP ${res.status})，已用本地缓存`;
      } else {
        status = "failed";
        message = `远程不可达 (HTTP ${res.status})，无本地缓存`;
      }
    }
  } catch (err) {
    const cached = await readCachedIndex();
    if (cached) {
      const remoteScripts = Array.isArray(cached.scripts) ? cached.scripts : [];
      indexUrl = cached.indexUrl || DEFAULT_INDEX_URL;
      updatedAt = cached.updatedAt || "";
      scripts = remoteScripts.map((s) => ({
        ...s,
        installed: installedIds.has(s.id),
        enabled: installedIds.has(s.id) ? userScripts.installed[s.id].enabled : false,
      }));
      status = "ok";
      message = `远程不可达 (${err.message})，已用本地缓存`;
    } else {
      status = "failed";
      message = `远程不可达 (${err.message})，无本地缓存`;
    }
  }

  return {
    market: { status, message, indexUrl, updatedAt, scripts },
    user_scripts: userScripts,
  };
}

export async function installMarketScript(id) {
  const cached = await readCachedIndex();
  if (!cached) {
    return {
      status: "failed",
      message: "请先 refresh-script-market 拉取索引",
    };
  }
  const script = (cached.scripts || []).find((s) => s.id === id);
  if (!script || !script.url) {
    return { status: "failed", message: `找不到脚本：${id}` };
  }
  // 下载脚本内容
  let content;
  try {
    const res = await fetch(script.url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      return { status: "failed", message: `下载失败 (HTTP ${res.status})` };
    }
    content = await res.text();
  } catch (err) {
    return { status: "failed", message: `下载失败：${err.message}` };
  }
  // 写到 ~/.codex/scripts/<id>.js
  const scriptsDir = path.join(HOME, ".codex", "scripts");
  await fs.mkdir(scriptsDir, { recursive: true });
  const dest = path.join(scriptsDir, `${id}.js`);
  await fs.writeFile(dest, content, "utf8");
  // 刷新返回
  return await refreshScriptMarket();
}

export async function setUserScriptEnabled(key, enabled) {
  // 简单实现：写 settings.userScripts.installed[key].enabled
  const settings = await settingsStore.load();
  if (!settings.userScripts.installed[key]) {
    settings.userScripts.installed[key] = { enabled, path: "", source: "local" };
  } else {
    settings.userScripts.installed[key].enabled = enabled;
  }
  await settingsStore.save(settings);
  return { status: "ok", message: enabled ? `已启用 ${key}` : `已禁用 ${key}` };
}

export async function deleteUserScript(key) {
  // 从磁盘删 + 从 settings 删
  const settings = await settingsStore.load();
  const entry = settings.userScripts.installed[key];
  if (entry?.path) {
    try {
      await fs.unlink(entry.path);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
  delete settings.userScripts.installed[key];
  await settingsStore.save(settings);
  return { status: "ok", message: `已删除 ${key}` };
}
