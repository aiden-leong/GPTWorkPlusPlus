// Plugin marketplace 状态 + 修复
// 对应 Rust crates/codex-plus-core/src/plugin_marketplace.rs
//
// Codex 的插件市场配置存在 config.toml 的 [marketplaces] 段。
// status: 扫所有 marketplaces，找有 last_updated 的"激活"路径。

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CODEX_HOME } from "./settings.js";
import { CONFIG_PATH } from "./relay-config.js";
import * as toml from "smol-toml";

async function readConfigToml() {
  try {
    const text = await fs.readFile(CONFIG_PATH, "utf8");
    return { doc: toml.parse(text), text, error: null };
  } catch (err) {
    if (err.code === "ENOENT") return { doc: {}, text: "", error: null };
    return { doc: {}, text: "", error: err.message };
  }
}

async function listMarketplaces() {
  const { doc } = await readConfigToml();
  const marketplaces = doc?.marketplaces ?? {};
  const result = [];
  for (const [name, info] of Object.entries(marketplaces)) {
    if (!info || typeof info !== "object") continue;
    const source = info.source ?? "";
    const sourceType = info.source_type ?? "local";
    const lastUpdated = info.last_updated ?? null;
    let exists = false;
    if (source && sourceType === "local") {
      try {
        await fs.access(source);
        exists = true;
      } catch {}
    } else {
      exists = true; // remote — assume exists
    }
    result.push({ name, source, sourceType, lastUpdated, exists });
  }
  return result;
}

export async function pluginMarketplaceStatus() {
  const marketplaces = await listMarketplaces();
  const active = marketplaces.find((m) => m.exists) ?? null;
  return {
    status: active ? "ok" : "not_configured",
    message: active
      ? `激活市场：${active.name}`
      : "未检测到可用的 plugin marketplace",
    activePath: active?.source ?? null,
    availablePaths: marketplaces.filter((m) => m.exists).map((m) => m.source),
    canRepair: !active,
  };
}

export async function repairPluginMarketplace() {
  const marketplaces = await listMarketplaces();
  const available = marketplaces.filter((m) => m.exists);
  if (available.length === 0) {
    return {
      status: "failed",
      message: "没有可用的 plugin marketplace 路径",
      attemptedPaths: marketplaces.map((m) => m.source).filter(Boolean),
      usedPath: null,
    };
  }
  // "修复"：什么都不用做，本来就 ok
  return {
    status: "ok",
    message: "plugin marketplace 配置正常，无需修复",
    attemptedPaths: available.map((m) => m.source),
    usedPath: available[0].source,
  };
}

export async function remotePluginMarketplaceStatus() {
  // 远程 marketplace：扫描所有 source_type != "local" 的
  const marketplaces = await listMarketplaces();
  const remote = marketplaces.filter((m) => m.sourceType !== "local");
  const active = remote[0] ?? null;
  return {
    status: active ? "ok" : "not_configured",
    message: active
      ? `激活远程市场：${active.name}`
      : "未检测到远程 plugin marketplace",
    activePath: active?.source ?? null,
    availablePaths: remote.map((m) => m.source),
    canRepair: !active,
  };
}

export async function repairRemotePluginMarketplace() {
  const marketplaces = await listMarketplaces();
  const remote = marketplaces.filter((m) => m.sourceType !== "local");
  if (remote.length === 0) {
    return {
      status: "failed",
      message: "没有远程 plugin marketplace 可修复",
      activePath: null,
      availablePaths: [],
      canRepair: false,
    };
  }
  return {
    status: "ok",
    message: "远程 plugin marketplace 配置正常",
    activePath: remote[0].source,
    availablePaths: remote.map((m) => m.source),
    canRepair: false,
  };
}
