// 后端设置的数据模型 + 持久化
// 对应 Rust crates/codex-plus-core/src/settings.rs
//
// 字段以 camelCase 序列化（与前端 types.ts / Rust serde 一致）。
// load 找不到文件 → 返回 default；save 走 atomic write（写到 .tmp 再 rename）。

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const HOME = os.homedir();
export const CODEX_HOME = path.join(HOME, ".codex");
export const SETTINGS_PATH = path.join(CODEX_HOME, "codex-plus-settings.json");

// ============== 默认值 ==============

export const DEFAULT_STEPWISE_API_KEY_ENV = "CODEX_STEPWISE_API_KEY";
export const DEFAULT_STEPWISE_MAX_ITEMS = 6;
export const DEFAULT_STEPWISE_MAX_INPUT_CHARS = 6000;
export const DEFAULT_STEPWISE_MAX_OUTPUT_TOKENS = 500;
export const DEFAULT_STEPWISE_TIMEOUT_MS = 8000;
export const DEFAULT_IMAGE_OVERLAY_OPACITY = 35;
export const DEFAULT_IMAGE_OVERLAY_FIT_MODE = "fit";
export const DEFAULT_RELAY_BASE_URL = "";
export const DEFAULT_ACTIVE_RELAY_ID = "default";
export const DEFAULT_RELAY_TEST_MODEL = "gpt-5.4-mini";
export const DEFAULT_LAUNCH_MODE = "patch";

const VALID_FIT_MODES = new Set(["fill", "fit", "stretch", "tile", "center"]);
const VALID_LAUNCH_MODES = new Set(["patch", "relay"]);
const VALID_ZED_STRATEGIES = new Set([
  "addToFocusedWorkspace",
  "reuseWindow",
  "newWindow",
  "default",
]);

// ============== 默认 Relay Profile ==============

export function defaultRelayProfile() {
  return {
    id: DEFAULT_ACTIVE_RELAY_ID,
    name: "默认中转",
    model: "",
    baseUrl: DEFAULT_RELAY_BASE_URL,
    upstreamBaseUrl: "",
    apiKey: "",
    protocol: "responses",
    relayMode: "mixedApi",
    officialMixApiKey: false,
    testModel: "",
    configContents: "",
    authContents: "",
    useCommonConfig: true,
    contextSelection: { mcpServers: [], skills: [], plugins: [] },
    contextSelectionInitialized: false,
    contextWindow: "",
    autoCompactLimit: "",
    modelInsertMode: "patch",
    modelList: "",
    modelWindows: "",
    userAgent: "",
  };
}

// ============== 默认 BackendSettings ==============

export function defaultBackendSettings() {
  return {
    codexAppPath: "",
    codexAppPathStatus: "not_checked",
    codexExtraArgs: [],
    providerSyncEnabled: false,
    providerSyncSavedProviders: [],
    providerSyncManualProviders: [],
    providerSyncLastSelectedProvider: "",
    relayProfilesEnabled: true,
    enhancementsEnabled: true,
    computerUseGuardEnabled: false,
    codexAppPluginMarketplaceUnlock: true,
    codexAppPluginAutoExpand: true,
    codexAppModelWhitelistUnlock: true,
    codexAppSessionDelete: true,
    codexAppMarkdownExport: true,
    codexAppPasteFix: false,
    codexAppForceChineseLocale: true,
    codexAppFastStartup: false,
    codexAppProjectMove: true,
    codexAppThreadIdBadge: false,
    codexAppConversationView: false,
    codexAppThreadScrollRestore: true,
    codexAppZedRemoteOpen: true,
    zedRemoteOpenStrategy: "addToFocusedWorkspace",
    zedRemoteProjectRegistryEnabled: true,
    zedRemoteSyncToZedSettings: false,
    codexAppUpstreamWorktreeCreate: true,
    codexAppNativeMenuPlacement: true,
    codexAppNativeMenuLocalization: true,
    codexAppServiceTierControls: false,
    codexAppStepwiseEnabled: false,
    codexAppStepwiseDirectSend: false,
    codexAppStepwiseBaseUrl: "",
    codexAppStepwiseApiKey: "",
    codexAppStepwiseApiKeyEnv: DEFAULT_STEPWISE_API_KEY_ENV,
    codexAppStepwiseModel: "",
    codexAppStepwiseMaxItems: DEFAULT_STEPWISE_MAX_ITEMS,
    codexAppStepwiseMaxInputChars: DEFAULT_STEPWISE_MAX_INPUT_CHARS,
    codexAppStepwiseMaxOutputTokens: DEFAULT_STEPWISE_MAX_OUTPUT_TOKENS,
    codexAppStepwiseTimeoutMs: DEFAULT_STEPWISE_TIMEOUT_MS,
    codexAppImageOverlayEnabled: false,
    codexAppImageOverlayPath: "",
    codexAppImageOverlayOpacity: DEFAULT_IMAGE_OVERLAY_OPACITY,
    codexAppImageOverlayFitMode: DEFAULT_IMAGE_OVERLAY_FIT_MODE,
    codexGoalsEnabled: false,
    launchMode: DEFAULT_LAUNCH_MODE,
    relayBaseUrl: DEFAULT_RELAY_BASE_URL,
    relayApiKey: "",
    relayProfiles: [defaultRelayProfile()],
    relayCommonConfigContents: "",
    relayContextConfigContents: "",
    activeRelayId: DEFAULT_ACTIVE_RELAY_ID,
    aggregateRelayProfiles: [],
    activeAggregateRelayId: "",
    relayTestModel: DEFAULT_RELAY_TEST_MODEL,
    // 字段补全给前端
    cliWrapperEnabled: false,
    cliWrapperBaseUrl: "",
    cliWrapperApiKey: "",
    cliWrapperApiKeyEnv: "",
    cliWrapperModel: "",
    launchArgs: "",
    imageOverlay: { enabled: false, fit: "fit", opacity: 1 },
    activeRelayProfileId: null,
    relayContextSelection: { mcpServers: [], skills: [], plugins: [] },
    userScripts: { enabled: false, installed: {} },
  };
}

