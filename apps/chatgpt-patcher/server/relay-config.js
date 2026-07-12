// 供应商（relay）配置：读 ~/.codex/auth.json + config.toml，
// 计算 RelayStatus / RelayFilesPayload。
// 对应 Rust crates/codex-plus-core/src/relay_config.rs 的
// default_relay_status / relay_status_from_home / chatgpt_auth_status_from_home
// / relay_config_status_from_home / read_relay_files。

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CODEX_HOME } from "./settings.js";
import * as toml from "smol-toml";

export const CONFIG_PATH = path.join(CODEX_HOME, "config.toml");
export const AUTH_PATH = path.join(CODEX_HOME, "auth.json");

// ============== TOML helpers ==============

function getDottedValue(obj, dotted) {
  const parts = dotted.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function unquoteTomlString(value) {
  if (typeof value !== "string") return "";
  const v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

// ============== auth.json ==============

function chatgptAuthStatus(authPath) {
  // Returns { authenticated, accountLabel, source }
  let contents;
  try {
    contents = require("node:fs").readFileSync(authPath, "utf8");
  } catch {
    return { authenticated: false, accountLabel: null, source: "" };
  }
  let value;
  try {
    value = JSON.parse(contents);
  } catch {
    return { authenticated: false, accountLabel: null, source: "" };
  }
  const authMode = String(value?.auth_mode ?? "").toLowerCase();
  const tokens = value?.tokens;
  const isChatgpt = authMode === "chatgpt";
  if (!isChatgpt || !tokens || typeof tokens !== "object") {
    return { authenticated: false, accountLabel: null, source: "" };
  }
  // check for any non-empty token
  const hasToken = ["access_token", "id_token", "refresh_token"].some(
    (k) => typeof tokens?.[k] === "string" && tokens[k].trim() !== "",
  );
  if (!hasToken) {
    return { authenticated: false, accountLabel: null, source: "" };
  }
  // try to extract email from JWT
  const label = extractEmailFromJwt(tokens.id_token) || extractEmailFromJwt(tokens.access_token);
  return {
    authenticated: true,
    accountLabel: label,
    source: authPath,
  };
}

function extractEmailFromJwt(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1];
  // base64url decode
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  let decoded;
  try {
    decoded = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return null;
  }
  try {
    const obj = JSON.parse(decoded);
    return (
      obj?.email ||
      obj?.["https://api.openai.com/profile"]?.email ||
      obj?.preferred_username ||
      null
    );
  } catch {
    return null;
  }
}

// ============== config.toml ==============

async function readTomlOrEmpty(configPath) {
  try {
    const text = await fs.readFile(configPath, "utf8");
    return toml.parse(text);
  } catch (err) {
    if (err.code === "ENOENT") return {};
    return {};
  }
}

function codexAuthApiKey(authContents) {
  try {
    const obj = JSON.parse(authContents);
    const k = obj?.OPENAI_API_KEY;
    return typeof k === "string" && k.trim() ? k.trim() : null;
  } catch {
    return null;
  }
}

function relayConfigStatus(tomlObj, configPath, authContents) {
  const rootProvider = tomlObj?.model_provider;
  const providerValues =
    typeof rootProvider === "string"
      ? getDottedValue(tomlObj, `model_providers.${rootProvider}`)
      : undefined;
  const requiresOpenaiAuth =
    providerValues?.requires_openai_auth === true || String(providerValues?.requires_openai_auth) === "true";
  const hasBearerToken =
    typeof providerValues?.experimental_bearer_token === "string" &&
    providerValues.experimental_bearer_token.trim() !== "";
  const hasBaseUrl =
    typeof providerValues?.base_url === "string" &&
    unquoteTomlString(providerValues.base_url).trim() !== "";
  const authKey = codexAuthApiKey(authContents);
  return {
    configured:
      typeof rootProvider === "string" &&
      rootProvider.length > 0 &&
      requiresOpenaiAuth &&
      (hasBearerToken || authKey != null) &&
      hasBaseUrl,
    requiresOpenaiAuth,
    hasBearerToken,
    configPath,
  };
}

// ============== Public API ==============

export async function relayStatus(home = CODEX_HOME) {
  const configPath = path.join(home, "config.toml");
  const authPath = path.join(home, "auth.json");
  const auth = chatgptAuthStatus(authPath);
  const tomlObj = await readTomlOrEmpty(configPath);
  let authContents = "";
  try {
    authContents = await fs.readFile(authPath, "utf8");
  } catch {}
  const config = relayConfigStatus(tomlObj, configPath, authContents);
  return {
    authenticated: auth.authenticated,
    authSource: auth.source,
    accountLabel: auth.accountLabel,
    configPath: config.configPath,
    configured: config.configured,
    requiresOpenaiAuth: config.requiresOpenaiAuth,
    hasBearerToken: config.hasBearerToken,
    backupPath: null,
  };
}

export async function readRelayFiles(home = CODEX_HOME) {
  const configPath = path.join(home, "config.toml");
  const authPath = path.join(home, "auth.json");
  let configContents = "";
  let authContents = "";
  try {
    configContents = await fs.readFile(configPath, "utf8");
  } catch {}
  try {
    authContents = await fs.readFile(authPath, "utf8");
  } catch {}
  return {
    configPath,
    authPath,
    configContents,
    authContents,
  };
}

export async function saveRelayFile(kind, contents, home = CODEX_HOME) {
  const filePath = kind === "auth" ? path.join(home, "auth.json") : path.join(home, "config.toml");
  // 如果是 config.toml，验证 TOML 合法性
  if (kind === "config") {
    try {
      toml.parse(contents);
    } catch (err) {
      throw new Error(`config.toml 解析失败：${err.message}`);
    }
  }
  // 备份旧文件
  let backupPath = null;
  try {
    const old = await fs.readFile(filePath, "utf8");
    if (old) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const dir = path.join(home, "backups");
      await fs.mkdir(dir, { recursive: true });
      const ext = path.extname(filePath).slice(1) || "txt";
      backupPath = path.join(dir, `${path.basename(filePath, path.extname(filePath))}.${stamp}.${ext}.bak`);
      await fs.writeFile(backupPath, old, "utf8");
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  // atomic write
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, contents, "utf8");
  await fs.rename(tmp, filePath);
  return await readRelayFiles(home);
}
