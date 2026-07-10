// HTTP API bridge layer
// 替代原先的 tauri.ts — 走 fetch → Axum POST /api/bridge
// 后端端口与 CORS 见 apps/codex-plus-server crate
//
// 用法与原 tauri.ts 保持一致：每个方法都返回与原 Tauri command 同结构的对象
// （含 status / message 字段），但实现走 HTTP fetch。
//
// 对于尚未移植到 HTTP bridge 的旧 Tauri command，方法返回
// { status: "failed", message: "未移植：<name>" } ——
// 这是为了让前端不崩，让删除 Tauri 时代码不报错。后续按需逐个补端点。

import type {
  OverviewResult,
  SettingsResult,
  RelayResult,
  RelayFilesResult,
  RelaySwitchResult,
  RelayProfileTestResult,
  StepwiseTestResult,
  RelayProfileModelsResult,
  LocalSessionsResult,
  DeleteLocalSessionResult,
  ZedRemoteProjectsResult,
  ZedRemoteOpenResult,
  SettingsBackfillResult,
  ContextEntriesResult,
  LiveContextEntriesResult,
  ExtractRelayCommonConfigResult,
  CcsProvidersResult,
  PendingProviderImportResult,
  EnvConflictsResult,
  RemoveEnvConflictsResult,
  PluginMarketplaceStatusResult,
  PluginMarketplaceRepairResult,
  RemotePluginMarketplaceResult,
  WatcherResult,
  InstallResult,
  ScriptMarketResult,
  LogsResult,
  DiagnosticsResult,
  ProviderSyncTargetsPayload,
  ProviderSyncProgress,
  ProviderDoctorResult,
  BackendSettings,
  RelayProfile,
  LocalSession,
  ZedRemoteProject,
  CodexContextEntries,
  ProviderImportRequest,
  EnvConflict,
  CommandResult,
} from "./types";

const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "http://localhost:8787";

async function call<T>(path: string, args: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/bridge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, ...args }),
    });
  } catch (err) {
    // 网络/CORS 错误：返回 failed 形态，让上层按 CommandResult 处理
    return {
      status: "failed",
      message: `无法连接 ${API_BASE}/api/bridge：${
        err instanceof Error ? err.message : String(err)
      }`,
    } as unknown as T;
  }
  if (!res.ok) {
    return {
      status: "failed",
      message: `HTTP ${res.status}：${await res.text().catch(() => "<no body>")}`,
    } as unknown as T;
  }
  const json = (await res.json()) as { ok: boolean; data: T };
  return json.data;
}

// 未移植端点的统一占位：返回 failed 形态的 CommandResult，
// 保持类型兼容（前端代码不会因 status 缺失而崩溃）。
function stub<T extends CommandResult<unknown>>(name: string): Promise<T> {
  return Promise.resolve({
    status: "failed",
    message: `未移植到 HTTP API：${name}`,
  } as unknown as T);
}

// Tauri 专属能力（tray 事件、单实例锁）在 Web 环境下没有对应概念。
// 提供 no-op 让前端代码可以无差别 import。
type UnlistenFn = () => void;

