// 业务 handlers — Node 实现
//
// 每个 handler 接收一个 args 对象（即除了 path 之外的全部请求体字段），
// 返回一个 CommandResult 形态的 JSON：
//   { status: "ok" | "failed", message: "...", ...payload }
//
// 阶段 1：所有 handler 都是 stub，返回与 Rust 版一致的数据 shape，
// 但不做实际 IO。阶段 2 会逐端点替换为真实逻辑。

import * as path from "node:path";
import * as os from "node:os";

const HOME = os.homedir();
const CODEX_HOME = path.join(HOME, ".codex");

// ====== 工具 ======

function ok(payload = {}, message = "ok") {
  return { status: "ok", message, ...payload };
}

function failed(message, payload = {}) {
  return { status: "failed", message, ...payload };
}

function notImplemented(name) {
  return failed(`Node 端 stub：${name}（阶段 2 实现）`);
}

// ====== 默认数据 ======

function defaultSettings() {
  return {
    codexAppPath: "",
    codexAppPathStatus: "not_checked",
    codexGoalsEnabled: false,
    providerSyncEnabled: false,
    cliWrapperEnabled: false,
    cliWrapperBaseUrl: "",
    cliWrapperApiKey: "",
    cliWrapperApiKeyEnv: "",
    cliWrapperModel: "",
    codexAppPasteFix: true,
    codexAppStepwiseEnabled: false,
    codexAppForceChineseLocale: true,
    codexAppFastStartup: false,
    codexAppNativeMenuLocalization: true,
    codexAppImageOverlayEnabled: false,
    codexAppComputerUseGuard: true,
    zedRemoteOpenStrategy: "default",
    launchArgs: "",
    launchMode: "patch",
    imageOverlay: { enabled: false, fit: "fit", opacity: 1 },
    relayProfiles: [],
    relayProfilesEnabled: false,
    activeRelayProfileId: null,
    relayContextSelection: { mcpServers: [], skills: [], plugins: [] },
    userScripts: { enabled: false, installed: {} },
  };
}

function defaultOverview() {
  return {
    codex_app: { status: "not_checked", path: null },
    codex_version: null,
    silent_shortcut: { status: "not_checked", path: null },
    management_shortcut: { status: "not_checked", path: null },
    latest_launch: null,
    current_version: "0.0.0-node",
    settings_path: path.join(CODEX_HOME, "codex-plus-settings.json"),
    logs_path: path.join(CODEX_HOME, "logs", "codex-plus.log"),
  };
}

function defaultRelayStatus() {
  return {
    authenticated: false,
    authSource: "none",
    accountLabel: null,
    configPath: path.join(CODEX_HOME, "config.toml"),
    configured: false,
    requiresOpenaiAuth: true,
    hasBearerToken: false,
    backupPath: null,
  };
}

// ====== Handlers ======

