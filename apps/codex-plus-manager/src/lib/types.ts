// 全部 Tauri command 类型定义
// 与 apps/codex-plus-manager/src-tauri/src/commands.rs 保持同步

export type Status = "ok" | "failed" | "not_implemented" | "not_checked" | string;

export type CommandResult<T> = T & {
  status: Status;
  message: string;
};

export type PathState = {
  status: string;
  path: string | null;
};

export type LaunchStatus = {
  started_at_ms: number | null;
  mode: string | null;
  status: string;
  message: string;
};

export type OverviewResult = CommandResult<{
  codex_app: PathState;
  codex_version: string | null;
  silent_shortcut: PathState;
  management_shortcut: PathState;
  latest_launch: LaunchStatus | null;
  current_version: string;
  settings_path: string;
  logs_path: string;
}>;

export type RelayResult = CommandResult<{
  authenticated: boolean;
  authSource: string;
  accountLabel: string | null;
  configPath: string;
  configured: boolean;
  requiresOpenaiAuth: boolean;
  hasBearerToken: boolean;
  backupPath: string | null;
}>;

export type RelayFilesResult = CommandResult<{
  configPath: string;
  authPath: string;
  configContents: string;
  authContents: string;
}>;

export type PluginMarketplaceRepairResult = CommandResult<{
  status: string;
  message: string;
  attemptedPaths: string[];
  usedPath: string | null;
}>;

export type PluginMarketplaceStatusResult = CommandResult<{
  status: string;
  message: string;
  activePath: string | null;
  availablePaths: string[];
  canRepair: boolean;
}>;

export type RemotePluginMarketplaceResult = CommandResult<{
  status: string;
  message: string;
  activePath: string | null;
  availablePaths: string[];
  canRepair: boolean;
}>;

export type ProviderSyncPayload = {
  changedSessionFiles: number;
  sqliteRowsUpdated: number;
  skippedLockedRolloutFiles: string[];
  targetProvider: string;
  configWritten: boolean;
  authWritten: boolean;
};

export type ProviderSyncTargetSource = "config" | "rollout" | "sqlite" | "manual";

export type ProviderSyncTargetOption = {
  id: string;
  label: string;
  source: ProviderSyncTargetSource;
  detail: string;
  recommended: boolean;
  available: boolean;
};

export type ProviderSyncTargetsPayload = {
  configPath: string;
  authPath: string;
  recommendedTargetId: string;
  targets: ProviderSyncTargetOption[];
};

export type ProviderSyncProgress = {
  percent: number;
  message: string;
  result: CommandResult<ProviderSyncPayload> | null;
};

export type LogsResult = CommandResult<{
  path: string;
  text: string;
  lines: number;
}>;

export type DiagnosticsResult = CommandResult<{
  report: string;
}>;

export type WatcherResult = CommandResult<{
  enabled: boolean;
  disabled_flag: string;
}>;

export type InstallResult = CommandResult<{
  silent_shortcut: { installed: boolean; path: string | null };
  management_shortcut: { installed: boolean; path: string | null };
}>;

// ============== Settings / Backend Settings ==============

export type CodexContextEntry = {
  enabled: boolean;
  name?: string;
  path?: string;
  // MCP 字段
  url?: string;
  bearerTokenEnvVar?: string;
  // Skill 字段
  skillPath?: string;
  // Plugin 字段
  marketplacePath?: string;
};

export type CodexContextEntries = {
  mcp_servers: Record<string, CodexContextEntry>;
  skills: Record<string, CodexContextEntry>;
  plugins: Record<string, CodexContextEntry>;
};

export type RelayMode = "official" | "mixedApi" | "pureApi" | "aggregate";
export type RelayProtocol = "responses" | "chatCompletions";
export type ImageOverlayFitMode = "fill" | "fit" | "stretch" | "tile" | "center";
export type ZedOpenStrategy =
  | "addToFocusedWorkspace"
  | "reuseWindow"
  | "newWindow"
  | "default";
export type LaunchMode = "patch" | "relay";

export type RelayAggregateMember = {
  name: string;
  weight: number;
};

export type RelayAggregateConfig = {
  strategy: "failover" | "roundRobin" | "weightedRoundRobin";
  members: RelayAggregateMember[];
};

export type AggregateRelayMember = {
  name: string;
  baseUrl: string;
  protocol: RelayProtocol;
  model: string;
  weight: number;
};

export type AggregateRelayProfile = {
  strategy: "failover" | "roundRobin" | "weightedRoundRobin";
  members: AggregateRelayMember[];
};

export type RelayContextSelection = {
  mcp_servers: string[];
  skills: string[];
  plugins: string[];
};

export type ContextKind = "mcp" | "skill" | "plugin";

export type RelayProfile = {
  id: string;
  name: string;
  model: string;
  baseUrl: string;
  upstreamBaseUrl: string;
  apiKey: string;
  protocol: RelayProtocol;
  relayMode: RelayMode;
  officialMixApiKey: boolean;
  testModel: string;
  configContents: string;
  authContents: string;
  useCommonConfig: boolean;
  contextWindow: string;
  modelWindows: string;
  imageOverlay: {
    enabled: boolean;
    fit: ImageOverlayFitMode;
    opacity: number;
  };
  step?: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  contextSelection: RelayContextSelection;
  aggregate?: AggregateRelayProfile;
  // 增强
  isAggregate: boolean;
  // 状态
  enabled: boolean;
};

