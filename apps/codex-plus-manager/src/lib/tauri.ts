// Tauri command bridge layer
// 封装 61 个 #[tauri::command]，统一 invoke + 错误处理
// 与 src-tauri/src/commands.rs 保持同步

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
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

const call = <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  return invoke<T>(command, args ?? {});
};

// ============== 系统信息 ==============

export const tauri = {
  async backendVersion(): Promise<{ version: string; gitHash: string }> {
    return call("backend_version");
  },

  async startupOptions(): Promise<{
    debugPort: number;
    helperPort: number;
    defaultLogLines: number;
  }> {
    return call("startup_options");
  },

  // ============== Overview ==============

  async loadOverview(): Promise<OverviewResult> {
    return call("load_overview");
  },

  async launchCodexPlus(request: {
    args: string;
    mode: string;
  }): Promise<CommandResult<unknown>> {
    return call("launch_codex_plus", { request });
  },

  async restartCodexPlus(request: {
    args: string;
    mode: string;
  }): Promise<CommandResult<unknown>> {
    return call("restart_codex_plus", { request });
  },

  // ============== Settings ==============

  async loadSettings(): Promise<SettingsResult> {
    return call("load_settings");
  },

  async saveSettings(settings: BackendSettings): Promise<SettingsResult> {
    return call("save_settings", { settings });
  },

  async resetSettings(): Promise<SettingsResult> {
    return call("reset_settings");
  },

  async resetImageOverlaySettings(): Promise<SettingsResult> {
    return call("reset_image_overlay_settings");
  },

  // ============== CCS Provider Import ==============

  async loadCcsProviders(): Promise<CcsProvidersResult> {
    return call("load_ccs_providers");
  },

  async importCcsProviders(): Promise<CommandResult<{ imported: number; skipped: number }>> {
    return call("import_ccs_providers");
  },

  async loadPendingProviderImport(): Promise<PendingProviderImportResult> {
    return call("load_pending_provider_import");
  },

  async confirmPendingProviderImport(request: ProviderImportRequest): Promise<CommandResult<unknown>> {
    return call("confirm_pending_provider_import", { request });
  },

  async dismissPendingProviderImport(): Promise<CommandResult<unknown>> {
    return call("dismiss_pending_provider_import");
  },

  // ============== Local Sessions ==============

  async listLocalSessions(): Promise<LocalSessionsResult> {
    return call("list_local_sessions");
  },

  async deleteLocalSession(request: {
    sessionId: string;
    dbPath: string | null;
  }): Promise<DeleteLocalSessionResult> {
    return call("delete_local_session", { request });
  },

  // ============== Zed Remote ==============

  async listZedRemoteProjects(): Promise<ZedRemoteProjectsResult> {
    return call("list_zed_remote_projects");
  },

  async openZedRemote(payload: {
    project: ZedRemoteProject;
    strategy: string;
  }): Promise<ZedRemoteOpenResult> {
    return call("open_zed_remote", { payload });
  },

  async forgetZedRemoteProject(id: string): Promise<CommandResult<unknown>> {
    return call("forget_zed_remote_project", { id });
  },

  // ============== Provider Sync ==============

  async loadProviderSyncTargets(): Promise<CommandResult<ProviderSyncTargetsPayload>> {
    return call("load_provider_sync_targets");
  },

  async syncProvidersNow(
    targetProvider: string | null,
  ): Promise<CommandResult<ProviderSyncProgress>> {
    return call("sync_providers_now", { targetProvider });
  },

  onProviderSyncProgress(cb: (progress: ProviderSyncProgress) => void): Promise<UnlistenFn> {
    return listen<ProviderSyncProgress>("provider-sync-progress", (e) => cb(e.payload));
  },

  // ============== Script Market ==============

  async refreshScriptMarket(): Promise<ScriptMarketResult> {
    return call("refresh_script_market");
  },

  async installMarketScript(id: string): Promise<ScriptMarketResult> {
    return call("install_market_script", { id });
  },

  async setUserScriptEnabled(key: string, enabled: boolean): Promise<CommandResult<unknown>> {
    return call("set_user_script_enabled", { key, enabled });
  },

  async deleteUserScript(key: string): Promise<CommandResult<unknown>> {
    return call("delete_user_script", { key });
  },

  // ============== External ==============

  async openExternalUrl(url: string): Promise<CommandResult<unknown>> {
    return call("open_external_url", { url });
  },

  // ============== Install / Uninstall ==============

  async installEntrypoints(): Promise<InstallResult> {
    return call("install_entrypoints");
  },

  async uninstallEntrypoints(options: {
    silentShortcut: boolean;
    managementShortcut: boolean;
  }): Promise<InstallResult> {
    return call("uninstall_entrypoints", { options });
  },

  async repairShortcuts(): Promise<InstallResult> {
    return call("repair_shortcuts");
  },

  // ============== Plugin Marketplace ==============

  async pluginMarketplaceStatus(): Promise<PluginMarketplaceStatusResult> {
    return call("plugin_marketplace_status");
  },

  async repairPluginMarketplace(): Promise<PluginMarketplaceRepairResult> {
    return call("repair_plugin_marketplace");
  },

  async remotePluginMarketplaceStatus(): Promise<RemotePluginMarketplaceResult> {
    return call("remote_plugin_marketplace_status");
  },

  async repairRemotePluginMarketplace(): Promise<RemotePluginMarketplaceResult> {
    return call("repair_remote_plugin_marketplace");
  },

  // ============== Watcher ==============

  async loadWatcherState(): Promise<WatcherResult> {
    return call("load_watcher_state");
  },

  async installWatcher(): Promise<WatcherResult> {
    return call("install_watcher");
  },

  async uninstallWatcher(): Promise<WatcherResult> {
    return call("uninstall_watcher");
  },

  async enableWatcher(): Promise<WatcherResult> {
    return call("enable_watcher");
  },

  async disableWatcher(): Promise<WatcherResult> {
    return call("disable_watcher");
  },

  // ============== Logs / Diagnostics ==============

  async readLatestLogs(request: { lines: number }): Promise<LogsResult> {
    return call("read_latest_logs", { request });
  },

  async copyDiagnostics(): Promise<DiagnosticsResult> {
    return call("copy_diagnostics");
  },

  // ============== Relay Status / Files ==============

  async relayStatus(): Promise<RelayResult> {
    return call("relay_status");
  },

  async readRelayFiles(): Promise<RelayFilesResult> {
    return call("read_relay_files");
  },

  // ============== Env Conflicts ==============

  async checkEnvConflicts(): Promise<EnvConflictsResult> {
    return call("check_env_conflicts");
  },

  async removeEnvConflicts(request: {
    names: string[];
  }): Promise<RemoveEnvConflictsResult> {
    return call("remove_env_conflicts", { request });
  },

  // ============== Relay File Edit ==============

  async saveRelayFile(request: {
    file: "config" | "auth";
    contents: string;
  }): Promise<CommandResult<unknown>> {
    return call("save_relay_file", { request });
  },

  // ============== Relay Switch ==============

  async switchRelayProfile(request: {
    profileId: string;
  }): Promise<RelaySwitchResult> {
    return call("switch_relay_profile", { request });
  },

  async backfillRelayProfileFromLive(request: {
    profileId: string;
  }): Promise<SettingsBackfillResult> {
    return call("backfill_relay_profile_from_live", { request });
  },

  // ============== Context Entries ==============

  async listContextEntries(request: {
    settings: BackendSettings;
  }): Promise<ContextEntriesResult> {
    return call("list_context_entries", { request });
  },

  async readLiveContextEntries(): Promise<LiveContextEntriesResult> {
    return call("read_live_context_entries");
  },

  async upsertContextEntry(request: {
    kind: string;
    name: string;
    entry: unknown;
  }): Promise<CommandResult<unknown>> {
    return call("upsert_context_entry", { request });
  },

  async syncLiveContextEntries(request: {
    settings: BackendSettings;
  }): Promise<LiveContextEntriesResult> {
    return call("sync_live_context_entries", { request });
  },

  async deleteContextEntry(request: {
    kind: string;
    name: string;
  }): Promise<CommandResult<unknown>> {
    return call("delete_context_entry", { request });
  },

  // ============== Relay Common Config ==============

  async extractRelayCommonConfig(request: {
    profileId: string;
  }): Promise<ExtractRelayCommonConfigResult> {
    return call("extract_relay_common_config", { request });
  },

  // ============== Profile Test / Models ==============

  async testRelayProfile(profile: RelayProfile): Promise<RelayProfileTestResult> {
    return call("test_relay_profile", { profile });
  },

  async testStepwiseSettings(settings: BackendSettings): Promise<StepwiseTestResult> {
    return call("test_stepwise_settings", { settings });
  },

  async fetchRelayProfileModels(profile: RelayProfile): Promise<RelayProfileModelsResult> {
    return call("fetch_relay_profile_models", { profile });
  },

  async diagnoseRelayProfile(profile: RelayProfile): Promise<ProviderDoctorResult> {
    return call("diagnose_relay_profile", { profile });
  },

  // ============== Injection ==============

  async applyRelayInjection(): Promise<CommandResult<unknown>> {
    return call("apply_relay_injection");
  },

  async applyPureApiInjection(): Promise<CommandResult<unknown>> {
    return call("apply_pure_api_injection");
  },

  async clearRelayInjection(): Promise<CommandResult<unknown>> {
    return call("clear_relay_injection");
  },

  // ============== Tray ==============

  async updateTrayLabels(
    label: string,
    profile: string,
  ): Promise<CommandResult<unknown>> {
    return call("update_tray_labels", { label, profile });
  },

  onTrayUpdate(cb: (state: unknown) => void): Promise<UnlistenFn> {
    return listen("tray-update", (e) => cb(e.payload));
  },

  async managerHideToTray(): Promise<CommandResult<unknown>> {
    return call("manager_hide_to_tray");
  },

  async managerExitApp(): Promise<CommandResult<unknown>> {
    return call("manager_exit_app");
  },

  // ============== Diagnostic events ==============

  async writeDiagnosticEvent(event: string, detail: unknown): Promise<CommandResult<unknown>> {
    return call("write_diagnostic_event", { event, detail });
  },
};

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
};
