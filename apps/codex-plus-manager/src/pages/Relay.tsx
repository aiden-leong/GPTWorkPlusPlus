// 供应商配置页 - 主入口
// Profile 列表、拖动排序、编辑、CC-switch 导入、Env 冲突、Context 管理、文件编辑

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Tabs,
  Button,
  Space,
  Typography,
  Switch,
  Alert,
  Tag,
  message,
  Spin,
  Result,
  Row,
  Col,
} from "antd";
import {
  PlusOutlined,
  ImportOutlined,
  ReloadOutlined,
  ApiOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import { api as tauri } from "@/lib/api";
import {
  useSettingsStore,
  useRelayStore,
} from "@/lib/store";
import type { RelayProfile, BackendSettings } from "@/lib/types";
import { isSuccessStatus } from "@/lib/utils";
import { RelayProfileEditor } from "@/components/RelayProfileEditor";
import { RelayProfileList } from "@/components/RelayProfileList";
import { RelayContextManager } from "@/components/RelayContextManager";
import { RelayFileEditors } from "@/components/RelayFileEditors";
import { globalConfirm } from "@/components/ConfirmManager";

const { Text, Paragraph } = Typography;

const createEmptyProfile = (): RelayProfile => ({
  id: "profile-" + Math.random().toString(36).slice(2, 10),
  name: "",
  model: "",
  baseUrl: "",
  upstreamBaseUrl: "",
  apiKey: "",
  protocol: "responses",
  relayMode: "pureApi",
  officialMixApiKey: false,
  testModel: "",
  configContents: "",
  authContents: "",
  useCommonConfig: true,
  contextSelection: { mcpServers: [], skills: [], plugins: [] },
  contextSelectionInitialized: false,
  contextWindow: "",
  autoCompactLimit: "",
  modelInsertMode: "append",
  modelList: "",
  modelWindows: "",
  userAgent: "",
  enabled: true,
});

export const Relay = () => {
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const relay = useRelayStore((s) => s.relay);
  const setRelay = useRelayStore((s) => s.setRelay);
  const envConflicts = useRelayStore((s) => s.envConflicts);
  const setEnvConflicts = useRelayStore((s) => s.setEnvConflicts);
  const ccsProviders = useRelayStore((s) => s.ccsProviders);
  const setCcsProviders = useRelayStore((s) => s.setCcsProviders);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<RelayProfile | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r, env] = await Promise.all([
        tauri.loadSettings(),
        tauri.relayStatus(),
        tauri.checkEnvConflicts(),
      ]);
      if (s) setSettings(s);
      if (r) setRelay(r);
      if (env) setEnvConflicts(env);
    } finally {
      setLoading(false);
    }
  }, [setSettings, setRelay, setEnvConflicts]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const profiles = settings?.settings?.relayProfiles ?? [];
  const activeId = settings?.settings?.activeRelayProfileId ?? null;
  const profilesEnabled = settings?.settings?.relayProfilesEnabled ?? false;

  // 新增
  const handleNew = () => {
    setEditingProfile(createEmptyProfile());
    setIsNew(true);
    setEditorOpen(true);
  };

  // 编辑
  const handleEdit = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setEditingProfile(p);
    setIsNew(false);
    setEditorOpen(true);
  };

  // 启用
  const handleSwitch = async (id: string) => {
    if (!settings?.settings) return;
    const r = await tauri.switchRelayProfile({ profileId: id });
    if (r && isSuccessStatus(r.status)) {
      message.success("已切换");
      if (r.settings) {
        setSettings({ ...settings, settings: r.settings });
      }
      await refresh();
    } else {
      message.error(`切换失败：${r?.message ?? "未知"}`);
    }
  };

  // 测试
  const handleTest = async (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    const r = await tauri.testRelayProfile(p);
    if (r) {
      if (r.httpStatus > 0 && r.httpStatus < 400) {
        message.success(`${p.name}：连接成功 (HTTP ${r.httpStatus})`);
      } else {
        message.error(`${p.name}：连接失败 - ${r.message || r.responsePreview || "HTTP " + r.httpStatus}`);
      }
    }
  };

  // 排序
  const handleReorder = async (newOrder: RelayProfile[]) => {
    if (!settings?.settings) return;
    const next: BackendSettings = { ...settings.settings, relayProfiles: newOrder };
    const r = await tauri.saveSettings(next);
    if (r && isSuccessStatus(r.status)) {
      setSettings(r);
      message.success("顺序已保存");
    }
  };

  // 总开关
  const handleToggleEnabled = async (checked: boolean) => {
    if (!settings?.settings) return;
    const next: BackendSettings = { ...settings.settings, relayProfilesEnabled: checked };
    const r = await tauri.saveSettings(next);
    if (r && isSuccessStatus(r.status)) {
      setSettings(r);
      message.success(checked ? "已启用供应商配置" : "已禁用供应商配置");
    }
  };

  // CC-switch 导入
  const handleImportCcs = async () => {
    if (!ccsProviders) {
      const r = await tauri.loadCcsProviders();
      if (r) setCcsProviders(r);
    }
    const list = await tauri.loadCcsProviders();
    if (!list || list.providers.length === 0) {
      message.info("未发现可导入的 cc-switch 供应商");
      return;
    }
    const ok = await globalConfirm({
      title: "导入 cc-switch 供应商",
      message: `将导入 ${list.providers.length} 个供应商配置。`,
    });
    if (!ok) return;
    const r = await tauri.importCcsProviders();
    if (r && isSuccessStatus(r.status)) {
      message.success("导入成功");
      await refresh();
    } else {
      message.error(`导入失败：${r?.message ?? "未知"}`);
    }
  };

  // Env 冲突清理
  const handleRemoveEnvConflicts = async (names: string[]) => {
    const ok = await globalConfirm({
      title: "清理环境变量",
      message: `将删除以下 OPENAI 环境变量：\n${names.join(", ")}`,
    });
    if (!ok) return;
    const r = await tauri.removeEnvConflicts({ names });
    if (r && isSuccessStatus(r.status)) {
      message.success(`已清理 ${r.removed?.length ?? 0} 个环境变量`);
      await refresh();
    } else {
      message.error("清理失败");
    }
  };

  const handleEditorSaved = async () => {
    setEditorOpen(false);
    setEditingProfile(null);
    await refresh();
  };

  return (
    <Spin spinning={loading}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        {/* Relay 状态 */}
        <Card
          title={
            <Space>
              <ApiOutlined />
              供应商配置总开关
            </Space>
          }
          extra={
            <Space>
              <Switch
                checked={profilesEnabled}
                onChange={handleToggleEnabled}
                checkedChildren="启用"
                unCheckedChildren="禁用"
              />
              <Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
            </Space>
          }
        >
          <Row gutter={16}>
            <Col span={6}>
              <Text type="secondary">认证状态</Text>
              <div>
                {relay?.authenticated ? (
                  <Tag icon={<CheckCircleOutlined />} color="success">已认证</Tag>
                ) : (
                  <Tag icon={<ExclamationCircleOutlined />} color="warning">未认证</Tag>
                )}
              </div>
            </Col>
            <Col span={6}>
              <Text type="secondary">认证来源</Text>
              <div><Text code>{relay?.authSource ?? "—"}</Text></div>
            </Col>
            <Col span={6}>
              <Text type="secondary">账号</Text>
              <div><Text>{relay?.accountLabel ?? "—"}</Text></div>
            </Col>
            <Col span={6}>
              <Text type="secondary">当前启用</Text>
              <div>
                {activeId ? (
                  <Tag color="blue">{profiles.find((p) => p.id === activeId)?.name ?? activeId}</Tag>
                ) : (
                  <Text type="secondary">未启用</Text>
                )}
              </div>
            </Col>
          </Row>
          {relay?.configPath && (
            <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
              config: <Text code>{relay.configPath}</Text>
            </Paragraph>
          )}
        </Card>

        {/* Env 冲突警告 */}
        {envConflicts && envConflicts.conflicts.length > 0 && (
          <Alert
            type="error"
            showIcon
            message="检测到覆盖供应商配置的 OPENAI 环境变量"
            description={
              <Space direction="vertical" style={{ width: "100%" }}>
                <Space wrap>
                  {envConflicts.conflicts.map((c) => (
                    <Tag color="red" key={c.name}>
                      {c.name} ({c.source})
                    </Tag>
                  ))}
                </Space>
                <Button
                  size="small"
                  type="primary"
                  danger
                  onClick={() => handleRemoveEnvConflicts(envConflicts.conflicts.map((c) => c.name))}
                >
                  清理这些环境变量
                </Button>
              </Space>
            }
          />
        )}

        <Tabs
          items={[
            {
              key: "profiles",
              label: "供应商列表",
              children: (
                <Card
                  title={`供应商列表（${profiles.length} 个）`}
                  extra={
                    <Space>
                      <Button icon={<ImportOutlined />} onClick={handleImportCcs}>
                        从 cc-switch 导入
                      </Button>
                      <Button type="primary" icon={<PlusOutlined />} onClick={handleNew}>
                        新增供应商
                      </Button>
                    </Space>
                  }
                >
                  {profiles.length === 0 ? (
                    <Result
                      status="info"
                      title="还没有配置任何供应商"
                      subTitle='点击右上角"新增供应商"开始'
                    />
                  ) : (
                    <RelayProfileList
                      profiles={profiles}
                      activeId={activeId}
                      onReorder={handleReorder}
                      onEdit={handleEdit}
                      onSwitch={handleSwitch}
                      onTest={handleTest}
                    />
                  )}
                </Card>
              ),
            },
            {
              key: "context",
              label: "工具与插件",
              children: <RelayContextManager />,
            },
            {
              key: "files",
              label: (
                <Space>
                  <FileTextOutlined />
                  配置文件
                </Space>
              ),
              children: <RelayFileEditors />,
            },
          ]}
        />
      </Space>

      <RelayProfileEditor
        open={editorOpen}
        profile={editingProfile}
        isNew={isNew}
        onClose={() => {
          setEditorOpen(false);
          setEditingProfile(null);
        }}
        onSaved={handleEditorSaved}
      />
    </Spin>
  );
};
