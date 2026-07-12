// 检查与修复页 - Codex 应用路径、桌面快捷方式、Watcher、插件市场修复、启动 Codex
// 入口管理（install / uninstall / repair）+ Codex 应用路径选择 + 启动按钮

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  Button,
  Space,
  Typography,
  Tag,
  Spin,
  Alert,
  Row,
  Col,
  Input,
  message,
  Popconfirm,
  Tabs,
  Divider,
  Tooltip,
} from "antd";
import {
  ReloadOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  AppstoreAddOutlined,
  DeleteOutlined,
  ToolOutlined,
  SafetyOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import { api as tauri } from "@/lib/api";
import {
  useSettingsStore,
  useOverviewStore,
  useLogsStore,
  useUIStore,
} from "@/lib/store";
import type { BackendSettings } from "@/lib/types";
import { isSuccessStatus, stringifyError } from "@/lib/utils";

const { Title, Text, Paragraph } = Typography;

const pathStatusTag = (status?: string | null) => {
  if (!status) return <Tag>未知</Tag>;
  if (status === "ok") return <Tag color="green" icon={<CheckCircleOutlined />}>正常</Tag>;
  if (status === "not_found") return <Tag color="red" icon={<ExclamationCircleOutlined />}>未找到</Tag>;
  if (status === "not_configured") return <Tag>未配置</Tag>;
  return <Tag color="orange">{status}</Tag>;
};

export const Maintenance = () => {
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const overview = useOverviewStore((s) => s.overview);
  const setOverview = useOverviewStore((s) => s.setOverview);
  const watcher = useLogsStore((s) => s.watcher);
  const setWatcher = useLogsStore((s) => s.setWatcher);
  const setNotice = useUIStore((s) => s.setNotice);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [codexPath, setCodexPath] = useState<string>("");

  useEffect(() => {
    if (settings?.settings) {
      setCodexPath(settings.settings.codexAppPath ?? "");
    }
  }, [settings?.settings]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, o, w] = await Promise.all([
        tauri.loadSettings(),
        tauri.loadOverview(),
        tauri.loadWatcherState(),
      ]);
      if (s) setSettings(s);
      if (o) setOverview(o);
      if (w) setWatcher(w);
    } catch (e) {
      message.error(`加载失败：${stringifyError(e)}`);
    } finally {
      setLoading(false);
    }
  }, [setSettings, setOverview, setWatcher]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 保存 Codex 应用路径
  const handleSaveCodexPath = async () => {
    if (!settings?.settings) return;
    setBusy("save-codex-path");
    try {
      const next: BackendSettings = { ...settings.settings, codexAppPath: codexPath.trim() };
      const r = await tauri.saveSettings(next);
      if (r && isSuccessStatus(r.status)) {
        setSettings(r);
        message.success("已保存");
        await refresh();
      } else {
        message.error(`保存失败：${r?.message ?? "未知"}`);
      }
    } catch (e) {
      message.error(`保存失败：${stringifyError(e)}`);
    } finally {
      setBusy(null);
    }
  };

  // 选 Codex 应用
  // Web 模式下没有 Tauri 文件选择器，使用上方文本框手动输入路径。
  const handlePickCodexPath = () => {
    message.info("Web 模式下请在文本框中直接输入 Codex.app 路径");
  };

  // 入口管理
  const runEntrypoint = async (
    op: () => Promise<any>,
    label: string,
  ) => {
    setBusy(label);
    try {
      const r = await op();
      if (r && isSuccessStatus(r.status)) {
        message.success(`${label} 成功`);
        await refresh();
      } else {
        message.error(`${label} 失败：${r?.message ?? "未知"}`);
      }
    } catch (e) {
      message.error(`${label} 失败：${stringifyError(e)}`);
    } finally {
      setBusy(null);
    }
  };

  // Watcher
  const runWatcher = async (op: () => Promise<any>, label: string) => {
    setBusy(label);
    try {
      const r = await op();
      if (r) {
        setWatcher(r);
        if (isSuccessStatus(r.status)) {
          message.success(`${label} 成功`);
        } else {
          message.error(`${label} 失败：${r.message}`);
        }
      }
    } catch (e) {
      message.error(`${label} 失败：${stringifyError(e)}`);
    } finally {
      setBusy(null);
    }
  };

  // 启动 / 重启
  const handleLaunch = async (kind: "launch" | "restart") => {
    if (!settings?.settings) return;
    const args = settings.settings.launchArgs ?? "";
    const mode = settings.settings.launchMode ?? "patch";
    setBusy(kind);
    try {
      const op = kind === "launch" ? tauri.launchCodexPlus : tauri.restartCodexPlus;
      const r = await op({ args, mode });
      if (r && isSuccessStatus(r.status)) {
        message.success(kind === "launch" ? "已启动" : "已重启");
        await refresh();
      } else {
        message.error(`${kind === "launch" ? "启动" : "重启"}失败：${r?.message ?? "未知"}`);
      }
    } catch (e) {
      message.error(`${kind === "launch" ? "启动" : "重启"}失败：${stringifyError(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const codexApp = overview?.codex_app;
  const silentShortcut = overview?.silent_shortcut;
  const mgmtShortcut = overview?.management_shortcut;

  return (
    <Spin spinning={loading}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        {/* 顶栏 */}
        <Card>
          <Row align="middle" justify="space-between">
            <Col>
              <Title level={4} style={{ margin: 0 }}>
                <ToolOutlined /> 检查与修复
              </Title>
              <Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 4 }}>
                管理 Codex 应用路径、桌面快捷方式、Watcher、插件市场和启动行为。
              </Paragraph>
            </Col>
            <Col>
              <Button icon={<ReloadOutlined />} onClick={refresh}>
                刷新全部
              </Button>
            </Col>
          </Row>
        </Card>

        <Tabs
          defaultActiveKey="path"
          items={[
            // ============ Codex 应用路径 ============
            {
              key: "path",
              label: (
                <Space>
                  <FolderOpenOutlined />
                  Codex 应用路径
                </Space>
              ),
              children: (
                <Card>
                  <Row gutter={16} align="middle">
                    <Col flex="auto">
                      <Text type="secondary">当前路径</Text>
                      <Input
                        value={codexPath}
                        onChange={(e) => setCodexPath(e.target.value)}
                        placeholder="留空将使用默认路径"
                        suffix={pathStatusTag(codexApp?.status)}
                        style={{ marginTop: 4 }}
                      />
                    </Col>
                    <Col flex="none">
                      <Space>
                        <Button icon={<FolderOpenOutlined />} onClick={handlePickCodexPath}>
                          选择…
                        </Button>
                        <Button
                          type="primary"
                          onClick={handleSaveCodexPath}
                          loading={busy === "save-codex-path"}
                          disabled={codexPath === (settings?.settings?.codexAppPath ?? "")}
                        >
                          保存
                        </Button>
                      </Space>
                    </Col>
                  </Row>
                  <Divider />
                  <Row gutter={16}>
                    <Col span={8}>
                      <Text type="secondary">检测状态</Text>
                      <div style={{ marginTop: 4 }}>
                        {codexApp?.path ? (
                          <Tooltip title={codexApp.path}>
                            <Text code style={{ fontSize: 12 }}>
                              {codexApp.path}
                            </Text>
                          </Tooltip>
                        ) : (
                          <Text type="secondary">未设置</Text>
                        )}
                      </div>
                    </Col>
                    <Col span={8}>
                      <Text type="secondary">Codex 版本</Text>
                      <div style={{ marginTop: 4 }}>
                        <Text>{overview?.codex_version ?? "未检测到"}</Text>
                      </div>
                    </Col>
                    <Col span={8}>
                      <Text type="secondary">当前</Text>
                      <div style={{ marginTop: 4 }}>{pathStatusTag(codexApp?.status)}</div>
                    </Col>
                  </Row>
                </Card>
              ),
            },
            // ============ 桌面快捷方式 ============
            {
              key: "shortcuts",
              label: (
                <Space>
                  <LinkOutlined />
                  桌面快捷方式
                </Space>
              ),
              children: (
                <Card>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Text strong>静默启动入口</Text>
                      <div style={{ marginTop: 8 }}>
                        {pathStatusTag(silentShortcut?.status)}
                      </div>
                      {silentShortcut?.path && (
                        <Tooltip title={silentShortcut.path}>
                          <Text code style={{ fontSize: 11, display: "block", marginTop: 4 }}>
                            {silentShortcut.path}
                          </Text>
                        </Tooltip>
                      )}
                    </Col>
                    <Col span={12}>
                      <Text strong>管理界面入口</Text>
                      <div style={{ marginTop: 8 }}>{pathStatusTag(mgmtShortcut?.status)}</div>
                      {mgmtShortcut?.path && (
                        <Tooltip title={mgmtShortcut.path}>
                          <Text code style={{ fontSize: 11, display: "block", marginTop: 4 }}>
                            {mgmtShortcut.path}
                          </Text>
                        </Tooltip>
                      )}
                    </Col>
                  </Row>
                  <Divider />
                  <Space wrap>
                    <Button
                      type="primary"
                      icon={<AppstoreAddOutlined />}
                      loading={busy === "安装入口"}
                      onClick={() =>
                        runEntrypoint(() => tauri.installEntrypoints(), "安装入口")
                      }
                    >
                      安装
                    </Button>
                    <Popconfirm
                      title="卸载入口？"
                      description="将同时移除两个桌面入口"
                      okText="卸载"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() =>
                        runEntrypoint(
                          () =>
                            tauri.uninstallEntrypoints({
                              silentShortcut: true,
                              managementShortcut: true,
                            }),
                          "卸载入口",
                        )
                      }
                    >
                      <Button
                        icon={<DeleteOutlined />}
                        loading={busy === "卸载入口"}
                        danger
                      >
                        全部卸载
                      </Button>
                    </Popconfirm>
                    <Button
                      icon={<ToolOutlined />}
                      loading={busy === "修复入口"}
                      onClick={() => runEntrypoint(() => tauri.repairShortcuts(), "修复入口")}
                    >
                      修复
                    </Button>
                  </Space>
                </Card>
              ),
            },
            // ============ Watcher ============
            {
              key: "watcher",
              label: (
                <Space>
                  <EyeOutlined />
                  Watcher
                </Space>
              ),
              children: (
                <Card>
                  <Row align="middle" justify="space-between">
                    <Col>
                      <Space direction="vertical" size={4}>
                        <Space>
                          <Text strong>当前状态</Text>
                          {watcher?.enabled ? (
                            <Tag color="green" icon={<CheckCircleOutlined />}>已启用</Tag>
                          ) : (
                            <Tag>未启用</Tag>
                          )}
                        </Space>
                        {watcher?.disabled_flag && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            禁用标记：<Text code style={{ fontSize: 11 }}>{watcher.disabled_flag}</Text>
                          </Text>
                        )}
                      </Space>
                    </Col>
                    <Col>
                      <Space wrap>
                        {watcher?.enabled ? (
                          <Button
                            onClick={() => runWatcher(() => tauri.disableWatcher(), "禁用 Watcher")}
                            loading={busy === "禁用 Watcher"}
                          >
                            禁用
                          </Button>
                        ) : (
                          <Button
                            type="primary"
                            onClick={() => runWatcher(() => tauri.enableWatcher(), "启用 Watcher")}
                            loading={busy === "启用 Watcher"}
                          >
                            启用
                          </Button>
                        )}
                        <Button
                          onClick={() => runWatcher(() => tauri.installWatcher(), "安装 Watcher")}
                          loading={busy === "安装 Watcher"}
                        >
                          重新安装
                        </Button>
                        <Popconfirm
                          title="卸载 Watcher？"
                          okText="卸载"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                          onConfirm={() =>
                            runWatcher(() => tauri.uninstallWatcher(), "卸载 Watcher")
                          }
                        >
                          <Button danger loading={busy === "卸载 Watcher"}>
                            卸载
                          </Button>
                        </Popconfirm>
                      </Space>
                    </Col>
                  </Row>
                  <Divider />
                  <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
                    Watcher 监听 Codex 配置文件改动，变化时自动同步，避免重启后失效。
                  </Paragraph>
                </Card>
              ),
            },
            // ============ 插件市场 ============
            {
              key: "marketplace",
              label: (
                <Space>
                  <SafetyOutlined />
                  插件市场
                </Space>
              ),
              children: <MarketplacePanel setNotice={setNotice} />,
            },
            // ============ 启动 Codex ============
            {
              key: "launch",
              label: (
                <Space>
                  <PlayCircleOutlined />
                  启动 Codex
                </Space>
              ),
              children: (
                <Card>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Text type="secondary">最近启动</Text>
                      <div style={{ marginTop: 4 }}>
                        <Text>{overview?.latest_launch?.message ?? "无记录"}</Text>
                      </div>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">当前参数</Text>
                      <div style={{ marginTop: 4 }}>
                        <Text code style={{ fontSize: 11 }}>
                          {settings?.settings?.launchArgs || "(无)"}
                        </Text>
                      </div>
                    </Col>
                  </Row>
                  <Divider />
                  <Space>
                    <Button
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      onClick={() => handleLaunch("launch")}
                      loading={busy === "launch"}
                    >
                      启动
                    </Button>
                    <Button
                      icon={<PoweroffOutlined />}
                      onClick={() => handleLaunch("restart")}
                      loading={busy === "restart"}
                    >
                      重启
                    </Button>
                  </Space>
                  <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
                    启动参数在「增强与守护」页的「启动参数」中设置。
                  </Paragraph>
                </Card>
              ),
            },
          ]}
        />
      </Space>
    </Spin>
  );
};

// 插件市场子组件 - 独立管理自己的状态
const MarketplacePanel = ({
  setNotice,
}: {
  setNotice: (n: { title: string; message: string; status?: string } | null) => void;
}) => {
  const [loading, setLoading] = useState(false);
  const [localStatus, setLocalStatus] = useState<any>(null);
  const [remoteStatus, setRemoteStatus] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [l, r] = await Promise.all([
        tauri.pluginMarketplaceStatus(),
        tauri.remotePluginMarketplaceStatus(),
      ]);
      setLocalStatus(l);
      setRemoteStatus(r);
    } catch (e) {
      message.error(`加载失败：${stringifyError(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRepair = async (kind: "local" | "remote") => {
    setBusy(`repair-${kind}`);
    try {
      const op = kind === "local" ? tauri.repairPluginMarketplace : tauri.repairRemotePluginMarketplace;
      const r = await op();
      if (r && isSuccessStatus(r.status)) {
        // PluginMarketplaceRepairResult 有 usedPath，RemotePluginMarketplaceResult 没有
        const usedPath = "usedPath" in r ? r.usedPath : null;
        setNotice({
          title: `${kind === "local" ? "本地" : "远程"}插件市场修复成功`,
          message: usedPath ? `已切换到：${usedPath}` : r.message || "已完成",
          status: "ok",
        });
        await refresh();
      } else {
        message.error(`修复失败：${r?.message ?? "未知"}`);
      }
    } catch (e) {
      message.error(`修复失败：${stringifyError(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const renderPanel = (
    title: string,
    status: any,
    kind: "local" | "remote",
  ) => (
    <Card title={title} extra={pathStatusTag(status?.status)}>
      {status?.message && (
        <Alert
          style={{ marginBottom: 12 }}
          type={isSuccessStatus(status.status) ? "success" : "warning"}
          showIcon
          message={status.message}
        />
      )}
      <Row gutter={16}>
        <Col span={12}>
          <Text type="secondary">当前活动路径</Text>
          <div style={{ marginTop: 4 }}>
            {status?.activePath ? (
              <Text code style={{ fontSize: 11 }}>
                {status.activePath}
              </Text>
            ) : (
              <Text type="secondary">未配置</Text>
            )}
          </div>
        </Col>
        <Col span={12}>
          <Text type="secondary">可用路径数</Text>
          <div style={{ marginTop: 4 }}>
            <Text>{status?.availablePaths?.length ?? 0}</Text>
          </div>
        </Col>
      </Row>
      {status?.availablePaths && status.availablePaths.length > 0 && (
        <>
          <Divider style={{ margin: "12px 0" }} />
          <Text type="secondary" style={{ fontSize: 11 }}>所有候选路径：</Text>
          <div style={{ marginTop: 4 }}>
            {status.availablePaths.map((p: string) => (
              <div key={p}>
                <Text code style={{ fontSize: 11 }}>{p}</Text>
              </div>
            ))}
          </div>
        </>
      )}
      <Divider />
      <Button
        type="primary"
        icon={<ToolOutlined />}
        disabled={!status?.canRepair}
        loading={busy === `repair-${kind}`}
        onClick={() => handleRepair(kind)}
      >
        修复
      </Button>
    </Card>
  );

  return (
    <Spin spinning={loading}>
      <Row gutter={16}>
        <Col span={12}>{renderPanel("本地插件市场", localStatus, "local")}</Col>
        <Col span={12}>{renderPanel("远程插件市场", remoteStatus, "remote")}</Col>
      </Row>
    </Spin>
  );
};