export const api = {
  // ============== 系统信息 ==============

  async backendVersion(): Promise<{ version: string; gitHash: string }> {
    try {
      const r = await fetch(`${API_BASE}/api/health`);
      const j = (await r.json()) as { version?: string };
      return { version: j.version ?? "unknown", gitHash: "" };
    } catch {
      return { version: "unknown", gitHash: "" };
    }
  },

  async startupOptions(): Promise<{
    debugPort: number;
    helperPort: number;
    defaultLogLines: number;
  }> {
    return { debugPort: 9229, helperPort: 57321, defaultLogLines: 200 };
  },

  // ============== Overview ==============

  async loadOverview(): Promise<OverviewResult> {
    return call<OverviewResult>("/overview");
  },

  async launchCodexPlus(request: { args: string; mode: string }): Promise<CommandResult<unknown>> {
    return call<CommandResult<unknown>>("/launch", { request });
  },

  async restartCodexPlus(request: { args: string; mode: string }): Promise<CommandResult<unknown>> {
    return call<CommandResult<unknown>>("/restart", { request });
  },

  // ============== Settings ==============

  async loadSettings(): Promise<SettingsResult> {
    return call<SettingsResult>("/settings/get");
  },

  async saveSettings(settings: BackendSettings): Promise<SettingsResult> {
    return call<SettingsResult>("/settings/set", { settings });
  },

  async resetSettings(): Promise<SettingsResult> {
    return call<SettingsResult>("/settings/reset");
  },

  async resetImageOverlaySettings(): Promise<SettingsResult> {
    return call<SettingsResult>("/settings/reset-image-overlay");
  },

  // ============== CCS Provider Import ==============

  async loadCcsProviders(): Promise<CcsProvidersResult> {
    return call<CcsProvidersResult>("/ccs-providers/list");
  },

  async importCcsProviders(): Promise<CommandResult<{ imported: number; skipped: number }>> {
    return call("/ccs-providers/import");
  },

  async loadPendingProviderImport(): Promise<PendingProviderImportResult> {
    return call<PendingProviderImportResult>("/ccs-providers/pending");
  },

  async confirmPendingProviderImport(
    request: ProviderImportRequest,
  ): Promise<CommandResult<unknown>> {
    return call("/ccs-providers/confirm", { request });
  },

  async dismissPendingProviderImport(): Promise<CommandResult<unknown>> {
    return call("/ccs-providers/dismiss");
  },

  // ============== Local Sessions ==============

  async listLocalSessions(): Promise<LocalSessionsResult> {
    return call<LocalSessionsResult>("/sessions/list");
  },

  async deleteLocalSession(request: {
    sessionId: string;
    dbPath: string | null;
  }): Promise<DeleteLocalSessionResult> {
    return call<DeleteLocalSessionResult>("/sessions/delete", { request });
  },

  // ============== Zed Remote ==============

  async listZedRemoteProjects(): Promise<ZedRemoteProjectsResult> {
    return call<ZedRemoteProjectsResult>("/zed-remote/projects");
  },

  async openZedRemote(payload: {
    project: ZedRemoteProject;
    strategy: string;
  }): Promise<ZedRemoteOpenResult> {
    return call<ZedRemoteOpenResult>("/zed-remote/open", { payload });
  },

  async forgetZedRemoteProject(id: string): Promise<CommandResult<unknown>> {
    return call("/zed-remote/forget-project", { id });
  },

  // ============== Provider Sync ==============

  async loadProviderSyncTargets(): Promise<CommandResult<ProviderSyncTargetsPayload>> {
    return call("/provider-sync/targets");
  },

  async syncProvidersNow(
    targetProvider: string | null,
  ): Promise<CommandResult<ProviderSyncProgress>> {
    return call("/provider-sync/now", { targetProvider });
  },

  onProviderSyncProgress(
    _cb: (progress: ProviderSyncProgress) => void,
  ): Promise<UnlistenFn> {
    // 浏览器 EventSource / WebSocket 后续可补；先 no-op
    return Promise.resolve(() => {});
  },

  // ============== Script Market ==============

  async refreshScriptMarket(): Promise<ScriptMarketResult> {
    return call<ScriptMarketResult>("/user-scripts/refresh-market");
  },

  async installMarketScript(id: string): Promise<ScriptMarketResult> {
    return call<ScriptMarketResult>("/user-scripts/install-market", { id });
  },

  async setUserScriptEnabled(key: string, enabled: boolean): Promise<CommandResult<unknown>> {
    return call("/user-scripts/set-script-enabled", { key, enabled });
  },

  async deleteUserScript(key: string): Promise<CommandResult<unknown>> {
    return call("/user-scripts/delete", { key });
  },

  // ============== External ==============

  async openExternalUrl(url: string): Promise<CommandResult<unknown>> {
    return call("/open-external-url", { url });
  },

  // ============== Install / Uninstall ==============

  async installEntrypoints(): Promise<InstallResult> {
    return call<InstallResult>("/install/entrypoints");
  },

  async uninstallEntrypoints(options: {
    silentShortcut: boolean;
    managementShortcut: boolean;
  }): Promise<InstallResult> {
    return call<InstallResult>("/install/uninstall-entrypoints", { options });
  },

  async repairShortcuts(): Promise<InstallResult> {
    return call<InstallResult>("/install/repair-shortcuts");
  },

  // ============== Plugin Marketplace ==============

  async pluginMarketplaceStatus(): Promise<PluginMarketplaceStatusResult> {
    return call<PluginMarketplaceStatusResult>("/plugin-marketplace/status");
  },

  async repairPluginMarketplace(): Promise<PluginMarketplaceRepairResult> {
    return call<PluginMarketplaceRepairResult>("/plugin-marketplace/repair");
  },

  async remotePluginMarketplaceStatus(): Promise<RemotePluginMarketplaceResult> {
    return call<RemotePluginMarketplaceResult>("/plugin-marketplace/remote-status");
  },

  async repairRemotePluginMarketplace(): Promise<RemotePluginMarketplaceResult> {
    return call<RemotePluginMarketplaceResult>("/plugin-marketplace/repair-remote");
  },

  // ============== Watcher ==============

  async loadWatcherState(): Promise<WatcherResult> {
    return call<WatcherResult>("/watcher/state");
  },

  async installWatcher(): Promise<WatcherResult> {
    return call<WatcherResult>("/watcher/install");
  },

  async uninstallWatcher(): Promise<WatcherResult> {
    return call<WatcherResult>("/watcher/uninstall");
  },

  async enableWatcher(): Promise<WatcherResult> {
    return call<WatcherResult>("/watcher/enable");
  },

  async disableWatcher(): Promise<WatcherResult> {
    return call<WatcherResult>("/watcher/disable");
  },

  // ============== Logs / Diagnostics ==============

  async readLatestLogs(request: { lines: number }): Promise<LogsResult> {
    return call<LogsResult>("/logs/latest", { request });
  },

  async copyDiagnostics(): Promise<DiagnosticsResult> {
    return call<DiagnosticsResult>("/diagnostics/copy");
  },

  // ============== Relay Status / Files ==============

  async relayStatus(): Promise<RelayResult> {
    return call<RelayResult>("/relay/status");
  },

  async readRelayFiles(): Promise<RelayFilesResult> {
    return call<RelayFilesResult>("/relay/files");
  },

  // ============== Env Conflicts ==============

  async checkEnvConflicts(): Promise<EnvConflictsResult> {
    return call<EnvConflictsResult>("/relay/env-conflicts");
  },

  async removeEnvConflicts(request: { names: string[] }): Promise<RemoveEnvConflictsResult> {
    return call<RemoveEnvConflictsResult>("/relay/remove-env-conflicts", { request });
  },

  // ============== Relay File Edit ==============

  async saveRelayFile(request: {
    file: "config" | "auth";
    contents: string;
  }): Promise<CommandResult<unknown>> {
    return call("/relay/save-file", { request });
  },

  // ============== Relay Switch ==============

  async switchRelayProfile(request: { profileId: string }): Promise<RelaySwitchResult> {
    return call<RelaySwitchResult>("/relay/switch-profile", { request });
  },

  async backfillRelayProfileFromLive(request: {
    profileId: string;
  }): Promise<SettingsBackfillResult> {
    return call<SettingsBackfillResult>("/relay/backfill-profile", { request });
  },

  // ============== Context Entries ==============

  async listContextEntries(request: { settings: BackendSettings }): Promise<ContextEntriesResult> {
    return call<ContextEntriesResult>("/relay/context-entries", { request });
  },

  async readLiveContextEntries(): Promise<LiveContextEntriesResult> {
    return call<LiveContextEntriesResult>("/relay/live-context-entries");
  },

  async upsertContextEntry(request: {
    kind: string;
    name: string;
    entry: unknown;
  }): Promise<CommandResult<unknown>> {
    return call("/relay/upsert-context-entry", { request });
  },

  async syncLiveContextEntries(request: {
    settings: BackendSettings;
  }): Promise<LiveContextEntriesResult> {
    return call<LiveContextEntriesResult>("/relay/sync-live-context-entries", { request });
  },

  async deleteContextEntry(request: {
    kind: string;
    name: string;
  }): Promise<CommandResult<unknown>> {
    return call("/relay/delete-context-entry", { request });
  },

  // ============== Relay Common Config ==============

  async extractRelayCommonConfig(request: {
    profileId: string;
  }): Promise<ExtractRelayCommonConfigResult> {
    return call<ExtractRelayCommonConfigResult>("/relay/extract-common-config", { request });
  },

  // ============== Profile Test / Models ==============

  async testRelayProfile(profile: RelayProfile): Promise<RelayProfileTestResult> {
    return call<RelayProfileTestResult>("/relay/test-profile", { profile });
  },

  async testStepwiseSettings(settings: BackendSettings): Promise<StepwiseTestResult> {
    return call<StepwiseTestResult>("/stepwise/test", { settings });
  },

  async fetchRelayProfileModels(profile: RelayProfile): Promise<RelayProfileModelsResult> {
    return call<RelayProfileModelsResult>("/relay/profile-models", { profile });
  },

  async diagnoseRelayProfile(profile: RelayProfile): Promise<ProviderDoctorResult> {
    return call<ProviderDoctorResult>("/relay/diagnose-profile", { profile });
  },

  // ============== Injection ==============

  async applyRelayInjection(): Promise<CommandResult<unknown>> {
    return call("/injection/apply-relay");
  },

  async applyPureApiInjection(): Promise<CommandResult<unknown>> {
    return call("/injection/apply-pure-api");
  },

  async clearRelayInjection(): Promise<CommandResult<unknown>> {
    return call("/injection/clear-relay");
  },

  // ============== Tray ==============
  // Tauri 专属能力（系统托盘 / 隐藏到托盘 / 单实例），
  // Web 环境无对应概念。提供 no-op 或 stub。

  async updateTrayLabels(
    _label: string,
    _profile: string,
  ): Promise<CommandResult<unknown>> {
    return stub<CommandResult<unknown>>("updateTrayLabels");
  },

  onTrayUpdate(_cb: (state: unknown) => void): Promise<UnlistenFn> {
    // Tauri 系统托盘事件 — Web 环境无对应
    return Promise.resolve(() => {});
  },

  async managerHideToTray(): Promise<CommandResult<unknown>> {
    return stub<CommandResult<unknown>>("managerHideToTray");
  },

  async managerExitApp(): Promise<CommandResult<unknown>> {
    return stub<CommandResult<unknown>>("managerExitApp");
  },

  // ============== Diagnostic events ==============

  async writeDiagnosticEvent(
    event: string,
    detail: unknown,
  ): Promise<CommandResult<unknown>> {
    return call("/diagnostics/log", { event, detail });
  },
};