// ============== 规范化 ==============

function clampInt(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function clampImageOverlayOpacity(v) {
  return clampInt(v, 1, 100, DEFAULT_IMAGE_OVERLAY_OPACITY);
}

function normalizeImageOverlayFitMode(v) {
  return VALID_FIT_MODES.has(v) ? v : DEFAULT_IMAGE_OVERLAY_FIT_MODE;
}

function normalizeLaunchMode(v) {
  return VALID_LAUNCH_MODES.has(v) ? v : DEFAULT_LAUNCH_MODE;
}

function normalizeZedStrategy(v) {
  return VALID_ZED_STRATEGIES.has(v) ? v : "default";
}

function normalizeRelayProfile(p) {
  const base = defaultRelayProfile();
  if (!p || typeof p !== "object") return base;
  return {
    ...base,
    ...p,
    protocol: p.protocol === "chatCompletions" ? "chatCompletions" : "responses",
    relayMode: ["official", "mixedApi", "pureApi", "aggregate"].includes(p.relayMode)
      ? p.relayMode
      : base.relayMode,
    modelInsertMode: ["overwrite", "append", "patch"].includes(p.modelInsertMode)
      ? p.modelInsertMode
      : base.modelInsertMode,
    contextSelection: {
      mcpServers: Array.isArray(p.contextSelection?.mcpServers)
        ? p.contextSelection.mcpServers
        : [],
      skills: Array.isArray(p.contextSelection?.skills) ? p.contextSelection.skills : [],
      plugins: Array.isArray(p.contextSelection?.plugins) ? p.contextSelection.plugins : [],
    },
    useCommonConfig: p.useCommonConfig !== false,
  };
}

export function normalizeSettings(s) {
  const base = defaultBackendSettings();
  const merged = { ...base, ...s };
  merged.codexAppStepwiseMaxItems = clampInt(
    s?.codexAppStepwiseMaxItems,
    0,
    DEFAULT_STEPWISE_MAX_ITEMS,
    DEFAULT_STEPWISE_MAX_ITEMS,
  );
  merged.codexAppStepwiseMaxInputChars = clampInt(
    s?.codexAppStepwiseMaxInputChars,
    1000,
    24000,
    DEFAULT_STEPWISE_MAX_INPUT_CHARS,
  );
  merged.codexAppStepwiseMaxOutputTokens = clampInt(
    s?.codexAppStepwiseMaxOutputTokens,
    100,
    4000,
    DEFAULT_STEPWISE_MAX_OUTPUT_TOKENS,
  );
  merged.codexAppStepwiseTimeoutMs = clampInt(
    s?.codexAppStepwiseTimeoutMs,
    1000,
    60000,
    DEFAULT_STEPWISE_TIMEOUT_MS,
  );
  merged.codexAppImageOverlayOpacity = clampImageOverlayOpacity(s?.codexAppImageOverlayOpacity);
  merged.codexAppImageOverlayFitMode = normalizeImageOverlayFitMode(s?.codexAppImageOverlayFitMode);
  merged.codexAppStepwiseBaseUrl = (s?.codexAppStepwiseBaseUrl ?? "").trim().replace(/\/+$/, "");
  merged.codexAppStepwiseApiKey = (s?.codexAppStepwiseApiKey ?? "").trim();
  merged.codexAppStepwiseApiKeyEnv =
    (s?.codexAppStepwiseApiKeyEnv ?? "").trim() || DEFAULT_STEPWISE_API_KEY_ENV;
  merged.codexAppStepwiseModel = (s?.codexAppStepwiseModel ?? "").trim();
  merged.launchMode = normalizeLaunchMode(s?.launchMode);
  merged.zedRemoteOpenStrategy = normalizeZedStrategy(s?.zedRemoteOpenStrategy);
  merged.relayProfiles = Array.isArray(s?.relayProfiles)
    ? s.relayProfiles.map(normalizeRelayProfile)
    : [defaultRelayProfile()];
  if (typeof s?.relayTestModel === "string" && s.relayTestModel.trim()) {
    merged.relayTestModel = s.relayTestModel.trim();
  }
  return merged;
}

// ============== SettingsStore ==============

async function atomicWrite(filePath, bytes) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, filePath);
}

export class SettingsStore {
  constructor(filePath = SETTINGS_PATH) {
    this.path = filePath;
  }

  async load() {
    let raw;
    try {
      raw = await fs.readFile(this.path, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") return defaultBackendSettings();
      throw err;
    }
    try {
      const obj = JSON.parse(raw);
      return normalizeSettings(obj);
    } catch {
      return defaultBackendSettings();
    }
  }

  async save(settings) {
    const normalized = normalizeSettings(settings);
    const json = JSON.stringify(normalized, null, 2);
    await atomicWrite(this.path, json);
    return normalized;
  }

  async reset() {
    const def = defaultBackendSettings();
    await this.save(def);
    return def;
  }
}

export const settingsStore = new SettingsStore();
