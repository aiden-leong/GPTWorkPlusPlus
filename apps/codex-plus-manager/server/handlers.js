// 业务 handlers — Node 实现
// 阶段 2：批量接上真实逻辑（settings / overview / relay / env / sessions / upstream）

import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";

import {
  defaultBackendSettings,
  settingsStore,
  CODEX_HOME,
  SETTINGS_PATH,
  defaultRelayProfile,
  normalizeSettings,
} from "./settings.js";
import {
  relayStatus,
  readRelayFiles,
  saveRelayFile,
  CONFIG_PATH,
  AUTH_PATH,
} from "./relay-config.js";
import { checkEnvConflicts, removeEnvConflicts } from "./env-conflicts.js";
import { listLocalSessions, deleteLocalSession } from "./sessions.js";
import {
  fetchRelayProfileModels,
  testRelayProfile,
  diagnoseRelayProfile,
} from "./upstream.js";
import { launchCodexPlus, openExternalUrl } from "./launcher.js";
import {
  pluginMarketplaceStatus,
  repairPluginMarketplace,
  remotePluginMarketplaceStatus,
  repairRemotePluginMarketplace,
} from "./plugin-marketplace.js";
import { listZedRemoteProjects, openZedRemote } from "./zed-remote.js";
import { listUserScripts } from "./user-scripts.js";
import {
  applyRelayInjection,
  applyPureApiInjection,
  clearRelayInjection,
} from "./injection.js";
import {
  loadCcsProviders,
  importCcsProviders,
  loadPendingProviderImport,
  confirmPendingProviderImport,
  dismissPendingProviderImport,
} from "./ccs-import.js";
import {
  refreshScriptMarket,
  installMarketScript,
  setUserScriptEnabled,
  deleteUserScript,
} from "./script-market.js";
import { loadProviderSyncTargets, syncProvidersNow } from "./provider-sync.js";
import { installEntrypoints, uninstallEntrypoints, repairShortcuts } from "./entrypoints.js";
import {
  loadWatcherState,
  installWatcher,
  uninstallWatcher,
  enableWatcher,
  disableWatcher,
} from "./watcher.js";
import { testStepwiseSettings } from "./stepwise.js";
import {
  listContextEntries,
  readLiveContextEntries,
  upsertContextEntry,
  deleteContextEntry,
  syncLiveContextEntries,
} from "./context-entries.js";

const HOME = os.homedir();
const LOGS_DIR = path.join(CODEX_HOME, "logs");
const LOG_PATH = path.join(LOGS_DIR, "codex-plus.log");
const VERSION = "0.0.0-node";

// ====== 工具 ======

function ok(payload = {}, message = "ok") {
  return { status: "ok", message, ...payload };
}

function failed(message, payload = {}) {
  return { status: "failed", message, ...payload };
}

// ====== Helpers ======

async function findCodexAppDir(savedPath) {
  // 1) 优先用 settings 里的 codexAppPath
  if (savedPath && savedPath.trim()) {
    try {
      const stat = await fs.stat(savedPath);
      if (stat.isDirectory()) return savedPath;
    } catch {}
  }
  // 2) 常见默认路径
  const candidates = [
    "/Applications/Codex.app",
    path.join(HOME, "Applications", "Codex.app"),
  ];
  for (const c of candidates) {
    try {
      const stat = await fs.stat(c);
      if (stat.isDirectory()) return c;
    } catch {}
  }
  return null;
}

async function codexAppVersion(appDir) {
  if (!appDir) return null;
  const plist = path.join(appDir, "Contents", "Info.plist");
  try {
    const text = await fs.readFile(plist, "utf8");
    const m = text.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
    if (m) return m[1].trim();
  } catch {}
  return null;
}

function pathState(p) {
  if (!p) return { status: "not_configured", path: null };
  return { status: "ok", path: p };
}

async function readTail(filePath, lines) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const arr = text.split("\n");
    return arr.slice(Math.max(0, arr.length - lines)).join("\n");
  } catch (err) {
    if (err.code === "ENOENT") return "";
    throw err;
  }
}