export type BackendSettings = {
  codexAppPath: string;
  codexAppPathStatus: string;
  codexGoalsEnabled: boolean;
  providerSyncEnabled: boolean;
  cliWrapperEnabled: boolean;
  cliWrapperBaseUrl: string;
  cliWrapperApiKey: string;
  cliWrapperApiKeyEnv: string;
  cliWrapperModel: string;
  // Codex 增强开关
  codexAppPasteFix: boolean;
  codexAppStepwiseEnabled: boolean;
  codexAppForceChineseLocale: boolean;
  codexAppFastStartup: boolean;
  codexAppNativeMenuLocalization: boolean;
  codexAppImageOverlayEnabled: boolean;
  codexAppComputerUseGuard: boolean;
  // Zed 远程
  zedRemoteOpenStrategy: ZedOpenStrategy;
  // 启动参数
  launchArgs: string;
  launchMode: LaunchMode;
  // 镜像覆盖层
  imageOverlay: {
    enabled: boolean;
    fit: ImageOverlayFitMode;
    opacity: number;
  };
  // Relay
  relayProfiles: RelayProfile[];
  relayProfilesEnabled: boolean;
  activeRelayProfileId: string | null;
  relayContextSelection: RelayContextSelection;
  // 脚本
  userScripts: {
    enabled: boolean;
    installed: Record<string, { enabled: boolean; path: string; source: string }>;
  };
};

export type UserScriptInventory = {
  enabled: boolean;
  installed: Record<string, { enabled: boolean; path: string; source: string }>;
};

export type ScriptMarketItem = {
  id: string;
  name: string;
  description: string;
  author: string;
  tags: string[];
  url: string;
  size: number;
  updatedAt: string;
  installed: boolean;
  enabled: boolean;
};

export type ScriptMarketResult = CommandResult<{
  market: {
    status: string;
    message: string;
    indexUrl: string;
    updatedAt: string;
    scripts: ScriptMarketItem[];
  };
  user_scripts: UserScriptInventory;
}>;

export type SettingsResult = CommandResult<{
  settings: BackendSettings;
  settingsPath: string;
}>;

export type SettingsBackfillResult = CommandResult<{
  settings: BackendSettings;
}>;

// ============== Sessions ==============

export type LocalSession = {
  id: string;
  title: string;
  cwd: string;
  modelProvider: string;
  archived: boolean;
  updatedAtMs: number | null;
  rolloutPath: string;
  dbPath: string;
};

export type LocalSessionsResult = CommandResult<{
  dbPath: string;
  dbPaths: string[];
  sessions: LocalSession[];
}>;

export type DeleteLocalSessionResult = CommandResult<{
  status: string;
  session_id: string;
  message: string;
  undo_token: string | null;
  backup_path: string | null;
}>;

// ============== Zed Remote ==============

export type ZedRemoteProject = {
  id: string;
  label: string;
  hostId: string;
  ssh: {
    user: string;
    host: string;
    port: number | null;
  };
  path: string;
  url: string;
  source: string;
  lastOpenedAtMs: number | null;
  isCurrent: boolean;
};

export type ZedRemoteProjectsResult = CommandResult<{
  projects: ZedRemoteProject[];
}>;

export type ZedRemoteOpenResult = CommandResult<{
  url: string;
  strategy: ZedOpenStrategy;
}>;

// ============== Context Entries ==============

export type ContextEntriesResult = CommandResult<{
  settings: BackendSettings;
  entries: CodexContextEntries;
}>;

export type LiveContextEntriesResult = CommandResult<{
  entries: CodexContextEntries;
}>;

// ============== Relay Profile Test/Models ==============

export type ExtractRelayCommonConfigResult = CommandResult<{
  commonConfigContents: string;
  profileConfigContents: string;
}>;

export type RelaySwitchResult = CommandResult<{
  settings: BackendSettings;
  settingsPath: string;
  user_scripts: unknown;
  relay: {
    authenticated: boolean;
    authSource: string;
    accountLabel: string | null;
    configPath: string;
    configured: boolean;
    requiresOpenaiAuth: boolean;
    hasBearerToken: boolean;
    backupPath: string | null;
  };
}>;

export type RelayProfileTestResult = CommandResult<{
  httpStatus: number;
  endpoint: string;
  responsePreview: string;
}>;

export type StepwiseTestResult = CommandResult<{
  itemCount: number;
  error: string;
}>;

export type RelayProfileModelsResult = CommandResult<{
  models: string[];
  endpoint: string;
}>;

// ============== Provider Import ==============

export type ProviderDoctorCheck = {
  id: string;
  title: string;
  status: Status;
  detail: string;
};

export type ProviderDoctorResult = CommandResult<{
  profileName: string;
  model: string;
  summary: string;
  recommendation: string;
  checks: ProviderDoctorCheck[];
}>;

export type CcsProviderImport = {
  sourceId: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  protocol: RelayProtocol;
  configContents: string;
  authContents: string;
};

export type CcsProvidersResult = CommandResult<{
  dbPath: string;
  providers: CcsProviderImport[];
}>;

export type ProviderImportRequest = {
  name: string;
  baseUrl: string;
  apiKey: string;
  wireApi: string;
  relayMode: string;
  configContents: string;
  authContents: string;
};

export type PendingProviderImportResult = CommandResult<{
  pending: ProviderImportRequest | null;
}>;

// ============== Env Conflict ==============

export type EnvConflict = {
  name: string;
  source: "process" | "user" | string;
  valuePresent: boolean;
};

export type EnvConflictsResult = CommandResult<{
  conflicts: EnvConflict[];
}>;

export type RemoveEnvConflictsResult = CommandResult<{
  removed: Array<{
    name: string;
    source: string;
  }>;
}>;

// ============== Theme ==============

export type Theme = "dark" | "light";

export type Route =
  | "overview"
  | "relay"
  | "enhance"
  | "zed-remote"
  | "user-scripts"
  | "sessions"
  | "maintenance"
  | "about";
