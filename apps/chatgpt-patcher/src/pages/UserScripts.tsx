// 用户脚本页 - 脚本市场 + 本地脚本管理
// 市场数据来自 refresh_script_market（含 user_scripts 已安装清单）
// 操作：安装、启停、删除、总开关

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  Switch,
  Button,
  Space,
  Typography,
  Tabs,
  Tag,
  Empty,
  List,
  Spin,
  Input,
  message,
  Popconfirm,
  Row,
  Col,
  Tooltip,
  Alert,
} from "antd";
import {
  ReloadOutlined,
  DownloadOutlined,
  DeleteOutlined,
  SnippetsOutlined,
  CloudDownloadOutlined,
  UserOutlined,
  LinkOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import { api as tauri } from "@/lib/api";
import { useScriptMarketStore, useSettingsStore } from "@/lib/store";
import type { BackendSettings, ScriptMarketItem } from "@/lib/types";
import { isSuccessStatus, stringifyError, formatTime } from "@/lib/utils";

const { Title, Text, Paragraph } = Typography;

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

export const UserScripts = () => {
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const market = useScriptMarketStore((s) => s.market);
  const setMarket = useScriptMarketStore((s) => s.setMarket);

  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [installing, setInstalling] = useState<string | null>(null);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [savingGlobal, setSavingGlobal] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await tauri.refreshScriptMarket();
      if (r) {
        setMarket(r);
        if (!isSuccessStatus(r.status)) {
          message.warning(r.message);
        }
      }
    } catch (e) {
      message.error(`加载失败：${stringifyError(e)}`);
    } finally {
      setLoading(false);
    }
  }, [setMarket]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 总开关
  const handleToggleGlobal = async (checked: boolean) => {
    if (!settings?.settings) return;
    setSavingGlobal(true);
    try {
      const next: BackendSettings = {
        ...settings.settings,
        userScripts: { ...settings.settings.userScripts, enabled: checked },
      };
      const r = await tauri.saveSettings(next);
      if (r && isSuccessStatus(r.status)) {
        setSettings(r);
        message.success(checked ? "已启用用户脚本" : "已禁用用户脚本");
      } else {
        message.error(`保存失败：${r?.message ?? "未知"}`);
      }
    } catch (e) {
      message.error(`保存失败：${stringifyError(e)}`);
    } finally {
      setSavingGlobal(false);
    }
  };

  // 单个启停
  const handleToggleScript = async (key: string, enabled: boolean) => {
    setTogglingKey(key);
    try {
      const r = await tauri.setUserScriptEnabled(key, enabled);
      if (r && isSuccessStatus(r.status)) {
        message.success(enabled ? "已启用" : "已禁用");
        await refresh();
      } else {
        message.error(`操作失败：${r?.message ?? "未知"}`);
      }
    } catch (e) {
      message.error(`操作失败：${stringifyError(e)}`);
    } finally {
      setTogglingKey(null);
    }
  };

  // 删除
  const handleDelete = async (key: string) => {
    setDeletingKey(key);
    try {
      const r = await tauri.deleteUserScript(key);
      if (r && isSuccessStatus(r.status)) {
        message.success("已删除");
        await refresh();
      } else {
        message.error(`删除失败：${r?.message ?? "未知"}`);
      }
    } catch (e) {
      message.error(`删除失败：${stringifyError(e)}`);
    } finally {
      setDeletingKey(null);
    }
  };

  // 安装
  const handleInstall = async (id: string) => {
    setInstalling(id);
    try {
      const r = await tauri.installMarketScript(id);
      if (r) {
        setMarket(r);
        if (isSuccessStatus(r.status)) {
          message.success("安装成功");
        } else {
          message.error(`安装失败：${r?.message ?? "未知"}`);
        }
      }
    } catch (e) {
      message.error(`安装失败：${stringifyError(e)}`);
    } finally {
      setInstalling(null);
    }
  };

  // 打开外部链接
  const handleOpenUrl = async (url: string) => {
    try {
      const r = await tauri.openExternalUrl(url);
      if (!r || !isSuccessStatus(r.status)) {
        message.error(`无法打开：${r?.message ?? "未知"}`);
      }
    } catch (e) {
      message.error(`无法打开：${stringifyError(e)}`);
    }
  };

  const installed = settings?.settings?.userScripts?.installed ?? {};
  const installedEntries = Object.entries(installed);
  const totalEnabled = installedEntries.filter(([, v]) => v.enabled).length;
  const globalEnabled = settings?.settings?.userScripts?.enabled ?? false;

  const marketItems: ScriptMarketItem[] = market?.market?.scripts ?? [];
  const filteredMarket = marketItems.filter((s) => {
    if (!filter) return true;
    const lower = filter.toLowerCase();
    return (
      s.name.toLowerCase().includes(lower) ||
      s.description.toLowerCase().includes(lower) ||
      s.author.toLowerCase().includes(lower) ||
      s.tags.some((t) => t.toLowerCase().includes(lower))
    );
  });

  return (
    <Spin spinning={loading}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        {/* 顶栏 */}
        <Card>
          <Row align="middle" justify="space-between">
            <Col>
              <Title level={4} style={{ margin: 0 }}>
                <SnippetsOutlined /> 用户脚本
              </Title>
              <Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 4 }}>
                管理本地脚本和从 GitHub 市场安装的脚本。
              </Paragraph>
            </Col>
            <Col>
              <Space size="large">
                <Space>
                  <Text type="secondary">总开关：</Text>
                  <Switch
                    checked={globalEnabled}
                    onChange={handleToggleGlobal}
                    loading={savingGlobal}
                    checkedChildren="启用"
                    unCheckedChildren="禁用"
                  />
                </Space>
                <Button icon={<ReloadOutlined />} onClick={refresh}>
                  刷新
                </Button>
              </Space>
            </Col>
          </Row>
          {!globalEnabled && (
            <Alert
              style={{ marginTop: 12 }}
              type="warning"
              showIcon
              message="用户脚本已全局禁用"
              description="即使单个脚本为启用状态，也不会被 Codex 加载。"
            />
          )}
        </Card>

        <Tabs
          items={[
            {
              key: "installed",
              label: (
                <Space>
                  <CheckCircleOutlined />
                  已安装（{installedEntries.length}，启用 {totalEnabled}）
                </Space>
              ),
              children: (
                <Card>
                  {installedEntries.length === 0 ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="还没有安装任何脚本，去「脚本市场」标签安装一个"
                    />
                  ) : (
                    <List
                      dataSource={installedEntries}
                      renderItem={([key, info]) => (
                        <List.Item
                          key={key}
                          actions={[
                            <Tooltip
                              title={info.enabled ? "点击禁用" : "点击启用"}
                              key="toggle"
                            >
                              <Switch
                                size="small"
                                checked={info.enabled}
                                loading={togglingKey === key}
                                onChange={(v) => handleToggleScript(key, v)}
                              />
                            </Tooltip>,
                            <Popconfirm
                              key="delete"
                              title="删除这个脚本？"
                              description="将从本地彻底移除（不影响市场清单）"
                              okText="删除"
                              cancelText="取消"
                              okButtonProps={{ danger: true }}
                              onConfirm={() => handleDelete(key)}
                            >
                              <Button
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                loading={deletingKey === key}
                              >
                                删除
                              </Button>
                            </Popconfirm>,
                          ]}
                        >
                          <List.Item.Meta
                            title={
                              <Space>
                                <Text strong>{key}</Text>
                                <Tag color={info.enabled ? "green" : "default"}>
                                  {info.enabled ? "已启用" : "已禁用"}
                                </Tag>
                                <Tag>{info.source}</Tag>
                              </Space>
                            }
                            description={
                              <Space direction="vertical" size={2}>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                  路径：<Text code style={{ fontSize: 11 }}>{info.path}</Text>
                                </Text>
                              </Space>
                            }
                          />
                        </List.Item>
                      )}
                    />
                  )}
                </Card>
              ),
            },
            {
              key: "market",
              label: (
                <Space>
                  <CloudDownloadOutlined />
                  脚本市场（{marketItems.length}）
                </Space>
              ),
              children: (
                <Card>
                  {market?.market?.indexUrl && (
                    <Paragraph type="secondary" style={{ fontSize: 12 }}>
                      市场索引：<Text code style={{ fontSize: 11 }}>{market.market.indexUrl}</Text>
                      {market.market.updatedAt && (
                        <>
                          {" · "}
                          <ClockCircleOutlined /> 更新于 {formatTime(new Date(market.market.updatedAt).getTime())}
                        </>
                      )}
                    </Paragraph>
                  )}
                  {market && !isSuccessStatus(market.status) && (
                    <Alert
                      style={{ marginBottom: 12 }}
                      type="warning"
                      showIcon
                      message="市场加载异常"
                      description={market.message}
                    />
                  )}
                  <Input.Search
                    placeholder="按名称、作者、标签过滤"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    style={{ marginBottom: 12 }}
                    allowClear
                  />
                  {filteredMarket.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={market ? "没有匹配的脚本" : "加载中…"} />
                  ) : (
                    <List
                      dataSource={filteredMarket}
                      renderItem={(s) => (
                        <List.Item
                          key={s.id}
                          actions={[
                            s.installed ? (
                              <Tag key="installed" icon={<CheckCircleOutlined />} color="green">
                                已安装
                              </Tag>
                            ) : (
                              <Button
                                key="install"
                                type="primary"
                                size="small"
                                icon={<DownloadOutlined />}
                                loading={installing === s.id}
                                onClick={() => handleInstall(s.id)}
                              >
                                安装
                              </Button>
                            ),
                            s.url ? (
                              <Tooltip title="在 GitHub 查看" key="url">
                                <Button
                                  size="small"
                                  icon={<LinkOutlined />}
                                  onClick={() => handleOpenUrl(s.url)}
                                />
                              </Tooltip>
                            ) : null,
                          ]}
                        >
                          <List.Item.Meta
                            title={
                              <Space wrap>
                                <Text strong>{s.name}</Text>
                                {s.tags.map((t) => (
                                  <Tag key={t}>{t}</Tag>
                                ))}
                              </Space>
                            }
                            description={
                              <Space direction="vertical" size={2}>
                                <Text style={{ fontSize: 12 }}>{s.description}</Text>
                                <Space size="small" wrap>
                                  <Text type="secondary" style={{ fontSize: 11 }}>
                                    <UserOutlined /> {s.author}
                                  </Text>
                                  <Text type="secondary" style={{ fontSize: 11 }}>
                                    {formatSize(s.size)}
                                  </Text>
                                  {s.updatedAt && (
                                    <Text type="secondary" style={{ fontSize: 11 }}>
                                      <ClockCircleOutlined /> {s.updatedAt}
                                    </Text>
                                  )}
                                </Space>
                              </Space>
                            }
                          />
                        </List.Item>
                      )}
                    />
                  )}
                </Card>
              ),
            },
          ]}
        />
      </Space>
    </Spin>
  );
};
