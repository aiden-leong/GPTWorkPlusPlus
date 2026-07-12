// 全局状态管理 - zustand
// 把原 App.tsx 的 24 个 useState 拆成有边界的 store

import { create } from "zustand";
import type {
  OverviewResult,
  SettingsResult,
  RelayResult,
  RelayFilesResult,
  LocalSessionsResult,
  CodexContextEntries,
  LogsResult,
  DiagnosticsResult,
  WatcherResult,
  ScriptMarketResult,
  CcsProvidersResult,
  EnvConflictsResult,
  ProviderImportRequest,
  PluginMarketplaceStatusResult,
  RemotePluginMarketplaceResult,
  Theme,
} from "./types";

// ============== UI Store ==============

type UIState = {
  theme: Theme;
  notice: { title: string; message: string; status?: string } | null;
  setTheme: (theme: Theme) => void;
  setNotice: (notice: UIState["notice"]) => void;
};

export const useUIStore = create<UIState>((set) => ({
  theme: (typeof window !== "undefined" && window.localStorage.getItem("codex-plus-theme") === "light")
    ? "light"
    : "dark",
  notice: null,
  setTheme: (theme) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("codex-plus-theme", theme);
    }
    set({ theme });
  },
  setNotice: (notice) => set({ notice }),
}));

// ============== Overview Store ==============

type OverviewState = {
  overview: OverviewResult | null;
  loading: boolean;
  setOverview: (overview: OverviewResult | null) => void;
  setLoading: (loading: boolean) => void;
};

export const useOverviewStore = create<OverviewState>((set) => ({
  overview: null,
  loading: false,
  setOverview: (overview) => set({ overview }),
  setLoading: (loading) => set({ loading }),
}));

// ============== Settings Store ==============

type SettingsState = {
  settings: SettingsResult | null;
  dirty: boolean;
  setSettings: (settings: SettingsResult | null) => void;
  setDirty: (dirty: boolean) => void;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  dirty: false,
  setSettings: (settings) => set({ settings, dirty: false }),
  setDirty: (dirty) => set({ dirty }),
}));

// ============== Relay Store ==============

type RelayState = {
  relay: RelayResult | null;
  relayFiles: RelayFilesResult | null;
  envConflicts: EnvConflictsResult | null;
  ccsProviders: CcsProvidersResult | null;
  pendingProviderImport: ProviderImportRequest | null;
  setRelay: (relay: RelayResult | null) => void;
  setRelayFiles: (relayFiles: RelayFilesResult | null) => void;
  setEnvConflicts: (envConflicts: EnvConflictsResult | null) => void;
  setCcsProviders: (ccsProviders: CcsProvidersResult | null) => void;
  setPendingProviderImport: (pending: ProviderImportRequest | null) => void;
};

export const useRelayStore = create<RelayState>((set) => ({
  relay: null,
  relayFiles: null,
  envConflicts: null,
  ccsProviders: null,
  pendingProviderImport: null,
  setRelay: (relay) => set({ relay }),
  setRelayFiles: (relayFiles) => set({ relayFiles }),
  setEnvConflicts: (envConflicts) => set({ envConflicts }),
  setCcsProviders: (ccsProviders) => set({ ccsProviders }),
  setPendingProviderImport: (pending) => set({ pendingProviderImport: pending }),
}));

// ============== Sessions Store ==============

type SessionsState = {
  localSessions: LocalSessionsResult | null;
  setLocalSessions: (sessions: LocalSessionsResult | null) => void;
};

export const useSessionsStore = create<SessionsState>((set) => ({
  localSessions: null,
  setLocalSessions: (localSessions) => set({ localSessions }),
}));

// ============== Context Store (MCP/Skills/Plugins) ==============

type ContextState = {
  liveContextEntries: CodexContextEntries | null;
  setLiveContextEntries: (entries: CodexContextEntries | null) => void;
};

export const useContextStore = create<ContextState>((set) => ({
  liveContextEntries: null,
  setLiveContextEntries: (liveContextEntries) => set({ liveContextEntries }),
}));

// ============== Logs / Diagnostics Store ==============

type LogsState = {
  logs: LogsResult | null;
  diagnostics: DiagnosticsResult | null;
  watcher: WatcherResult | null;
  setLogs: (logs: LogsResult | null) => void;
  setDiagnostics: (diagnostics: DiagnosticsResult | null) => void;
  setWatcher: (watcher: WatcherResult | null) => void;
};

export const useLogsStore = create<LogsState>((set) => ({
  logs: null,
  diagnostics: null,
  watcher: null,
  setLogs: (logs) => set({ logs }),
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  setWatcher: (watcher) => set({ watcher }),
}));

// ============== Plugin Marketplace Store ==============

type PluginMarketplaceState = {
  localStatus: PluginMarketplaceStatusResult | null;
  remoteStatus: RemotePluginMarketplaceResult | null;
  setLocalStatus: (status: PluginMarketplaceStatusResult | null) => void;
  setRemoteStatus: (status: RemotePluginMarketplaceResult | null) => void;
};

export const usePluginMarketplaceStore = create<PluginMarketplaceState>((set) => ({
  localStatus: null,
  remoteStatus: null,
  setLocalStatus: (localStatus) => set({ localStatus }),
  setRemoteStatus: (remoteStatus) => set({ remoteStatus }),
}));

// ============== Script Market Store ==============

type ScriptMarketState = {
  market: ScriptMarketResult | null;
  setMarket: (market: ScriptMarketResult | null) => void;
};

export const useScriptMarketStore = create<ScriptMarketState>((set) => ({
  market: null,
  setMarket: (market) => set({ market }),
}));

// ============== Provider Sync Store ==============

type ProviderSyncState = {
  progress: {
    active: boolean;
    percent: number;
    message: string;
  };
  setProgress: (progress: ProviderSyncState["progress"]) => void;
};

export const useProviderSyncStore = create<ProviderSyncState>((set) => ({
  progress: { active: false, percent: 0, message: "" },
  setProgress: (progress) => set({ progress }),
}));