const h = {
  // ====== 系统信息 ======

  "/manager/backend-version": () => ok({ version: "0.0.0-node", gitHash: "" }),
  "/manager/startup-options": () =>
    ok({ debugPort: 9229, helperPort: 57321, defaultLogLines: 200 }),

  // ====== Overview ======

  "/manager/load-overview": () => ok(defaultOverview()),
  "/manager/launch-codex-plus": () => notImplemented("launch-codex-plus"),
  "/manager/restart-codex-plus": () => notImplemented("restart-codex-plus"),

  // ====== Settings ======

  "/manager/load-settings": () =>
    ok({ settings: defaultSettings(), settingsPath: path.join(CODEX_HOME, "codex-plus-settings.json") }),
  "/manager/save-settings": (args) => {
    const settings = args.settings ?? defaultSettings();
    return ok({ settings, settingsPath: path.join(CODEX_HOME, "codex-plus-settings.json") });
  },
  "/manager/reset-settings": () =>
    ok({ settings: defaultSettings(), settingsPath: path.join(CODEX_HOME, "codex-plus-settings.json") }),
  "/manager/reset-image-overlay-settings": () => {
    const s = defaultSettings();
    return ok({ settings: s, settingsPath: path.join(CODEX_HOME, "codex-plus-settings.json") });
  },

  // ====== CCS Provider Import ======

  "/manager/load-ccs-providers": () =>
    ok({ dbPath: "", providers: [] }),
  "/manager/import-ccs-providers": () => ok({ imported: 0, skipped: 0 }),
  "/manager/load-pending-provider-import": () => ok({ pending: null }),
  "/manager/confirm-pending-provider-import": () => ok({}),
  "/manager/dismiss-pending-provider-import": () => ok({}),

  // ====== Local Sessions ======

  "/sessions/list": () => ok({ dbPath: "", dbPaths: [], sessions: [] }),
  "/sessions/delete": () =>
    ok({ status: "ok", session_id: "", message: "stub", undo_token: null, backup_path: null }),

  // ====== Zed Remote ======

  "/zed-remote/projects": () => ok({ projects: [] }),
  "/zed-remote/open": () => ok({ url: "", strategy: "default" }),
  "/zed-remote/forget-project": () => ok({}),

  // ====== Provider Sync ======

  "/provider-sync/targets": () =>
    ok({
      configPath: "",
      authPath: "",
      recommendedTargetId: "",
      targets: [],
    }),
  "/provider-sync/now": () =>
    ok({
      percent: 100,
      message: "stub",
      result: null,
    }),

  // ====== Script Market ======

  "/manager/refresh-script-market": () =>
    ok({
      market: {
        status: "ok",
        message: "stub",
        indexUrl: "",
        updatedAt: "",
        scripts: [],
      },
      user_scripts: { enabled: false, installed: {} },
    }),
  "/manager/install-market-script": () =>
    ok({
      market: {
        status: "ok",
        message: "stub",
        indexUrl: "",
        updatedAt: "",
        scripts: [],
      },
      user_scripts: { enabled: false, installed: {} },
    }),
  "/manager/set-user-script-enabled": () => ok({}),
  "/manager/delete-user-script": () => ok({}),

  // ====== External ======

  "/manager/open-external-url": () => ok({}),

  // ====== Install / Uninstall ======

  "/manager/install-entrypoints": () =>
    ok({
      silent_shortcut: { installed: false, path: null },
      management_shortcut: { installed: false, path: null },
    }),
  "/manager/uninstall-entrypoints": () =>
    ok({
      silent_shortcut: { installed: false, path: null },
      management_shortcut: { installed: false, path: null },
    }),
  "/manager/repair-shortcuts": () =>
    ok({
      silent_shortcut: { installed: false, path: null },
      management_shortcut: { installed: false, path: null },
    }),

  // ====== Plugin Marketplace ======

  "/manager/plugin-marketplace-status": () =>
    ok({
      status: "ok",
      message: "stub",
      activePath: null,
      availablePaths: [],
      canRepair: false,
    }),
  "/manager/repair-plugin-marketplace": () =>
    ok({
      status: "ok",
      message: "stub",
      attemptedPaths: [],
      usedPath: null,
    }),
  "/manager/remote-plugin-marketplace-status": () =>
    ok({
      status: "ok",
      message: "stub",
      activePath: null,
      availablePaths: [],
      canRepair: false,
    }),
  "/manager/repair-remote-plugin-marketplace": () =>
    ok({
      status: "ok",
      message: "stub",
      activePath: null,
      availablePaths: [],
      canRepair: false,
    }),

  // ====== Watcher ======

  "/manager/load-watcher-state": () => ok({ enabled: false, disabled_flag: "" }),
  "/manager/install-watcher": () => ok({ enabled: true, disabled_flag: "" }),
  "/manager/uninstall-watcher": () => ok({ enabled: false, disabled_flag: "" }),
  "/manager/enable-watcher": () => ok({ enabled: true, disabled_flag: "" }),
  "/manager/disable-watcher": () => ok({ enabled: false, disabled_flag: "" }),

  // ====== Logs / Diagnostics ======

  "/manager/read-latest-logs": (args) => {
    const lines = Number(args.lines || 200);
    return ok({ path: path.join(CODEX_HOME, "logs", "codex-plus.log"), text: "", lines });
  },
  "/manager/copy-diagnostics": () => ok({ report: "" }),

  // ====== Relay Status / Files ======

  "/manager/relay-status": () => ok(defaultRelayStatus()),
  "/manager/read-relay-files": () =>
    ok({
      configPath: path.join(CODEX_HOME, "config.toml"),
      authPath: path.join(CODEX_HOME, "auth.json"),
      configContents: "",
      authContents: "",
    }),

  // ====== Env Conflicts ======

  "/manager/check-env-conflicts": () => ok({ conflicts: [] }),
  "/manager/remove-env-conflicts": () => ok({ removed: [] }),

  // ====== Relay File Edit ======

  "/manager/save-relay-file": () => ok({}),

  // ====== Relay Switch ======

  "/manager/switch-relay-profile": (args) => {
    const profileId = args?.request?.profileId ?? "";
    const s = defaultSettings();
    s.activeRelayProfileId = profileId;
    return ok({ settings: s, settingsPath: "", user_scripts: null, relay: defaultRelayStatus() });
  },
  "/manager/backfill-relay-profile-from-live": () => ok({ settings: defaultSettings() }),

  // ====== Context Entries ======

  "/manager/list-context-entries": () =>
    ok({
      settings: defaultSettings(),
      entries: { mcpServers: [], skills: [], plugins: [] },
    }),
  "/manager/read-live-context-entries": () =>
    ok({ entries: { mcpServers: [], skills: [], plugins: [] } }),
  "/manager/upsert-context-entry": () => ok({}),
  "/manager/sync-live-context-entries": () =>
    ok({ entries: { mcpServers: [], skills: [], plugins: [] } }),
  "/manager/delete-context-entry": () => ok({}),

  // ====== Relay Common Config ======

  "/manager/extract-relay-common-config": () =>
    ok({ commonConfigContents: "", profileConfigContents: "" }),

  // ====== Profile Test / Models ======

  "/manager/test-relay-profile": () =>
    ok({ httpStatus: 0, endpoint: "", responsePreview: "" }),
  "/manager/test-stepwise-settings": () => ok({ itemCount: 0, error: "" }),
  "/manager/fetch-relay-profile-models": () => ok({ models: [], endpoint: "" }),
  "/manager/diagnose-relay-profile": () =>
    ok({
      profileName: "",
      model: "",
      summary: "",
      recommendation: "",
      checks: [],
    }),

  // ====== Injection ======

  "/manager/apply-relay-injection": () => ok({ message: "stub" }),
  "/manager/apply-pure-api-injection": () => ok({ message: "stub" }),
  "/manager/clear-relay-injection": () => ok({ message: "stub" }),

  // ====== Diagnostic events ======

  "/manager/write-diagnostic-event": () => ok({}),

  // ====== Stepwise (Rust 原 stepwise 模块) ======

  "/stepwise/generate": () => notImplemented("stepwise.generate"),
  "/stepwise/test": () => notImplemented("stepwise.test"),

  // ====== Sessions (Rust 原 sessions 模块) ======

  "/delete": () => notImplemented("sessions.delete"),
  "/undo": () => notImplemented("sessions.undo"),
  "/export-markdown": () => notImplemented("sessions.export-markdown"),
  "/thread-usage-history": () => notImplemented("sessions.thread-usage-history"),
  "/archived-thread": () => notImplemented("sessions.archived-thread"),
  "/move-thread-workspace": () => notImplemented("sessions.move-thread-workspace"),
  "/thread-sort-key": () => notImplemented("sessions.thread-sort-key"),
  "/thread-sort-keys": () => notImplemented("sessions.thread-sort-keys"),
};

export const PATH_TABLE = h;
