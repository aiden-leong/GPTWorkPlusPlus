// Relay injection：把当前 active relay profile 的 baseUrl + apiKey
// 写到 ~/.codex/config.toml 和 ~/.codex/auth.json。
// 对应 Rust apply_relay_config_to_home / apply_pure_api_config_to_home / clear_relay_config。

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as toml from "smol-toml";
import { CODEX_HOME } from "./settings.js";
import { CONFIG_PATH, AUTH_PATH, readRelayFiles } from "./relay-config.js";

const PROVIDER_ID = "codex-plus-relay";

async function atomicWrite(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, contents, "utf8");
  await fs.rename(tmp, filePath);
}

async function backupFile(filePath) {
  let old = "";
  try {
    old = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  if (!old) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(CODEX_HOME, "backups");
  await fs.mkdir(dir, { recursive: true });
  const base = path.basename(filePath, path.extname(filePath));
  const ext = path.extname(filePath).slice(1) || "txt";
  const backupPath = path.join(dir, `${base}.${stamp}.${ext}.bak`);
  await fs.writeFile(backupPath, old, "utf8");
  return backupPath;
}

function readTomlOrEmpty(text) {
  try {
    return { doc: toml.parse(text || "{}"), error: null };
  } catch (err) {
    return { doc: {}, error: err.message };
  }
}

// 写 model_provider 段 + [model_providers.<id>] 段
async function writeProviderConfig({ baseUrl, apiKey, protocol }) {
  let text = "";
  try {
    text = await fs.readFile(CONFIG_PATH, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const { doc, error } = readTomlOrEmpty(text);
  if (error) {
    // 解析失败时 fallback：把整个 config.toml 替换为最小可用版
    const minimal = [
      `model_provider = "${PROVIDER_ID}"`,
      ``,
      `[model_providers.${PROVIDER_ID}]`,
      `base_url = "${baseUrl}"`,
      `experimental_bearer_token = "${apiKey}"`,
      `requires_openai_auth = true`,
      ``,
    ].join("\n");
    const backupPath = await backupFile(CONFIG_PATH);
    await atomicWrite(CONFIG_PATH, minimal);
    return { backupPath, error };
  }
  doc.model_provider = PROVIDER_ID;
  if (!doc.model_providers || typeof doc.model_providers !== "object") {
    doc.model_providers = {};
  }
  const provider = {
    name: PROVIDER_ID,
    base_url: baseUrl,
    experimental_bearer_token: apiKey,
    requires_openai_auth: true,
  };
  if (protocol === "chatCompletions") {
    provider.wire_api = "chat";
  }
  doc.model_providers[PROVIDER_ID] = provider;
  // smol-toml 输出
  const updated = toml.stringify(doc);
  const backupPath = await backupFile(CONFIG_PATH);
  await atomicWrite(CONFIG_PATH, updated);
  return { backupPath, error: null };
}

async function writeAuthJson(apiKey) {
  const payload = JSON.stringify({ OPENAI_API_KEY: apiKey }, null, 2);
  const backupPath = await backupFile(AUTH_PATH);
  await atomicWrite(AUTH_PATH, payload);
  return backupPath;
}

// 注入：active profile → config.toml + auth.json
export async function applyRelayInjection(activeProfile) {
  if (!activeProfile) {
    return { status: "failed", message: "没有激活的 relay profile" };
  }
  const baseUrl = (activeProfile.baseUrl || activeProfile.upstreamBaseUrl || "").trim();
  const apiKey = (activeProfile.apiKey || "").trim();
  if (!baseUrl) {
    return { status: "failed", message: "中转 Base URL 为空" };
  }
  if (!apiKey) {
    return { status: "failed", message: "中转 Key 为空" };
  }
  try {
    const { backupPath, error } = await writeProviderConfig({
      baseUrl,
      apiKey,
      protocol: activeProfile.protocol,
    });
    await writeAuthJson(apiKey);
    if (error) {
      return {
        status: "ok",
        message: `已写入最小 config.toml（原文件 TOML 解析失败：${error}）`,
        backupPath,
      };
    }
    return {
      status: "ok",
      message: `已应用：${PROVIDER_ID}（baseUrl=${baseUrl}）`,
      backupPath,
    };
  } catch (err) {
    return { status: "failed", message: err.message };
  }
}

// Pure API 模式：和 relay 类似，但 auth.json 写成纯 OPENAI_API_KEY
// 在我们的实现里和 relay 没区别（都写 OPENAI_API_KEY）
export async function applyPureApiInjection(activeProfile) {
  return applyRelayInjection(activeProfile);
}

// 清除：把 model_provider 字段从 config.toml 删除，
// [model_providers.codex-plus-relay] 段也删，auth.json 留空 {}
export async function clearRelayInjection() {
  let text = "";
  try {
    text = await fs.readFile(CONFIG_PATH, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      // 没有 config.toml，也清掉 auth.json
      await writeAuthJson("");
      return { status: "ok", message: "已清除（config.toml 不存在）" };
    }
    throw err;
  }
  const { doc, error } = readTomlOrEmpty(text);
  if (!error && typeof doc === "object") {
    delete doc.model_provider;
    if (doc.model_providers && typeof doc.model_providers === "object") {
      delete doc.model_providers[PROVIDER_ID];
      if (Object.keys(doc.model_providers).length === 0) {
        delete doc.model_providers;
      }
    }
    const updated = toml.stringify(doc);
    const backupPath = await backupFile(CONFIG_PATH);
    await atomicWrite(CONFIG_PATH, updated);
    await writeAuthJson("");
    return { status: "ok", message: "已清除 relay 注入", backupPath };
  }
  // 解析失败：不碰 config.toml，只清 auth.json
  await writeAuthJson("");
  return { status: "ok", message: `config.toml 解析失败 (${error})，已清空 auth.json` };
}