// ====== Handlers ======

const h = {
  // ====== 系统信息 ======

  "/manager/backend-version": () => ok({ version: VERSION, gitHash: "" }),
  "/manager/startup-options": () =>
    ok({ debugPort: 9229, helperPort: 57321, defaultLogLines: 200 }),

  // ====== Overview ======

  "/manager/load-overview": async () => {
    const settings = await settingsStore.load();
    const appDir = await findCodexAppDir(settings.codexAppPath);
    const version = await codexAppVersion(appDir);
    return ok({
      codex_app: pathState(appDir),
      codex_version: version,
      silent_shortcut: { status: "not_checked", path: null },
      management_shortcut: { status: "not_checked", path: null },
      latest_launch: null,
      current_version: VERSION,
      settings_path: SETTINGS_PATH,
      logs_path: LOG_PATH,
    });
  },
  "/manager/launch-codex-plus": async (args) => {
    const appPath = args?.request?.appPath ?? args?.appPath ?? "";
    const debugPort = Number(args?.debugPort ?? 9229);
    const helperPort = Number(args?.helperPort ?? 57321);
    const r = await launchCodexPlus(appPath, debugPort, helperPort);
    return r.status === "ok" ? ok(r) : r;
  },
  "/manager/restart-codex-plus": async (args) => {
    const appPath = args?.request?.appPath ?? args?.appPath ?? "";
    const debugPort = Number(args?.debugPort ?? 9229);
    const helperPort = Number(args?.helperPort ?? 57321);
    const r = await launchCodexPlus(appPath, debugPort, helperPort);
    return r.status === "ok" ? ok(r) : r;
  },

  // ====== Settings ======

  "/manager/load-settings": async () => {
    const settings = await settingsStore.load();
    return ok({ settings, settingsPath: SETTINGS_PATH });
  },
  "/manager/save-settings": async (args) => {
    const input = args.settings ?? defaultBackendSettings();
    const settings = await settingsStore.save(input);
    return ok({ settings, settingsPath: SETTINGS_PATH });
  },
  "/manager/reset-settings": async () => {
    const settings = await settingsStore.reset();
    return ok({ settings, settingsPath: SETTINGS_PATH });
  },
  "/manager/reset-image-overlay-settings": async () => {
    const settings = await settingsStore.load();
    settings.codexAppImageOverlayEnabled = false;
    settings.codexAppImageOverlayPath = "";
    settings.codexAppImageOverlayOpacity = 35;
    settings.codexAppImageOverlayFitMode = "fit";
    settings.imageOverlay = { enabled: false, fit: "fit", opacity: 1 };
    const saved = await settingsStore.save(settings);
    return ok({ settings: saved, settingsPath: SETTINGS_PATH });
  },

  // ====== CCS Provider Import ======

  "/manager/load-ccs-providers": async () => {
    const r = await loadCcsProviders();
    return ok(r);
  },
  "/manager/import-ccs-providers": async () => {
    const r = await importCcsProviders();
    return ok(r);
  },
  "/manager/load-pending-provider-import": () => {
    const r = loadPendingProviderImport();
    return ok(r);
  },
  "/manager/confirm-pending-provider-import": async (args) => {
    const req = args?.request ?? args;
    const r = await confirmPendingProviderImport(req);
    return r.status === "ok" ? ok(r) : r;
  },
  "/manager/dismiss-pending-provider-import": () => {
    const r = dismissPendingProviderImport();
    return ok(r);
  },

  // ====== Local Sessions ======

  "/sessions/list": async () => {
    const r = await listLocalSessions();
    return ok(r);
  },
  "/sessions/delete": async (args) => {
    const req = args.request ?? args;
    const r = await deleteLocalSession(req);
    return ok(r);
  },

  // ====== Zed Remote ======

  "/zed-remote/projects": async () => {
    const r = await listZedRemoteProjects();
    return ok(r);
  },
  "/zed-remote/open": async (args) => {
    const payload = args?.payload ?? args;
    const r = await openZedRemote(payload ?? {});
    return r.status === "ok" ? ok(r) : r;
  },
  "/zed-remote/forget-project": () => ok({}),

  // ====== Provider Sync ======

  "/provider-sync/targets": async () => {
    const r = await loadProviderSyncTargets();
    return ok(r);
  },
  "/provider-sync/now": async (args) => {
    const targetProvider = args?.targetProvider ?? null;
    const r = await syncProvidersNow(targetProvider);
    return r.status === "ok" ? ok(r) : r;
  },

  // ====== Script Market ======

  "/manager/refresh-script-market": async () => {
    const r = await refreshScriptMarket();
    return ok(r);
  },
  "/manager/install-market-script": async (args) => {
    const id = args?.id ?? "";
    const r = await installMarketScript(id);
    return r.status === "failed" ? r : ok(r);
  },
  "/manager/set-user-script-enabled": async (args) => {
    const r = await setUserScriptEnabled(args?.key, args?.enabled);
    return ok(r);
  },
  "/manager/delete-user-script": async (args) => {
    const r = await deleteUserScript(args?.key);
    return ok(r);
  },

  // ====== External ======

  "/manager/open-external-url": async (args) => {
    const url = args?.url ?? args?.request?.url ?? "";
    const r = await openExternalUrl(url);
    return r.status === "ok" ? ok(r) : r;
  },

  // ====== Install / Uninstall ======

  "/manager/install-entrypoints": async (args) => {
    const options = args?.options ?? args ?? {};
    const r = await installEntrypoints(options);
    return r;
  },
  "/manager/uninstall-entrypoints": async (args) => {
    const options = args?.options ?? args ?? {};
    const r = await uninstallEntrypoints(options);
    return r;
  },
  "/manager/repair-shortcuts": async (args) => {
    const options = args?.options ?? args ?? {};
    const r = await repairShortcuts(options);
    return r;
  },

  // ====== Plugin Marketplace ======

  "/manager/plugin-marketplace-status": async () => {
    const r = await pluginMarketplaceStatus();
    return ok(r);
  },
  "/manager/repair-plugin-marketplace": async () => {
    const r = await repairPluginMarketplace();
    return ok(r);
  },
  "/manager/remote-plugin-marketplace-status": async () => {
    const r = await remotePluginMarketplaceStatus();
    return ok(r);
  },
  "/manager/repair-remote-plugin-marketplace": async () => {
    const r = await repairRemotePluginMarketplace();
    return ok(r);
  },

  // ====== Watcher ======

  "/manager/load-watcher-state": async () => {
    return loadWatcherState();
  },
  "/manager/install-watcher": async () => {
    return installWatcher();
  },
  "/manager/uninstall-watcher": async () => {
    return uninstallWatcher();
  },
  "/manager/enable-watcher": async () => {
    return enableWatcher();
  },
  "/manager/disable-watcher": async () => {
    return disableWatcher();
  },

  // ====== Logs / Diagnostics ======

  "/manager/read-latest-logs": async (args) => {
    const lines = Number(args?.request?.lines ?? args?.lines ?? 200);
    const text = await readTail(LOG_PATH, lines);
    return ok({ path: LOG_PATH, text, lines });
  },
  "/manager/copy-diagnostics": async () => {
    const text = await readTail(LOG_PATH, 500);
    const report = [
      "# Codex++ Diagnostics",
      "",
      `version: ${VERSION}`,
      `log_path: ${LOG_PATH}`,
      `codex_home: ${CODEX_HOME}`,
      `settings_path: ${SETTINGS_PATH}`,
      `node: ${process.version}`,
      `platform: ${process.platform}`,
      "",
      "## Recent logs",
      "",
      "```",
      text,
      "```",
    ].join("\n");
    return ok({ report });
  },

  // ====== Relay Status / Files ======

  "/manager/relay-status": async () => {
    const r = await relayStatus();
    return ok(r);
  },
  "/manager/read-relay-files": async () => {
    const r = await readRelayFiles();
    return ok(r);
  },

  // ====== Env Conflicts ======

  "/manager/check-env-conflicts": async () => {
    const r = await checkEnvConflicts();
    return ok(r);
  },
  "/manager/remove-env-conflicts": async (args) => {
    const names = args?.request?.names ?? args?.names ?? [];
    const r = await removeEnvConflicts(names);
    return ok(r);
  },

  // ====== Relay File Edit ======

  "/manager/save-relay-file": async (args) => {
    const req = args.request ?? args;
    const r = await saveRelayFile(req.file, req.contents);
    return ok(r);
  },

  // ====== Relay Switch ======

  "/manager/switch-relay-profile": async (args) => {
    const profileId = args?.request?.profileId ?? args?.profileId ?? "";
    const settings = await settingsStore.load();
    settings.activeRelayProfileId = profileId;
    settings.activeRelayId = profileId;
    const saved = await settingsStore.save(settings);
    const r = await relayStatus();
    return ok({ settings: saved, settingsPath: SETTINGS_PATH, user_scripts: null, relay: r });
  },
  "/manager/backfill-relay-profile-from-live": async () => {
    const settings = await settingsStore.load();
    return ok({ settings });
  },

  // ====== Context Entries ======

  "/manager/list-context-entries": async () => {
    const settings = await settingsStore.load();
    const entries = await listContextEntries();
    return ok({ settings, entries });
  },
  "/manager/read-live-context-entries": async () => {
    const entries = await readLiveContextEntries();
    return ok({ entries });
  },
  "/manager/upsert-context-entry": async (args) => {
    const req = args?.request ?? args;
    const r = await upsertContextEntry(req);
    return r;
  },
  "/manager/sync-live-context-entries": async () => {
    const r = await syncLiveContextEntries();
    return r.status === "ok" ? ok(r) : r;
  },
  "/manager/delete-context-entry": async (args) => {
    const req = args?.request ?? args;
    const r = await deleteContextEntry(req);
    return r;
  },

  // ====== Relay Common Config ======

  "/manager/extract-relay-common-config": () =>
    ok({ commonConfigContents: "", profileConfigContents: "" }),

  // ====== Profile Test / Models ======

  "/manager/test-relay-profile": async (args) => {
    const profile = args.profile ?? args;
    const r = await testRelayProfile(profile);
    return ok(r);
  },
  "/manager/test-stepwise-settings": async (args) => {
    const settings = args?.settings ?? args;
    return testStepwiseSettings(settings);
  },
  "/manager/fetch-relay-profile-models": async (args) => {
    const profile = args.profile ?? args;
    const r = await fetchRelayProfileModels(profile);
    return ok(r);
  },
  "/manager/diagnose-relay-profile": async (args) => {
    const profile = args.profile ?? args;
    const r = await diagnoseRelayProfile(profile);
    return ok(r);
  },

  // ====== Injection ======

  "/manager/apply-relay-injection": async () => {
    const settings = await settingsStore.load();
    const activeId = settings.activeRelayId || settings.activeRelayProfileId || "default";
    const profile = settings.relayProfiles.find((p) => p.id === activeId) || settings.relayProfiles[0];
    const r = await applyRelayInjection(profile);
    return r.status === "ok" ? ok(r) : r;
  },
  "/manager/apply-pure-api-injection": async () => {
    const settings = await settingsStore.load();
    const activeId = settings.activeRelayId || settings.activeRelayProfileId || "default";
    const profile = settings.relayProfiles.find((p) => p.id === activeId) || settings.relayProfiles[0];
    const r = await applyPureApiInjection(profile);
    return r.status === "ok" ? ok(r) : r;
  },
  "/manager/clear-relay-injection": async () => {
    const r = await clearRelayInjection();
    return r.status === "ok" ? ok(r) : r;
  },

  // ====== Diagnostic events ======

  "/manager/write-diagnostic-event": () => ok({}),
};

export const PATH_TABLE = h;
