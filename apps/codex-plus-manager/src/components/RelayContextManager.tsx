// Relay 上下文管理 - MCP / Skills / Plugins 增删改
// 完整版：列表、新增、编辑、删除、启用/禁用、实时同步

import { useState, useEffect, useMemo } from "react";
import {
  Card,
  Tabs,
  List,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Switch,
  Typography,
  Tag,
  Empty,
  message,
  Popconfirm,
  Alert,
  Tooltip,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  ApiOutlined,
  CodeOutlined,
  AppstoreOutlined,
} from "@ant-design/icons";
import { tauri } from "@/lib/tauri";
import { useSettingsStore, useContextStore } from "@/lib/store";
import type { CodexContextEntries, CodexContextEntry, BackendSettings } from "@/lib/types";
import { isSuccessStatus } from "@/lib/utils";
import { globalConfirm } from "@/components/ConfirmManager";

const { Text } = Typography;

type Props = {
  // 组件独立维护自己的 state
};

const KIND_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  mcp: { label: "MCP", icon: <ApiOutlined />, color: "blue" },
  skill: { label: "Skill", icon: <CodeOutlined />, color: "green" },
  plugin: { label: "Plugin", icon: <AppstoreOutlined />, color: "purple" },
};

export const RelayContextManager = ({}: Props) => {
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const liveEntries = useContextStore((s) => s.liveContextEntries);
  const setLiveEntries = useContextStore((s) => s.setLiveContextEntries);
  const [editing, setEditing] = useState<{ kind: string; entry: CodexContextEntry | null; isNew: boolean } | null>(null);

  // 加载
  const refresh = async () => {
    if (!settings?.settings) return;
    const r = await tauri.listContextEntries({ settings: settings.settings });
    if (r && isSuccessStatus(r.status)) {
      // list returns entries
      if (r.entries) {
        setLiveEntries(r.entries);
      }
    }
    const r2 = await tauri.readLiveContextEntries();
    if (r2 && isSuccessStatus(r2.status)) {
      setLiveEntries(r2.entries);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.settings?.relayProfiles?.length ?? 0]);

  const entries: CodexContextEntries = useMemo(() => {
    return liveEntries ?? { mcpServers: [], skills: [], plugins: [] };
  }, [liveEntries]);

  const handleDelete = async (kind: string, name: string) => {
    const ok = await globalConfirm({
      title: "删除 Context 入口",
      message: `确认删除 ${KIND_META[kind].label}「${name}」？`,
      confirmText: "删除",
    });
    if (!ok) return;

    const r = await tauri.deleteContextEntry({ kind, name });
    if (r && isSuccessStatus(r.status)) {
      message.success("已删除");
      await refresh();
    } else {
      message.error(`删除失败：${r?.message ?? "未知"}`);
    }
  };

  const handleSave = async (kind: string, entry: CodexContextEntry, isNew: boolean) => {
    if (!settings?.settings) return;
    const r = await tauri.upsertContextEntry({ kind, name: entry.id, entry });
    if (r && isSuccessStatus(r.status)) {
      message.success(isNew ? "已添加" : "已保存");
      // 同步到 settings
      const synced = await tauri.syncLiveContextEntries({ settings: settings.settings });
      if (synced && synced.entries) {
        setLiveEntries(synced.entries);
        // 更新 settings.contextSelection
        const next: BackendSettings = {
          ...settings.settings,
          relayContextSelection: {
            mcpServers: synced.entries.mcpServers.filter((e) => e.enabled).map((e) => e.id),
            skills: synced.entries.skills.filter((e) => e.enabled).map((e) => e.id),
            plugins: synced.entries.plugins.filter((e) => e.enabled).map((e) => e.id),
          },
        };
        const saved = await tauri.saveSettings(next);
        if (saved) setSettings(saved);
      }
      setEditing(null);
      await refresh();
    } else {
      message.error(`保存失败：${r?.message ?? "未知"}`);
    }
  };

  const renderList = (kind: string, list: CodexContextEntry[]) => {
    const meta = KIND_META[kind];
    return (
      <List
        dataSource={list}
        locale={{ emptyText: <Empty description={`暂无 ${meta.label}`} /> }}
        renderItem={(item) => (
          <List.Item
            actions={[
              <Button
                key="edit"
                type="link"
                icon={<EditOutlined />}
                onClick={() => setEditing({ kind, entry: item, isNew: false })}
              >
                编辑
              </Button>,
              <Popconfirm
                key="delete"
                title="确认删除？"
                onConfirm={() => handleDelete(kind, item.id)}
              >
                <Button type="link" danger icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              avatar={meta.icon}
              title={
                <Space>
                  <Text strong>{item.title || item.id}</Text>
                  {item.enabled ? <Tag color="green">已启用</Tag> : <Tag>已禁用</Tag>}
                </Space>
              }
              description={
                <Space direction="vertical" size={2}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {item.summary || item.id}
                  </Text>
                  {item.tomlBody && (
                    <Tooltip title={item.tomlBody}>
                      <Text code style={{ fontSize: 11 }} copyable={{ text: item.tomlBody }}>
                        TOML
                      </Text>
                    </Tooltip>
                  )}
                </Space>
              }
            />
          </List.Item>
        )}
      />
    );
  };

  return (
    <Card
      title="工具与插件（MCP / Skills / Plugins）"
      extra={
        <Button icon={<ReloadOutlined />} onClick={() => refresh()}>
          刷新
        </Button>
      }
    >
      <Alert
        type="info"
        message="说明"
        description="MCP / Skills / Plugins 是 Codex 的扩展机制。新增的入口会写入 ~/.codex/config.toml 并对所有启用的供应商可见。"
        style={{ marginBottom: 16 }}
        showIcon
      />
      <Tabs
        items={[
          {
            key: "mcp",
            label: (
              <Space>
                {KIND_META.mcp.icon}
                MCP <Tag>{entries.mcpServers.length}</Tag>
              </Space>
            ),
            children: (
              <>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  style={{ marginBottom: 16 }}
                  onClick={() =>
                    setEditing({
                      kind: "mcp",
                      entry: { id: "", kind: "mcp", title: "", summary: "", tomlBody: "", enabled: true } as CodexContextEntry,
                      isNew: true,
                    })
                  }
                >
                  新增 MCP
                </Button>
                {renderList("mcp", entries.mcpServers)}
              </>
            ),
          },
          {
            key: "skill",
            label: (
              <Space>
                {KIND_META.skill.icon}
                Skills <Tag>{entries.skills.length}</Tag>
              </Space>
            ),
            children: (
              <>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  style={{ marginBottom: 16 }}
                  onClick={() =>
                    setEditing({
                      kind: "skill",
                      entry: { id: "", kind: "skill", title: "", summary: "", tomlBody: "", enabled: true } as CodexContextEntry,
                      isNew: true,
                    })
                  }
                >
                  新增 Skill
                </Button>
                {renderList("skill", entries.skills)}
              </>
            ),
          },
          {
            key: "plugin",
            label: (
              <Space>
                {KIND_META.plugin.icon}
                Plugins <Tag>{entries.plugins.length}</Tag>
              </Space>
            ),
            children: (
              <>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  style={{ marginBottom: 16 }}
                  onClick={() =>
                    setEditing({
                      kind: "plugin",
                      entry: { id: "", kind: "plugin", title: "", summary: "", tomlBody: "", enabled: true } as CodexContextEntry,
                      isNew: true,
                    })
                  }
                >
                  新增 Plugin
                </Button>
                {renderList("plugin", entries.plugins)}
              </>
            ),
          },
        ]}
      />

      <ContextEditModal
        editing={editing}
        onClose={() => setEditing(null)}
        onSave={handleSave}
      />
    </Card>
  );
};

const ContextEditModal = ({
  editing,
  onClose,
  onSave,
}: {
  editing: { kind: string; entry: CodexContextEntry | null; isNew: boolean } | null;
  onClose: () => void;
  onSave: (kind: string, entry: CodexContextEntry, isNew: boolean) => Promise<void>;
}) => {
  const [form] = Form.useForm<CodexContextEntry>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (editing?.entry) {
      form.setFieldsValue(editing.entry);
    }
  }, [editing, form]);

  const handleOk = async () => {
    if (!editing) return;
    const v = await form.validateFields();
    setSubmitting(true);
    await onSave(editing.kind, v, editing.isNew);
    setSubmitting(false);
  };

  return (
    <Modal
      open={!!editing}
      onCancel={onClose}
      onOk={handleOk}
      title={
        editing
          ? `${editing.isNew ? "新增" : "编辑"} ${KIND_META[editing.kind].label}：${editing.entry?.title || editing.entry?.id}`
          : ""
      }
      okText="保存"
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnClose
    >
      {editing && (
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            label="ID（唯一标识）"
            name="id"
            rules={[{ required: true, message: "请输入 ID" }]}
          >
            <Input disabled={!editing.isNew} placeholder="例如：my-mcp-server" />
          </Form.Item>
          <Form.Item label="标题" name="title">
            <Input placeholder="MCP 名称" />
          </Form.Item>
          <Form.Item label="描述" name="summary">
            <Input.TextArea rows={2} placeholder="说明这个 context 的用途" />
          </Form.Item>
          <Form.Item
            label="TOML 内容"
            name="tomlBody"
            tooltip="会被写入 config.toml 对应 section"
          >
            <Input.TextArea
              rows={6}
              placeholder={'[mcp_servers.my-mcp]\ncommand = "npx"\nargs = ["-y", "@my/mcp"]'}
              style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}
            />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
};