// 与 tauri.ts 保持同名的导出别名，避免组件逐个改 import 时找不到标识符。
// 旧代码 `import { tauri } from "@/lib/tauri"` 改成
// `import { api as tauri } from "@/lib/api"` 后用法不变。
export { api as tauri };

// Re-export common types for convenience
export type {
  OverviewResult,
  SettingsResult,
  RelayResult,
  RelayFilesResult,
  RelaySwitchResult,
  RelayProfileTestResult,
  StepwiseTestResult,
  RelayProfileModelsResult,
  LocalSessionsResult,
  DeleteLocalSessionResult,
  ZedRemoteProjectsResult,
  ZedRemoteOpenResult,
  SettingsBackfillResult,
  ContextEntriesResult,
  LiveContextEntriesResult,
  ExtractRelayCommonConfigResult,
  CcsProvidersResult,
  PendingProviderImportResult,
  EnvConflictsResult,
  RemoveEnvConflictsResult,
  PluginMarketplaceStatusResult,
  PluginMarketplaceRepairResult,
  RemotePluginMarketplaceResult,
  WatcherResult,
  InstallResult,
  ScriptMarketResult,
  LogsResult,
  DiagnosticsResult,
  ProviderSyncTargetsPayload,
  ProviderSyncProgress,
  ProviderDoctorResult,
  BackendSettings,
  RelayProfile,
  LocalSession,
  ZedRemoteProject,
  CodexContextEntries,
  ProviderImportRequest,
  EnvConflict,
  CommandResult,
};
