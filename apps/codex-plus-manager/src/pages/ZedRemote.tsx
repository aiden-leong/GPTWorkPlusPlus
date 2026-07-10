// Zed 远程项目页 - 列表 + 打开策略 + 打开/忘记
// 数据来自 Codex 的发现（list_zed_remote_projects），打开调用 open_zed_remote

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  Space,
  Typography,
  Button,
  Tag,
  Empty,
  List,
  Select,
  Spin,
  Alert,
  Popconfirm,
  Tooltip,
  message,
  Row,
  Col,
} from "antd";
import {
  ReloadOutlined,
  LinkOutlined,
  DeleteOutlined,
  CodeOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import { api as tauri } from "@/lib/api";
import { useSettingsStore, useZedRemoteStore } from "@/lib/store";
import type { BackendSettings, ZedOpenStrategy, ZedRemoteProject } from "@/lib/types";
import { formatTime, isSuccessStatus, stringifyError } from "@/lib/utils";

const { Text, Paragraph } = Typography;

const STRATEGY_OPTIONS: { value: ZedOpenStrategy; label: string; hint: string }[] = [
  {
    value: "addToFocusedWorkspace",
    label: "添加到当前工作区",
    hint: "在当前 Zed 工作区中新增一个 pane",
  },
  { value: "reuseWindow", label: "复用窗口", hint: "在已有 Zed 窗口中打开" },
  { value: "newWindow", label: "新窗口", hint: "为本次打开启动新 Zed 窗口" },
  { value: "default", label: "默认（按 Zed 自身行为）", hint: "Zed 自己决定如何打开" },
];

export const ZedRemote = () => {
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const projects = useZedRemoteStore((s) => s.zedRemoteProjects);
  const setProjects = useZedRemoteStore((s) => s.setZedRemoteProjects);

  const [loading, setLoading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [savingStrategy, setSavingStrategy] = useState(false);
  const [draftStrategy, setDraftStrategy] = useState<ZedOpenStrategy | null>(null);

  useEffect(() => {
    if (settings?.settings) {
      setDraftStrategy(settings.settings.zedRemoteOpenStrategy);
    }
  }, [settings?.settings]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await tauri.listZedRemoteProjects();
      if (r && isSuccessStatus(r.status)) {
        setProjects(r);
      } else {
        message.error(`加载失败：${r?.message ?? "未知"}`);
      }
    } catch (e) {
      message.error(`加载失败：${stringifyError(e)}`);
    } finally {
      setLoading(false);
    }
  }, [setProjects]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 切换策略
  const handleStrategyChange = async (value: ZedOpenStrategy) => {
    if (!settings?.settings) return;
    setDraftStrategy(value);
    setSavingStrategy(true);
    try {
      const next: BackendSettings = { ...settings.settings, zedRemoteOpenStrategy: value };
      const r = await tauri.saveSettings(next);
      if (r && isSuccessStatus(r.status)) {
        setSettings(r);
        message.success("已保存打开策略");
      } else {
        message.error(`保存失败：${r?.message ?? "未知"}`);
        // 回滚
        setDraftStrategy(settings.settings.zedRemoteOpenStrategy);
      }
    } catch (e) {
      message.error(`保存失败：${stringifyError(e)}`);
      setDraftStrategy(settings.settings.zedRemoteOpenStrategy);
    } finally {
      setSavingStrategy(false);
    }
  };

  // 打开
  const handleOpen = async (project: ZedRemoteProject) => {
    if (!settings?.settings) return;
    const strategy = settings.settings.zedRemoteOpenStrategy;
    setOpeningId(project.id);
    try {
      const r = await tauri.openZedRemote({ project, strategy });
      if (r && isSuccessStatus(r.status)) {
        message.success(`已请求打开 ${project.label}`);
        await refresh();
      } else {
        message.error(`打开失败：${r?.message ?? "未知"}`);
      }
    } catch (e) {
      message.error(`打开失败：${stringifyError(e)}`);
    } finally {
      setOpeningId(null);
    }
  };

  // 忘记
  const handleForget = async (id: string) => {
    try {
      const r = await tauri.forgetZedRemoteProject(id);
      if (r && isSuccessStatus(r.status)) {
        message.success("已忘记项目");
        await refresh();
      } else {
        message.error(`操作失败：${r?.message ?? "未知"}`);
      }
    } catch (e) {
      message.error(`操作失败：${stringifyError(e)}`);
    }
  };

  const projectList: ZedRemoteProject[] = projects?.projects ?? [];
  const strategyDirty =
    draftStrategy !== null && settings?.settings && draftStrategy !== settings.settings.zedRemoteOpenStrategy;

  return (
    <Spin spinning={loading}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        {/* 打开策略 */}
        <Card
          title={
            <Space>
              <CodeOutlined />
              Zed 远程打开策略
            </Space>
          }
          extra={
            strategyDirty ? <Tag color="orange">有未保存的修改</Tag> : <Tag color="green">已同步</Tag>
          }
        >
          <Row gutter={16} align="middle">
            <Col span={8}>
              <Text type="secondary">打开方式</Text>
              <Select
                value={draftStrategy ?? "default"}
                onChange={handleStrategyChange}
                options={STRATEGY_OPTIONS}
                loading={savingStrategy}
                style={{ width: "100%", marginTop: 4 }}
              />
            </Col>
            <Col span={16}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {STRATEGY_OPTIONS.find((o) => o.value === draftStrategy)?.hint ?? "—"}
              </Text>
            </Col>
          </Row>
          <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
            策略在点击「打开」时生效；切换会立即保存到 settings。
          </Paragraph>
        </Card>

        {/* 项目列表 */}
        <Card
          title={`发现的远程项目（${projectList.length}）`}
          extra={
            <Button icon={<ReloadOutlined />} onClick={refresh}>
              刷新
            </Button>
          }
        >
          {projects && !isSuccessStatus(projects.status) && (
            <Alert
              style={{ marginBottom: 12 }}
              type="error"
              showIcon
              message="获取远程项目失败"
              description={projects.message}
            />
          )}

          {projectList.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                projects?.status === "not_implemented"
                  ? "当前 Codex 版本不支持远程项目发现"
                  : "暂无远程项目，先在 Zed 中打开过 ssh 远程项目后才会出现"
              }
            />
          ) : (
            <List
              dataSource={projectList}
              renderItem={(p) => (
                <List.Item
                  key={p.id}
                  actions={[
                    <Tooltip title="在 Zed 中打开" key="open">
                      <Button
                        type="primary"
                        size="small"
                        icon={<LinkOutlined />}
                        loading={openingId === p.id}
                        onClick={() => handleOpen(p)}
                      >
                        打开
                      </Button>
                    </Tooltip>,
                    <Popconfirm
                      key="forget"
                      title="从列表移除？"
                      description="不会影响 Zed 端，只会从本管理器列表中消失"
                      okText="移除"
                      cancelText="取消"
                      onConfirm={() => handleForget(p.id)}
                    >
                      <Button size="small" icon={<DeleteOutlined />} danger>
                        忘记
                      </Button>
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        <Text strong>{p.label || p.id}</Text>
                        {p.isCurrent && (
                          <Tag icon={<CheckCircleOutlined />} color="success">
                            当前
                          </Tag>
                        )}
                        <Tag>{p.source}</Tag>
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size={2}>
                        <Text code style={{ fontSize: 11 }}>
                          {p.ssh.user}@{p.ssh.host}
                          {p.ssh.port ? `:${p.ssh.port}` : ""}:{p.path}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          <ClockCircleOutlined /> 最近打开：{formatTime(p.lastOpenedAtMs)}
                        </Text>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Card>
      </Space>
    </Spin>
  );
};
