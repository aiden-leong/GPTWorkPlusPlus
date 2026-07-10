// 会话管理页 - 本地 SQLite 会话库
// 列表来自 list_local_sessions，删除走 delete_local_session（带 undo_token）

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Card,
  Space,
  Typography,
  Button,
  Tag,
  Empty,
  Table,
  Spin,
  Input,
  message,
  Popconfirm,
  Tooltip,
  Alert,
  Row,
  Col,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ReloadOutlined,
  DeleteOutlined,
  DatabaseOutlined,
  SearchOutlined,
  FolderOpenOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import { tauri } from "@/lib/tauri";
import { useSessionsStore } from "@/lib/store";
import type { LocalSession } from "@/lib/types";
import { formatTime, isSuccessStatus, stringifyError, truncateSessionDeletePreview } from "@/lib/utils";

const { Title, Text, Paragraph } = Typography;

export const Sessions = () => {
  const localSessions = useSessionsStore((s) => s.localSessions);
  const setLocalSessions = useSessionsStore((s) => s.setLocalSessions);

  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [lastUndo, setLastUndo] = useState<{ token: string; backup: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await tauri.listLocalSessions();
      if (r && isSuccessStatus(r.status)) {
        setLocalSessions(r);
        if (r.sessions.length === 0) {
          setSelected([]);
        }
      } else {
        message.error(`加载失败：${r?.message ?? "未知"}`);
      }
    } catch (e) {
      message.error(`加载失败：${stringifyError(e)}`);
    } finally {
      setLoading(false);
    }
  }, [setLocalSessions]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sessions: LocalSession[] = localSessions?.sessions ?? [];

  const filtered = useMemo(() => {
    if (!filter) return sessions;
    const lower = filter.toLowerCase();
    return sessions.filter(
      (s) =>
        s.id.toLowerCase().includes(lower) ||
        s.title.toLowerCase().includes(lower) ||
        s.cwd.toLowerCase().includes(lower) ||
        s.modelProvider.toLowerCase().includes(lower),
    );
  }, [sessions, filter]);

  const handleDelete = async (session: LocalSession) => {
    setDeleting(session.id);
    try {
      const r = await tauri.deleteLocalSession({
        sessionId: session.id,
        dbPath: session.dbPath || localSessions?.dbPath || null,
      });
      if (r && isSuccessStatus(r.status)) {
        if (r.undo_token && r.backup_path) {
          setLastUndo({ token: r.undo_token, backup: r.backup_path });
        }
        message.success("已删除");
        setSelected((s) => s.filter((x) => x !== session.id));
        await refresh();
      } else {
        message.error(`删除失败：${r?.message ?? "未知"}`);
      }
    } catch (e) {
      message.error(`删除失败：${stringifyError(e)}`);
    } finally {
      setDeleting(null);
    }
  };

  const handleBatchDelete = async () => {
    if (selected.length === 0) return;
    setBatchDeleting(true);
    try {
      // 顺序删除，串行避免 SQLite 锁
      let success = 0;
      let lastResult: any = null;
      for (const id of selected) {
        const s = sessions.find((x) => x.id === id);
        if (!s) continue;
        const r = await tauri.deleteLocalSession({
          sessionId: id,
          dbPath: s.dbPath || localSessions?.dbPath || null,
        });
        lastResult = r;
        if (r && isSuccessStatus(r.status)) {
          success += 1;
          if (r.undo_token && r.backup_path) {
            setLastUndo({ token: r.undo_token, backup: r.backup_path });
          }
        }
      }
      message.success(`已删除 ${success}/${selected.length} 个会话`);
      setSelected([]);
      await refresh();
    } catch (e) {
      message.error(`批量删除失败：${stringifyError(e)}`);
    } finally {
      setBatchDeleting(false);
    }
  };

  const columns: ColumnsType<LocalSession> = [
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
      width: 120,
      render: (id: string) => (
        <Tooltip title={id}>
          <Text code style={{ fontSize: 11 }}>
            {truncateSessionDeletePreview(id)}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: "标题",
      dataIndex: "title",
      key: "title",
      ellipsis: true,
      render: (title: string) => <Text>{title || "(无标题)"}</Text>,
    },
    {
      title: "工作目录",
      dataIndex: "cwd",
      key: "cwd",
      ellipsis: true,
      width: 240,
      render: (cwd: string) =>
        cwd ? (
          <Tooltip title={cwd}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              <FolderOpenOutlined /> {cwd}
            </Text>
          </Tooltip>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: "模型",
      dataIndex: "modelProvider",
      key: "modelProvider",
      width: 140,
      render: (p: string) => p ? <Tag>{p}</Tag> : <Text type="secondary">—</Text>,
    },
    {
      title: "状态",
      dataIndex: "archived",
      key: "archived",
      width: 80,
      render: (a: boolean) =>
        a ? <Tag color="default">已归档</Tag> : <Tag color="blue">活跃</Tag>,
    },
    {
      title: "更新时间",
      dataIndex: "updatedAtMs",
      key: "updatedAtMs",
      width: 160,
      render: (t: number | null) =>
        t ? (
          <Text type="secondary" style={{ fontSize: 11 }}>
            <ClockCircleOutlined /> {formatTime(t)}
          </Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: "操作",
      key: "actions",
      width: 90,
      fixed: "right",
      render: (_, s) => (
        <Popconfirm
          title="删除这个会话？"
          description={
            <Space direction="vertical" size={4}>
              <Text>会话 ID：{truncateSessionDeletePreview(s.id)}</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                删除前会先备份，可在日志中恢复
              </Text>
            </Space>
          }
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => handleDelete(s)}
        >
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            loading={deleting === s.id}
          >
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Spin spinning={loading}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        {/* 顶栏 */}
        <Card>
          <Row align="middle" justify="space-between">
            <Col>
              <Title level={4} style={{ margin: 0 }}>
                <DatabaseOutlined /> 会话管理
              </Title>
              <Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 4 }}>
                管理 Codex 本地 SQLite 库中的会话。
              </Paragraph>
            </Col>
            <Col>
              <Space>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  主库：<Text code style={{ fontSize: 11 }}>{localSessions?.dbPath ?? "—"}</Text>
                </Text>
                <Button icon={<ReloadOutlined />} onClick={refresh}>
                  刷新
                </Button>
              </Space>
            </Col>
          </Row>

          {localSessions && localSessions.dbPaths && localSessions.dbPaths.length > 1 && (
            <Alert
              style={{ marginTop: 12 }}
              type="info"
              showIcon
              message={`检测到 ${localSessions.dbPaths.length} 个会话库文件`}
              description={
                <Space direction="vertical" size={2}>
                  {localSessions.dbPaths.map((p) => (
                    <Text key={p} code style={{ fontSize: 11 }}>
                      {p}
                    </Text>
                  ))}
                </Space>
              }
            />
          )}

          {lastUndo && (
            <Alert
              style={{ marginTop: 12 }}
              type="success"
              showIcon
              message="已生成备份，可用于恢复"
              description={
                <Space direction="vertical" size={2}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    undo_token：<Text code style={{ fontSize: 11 }}>{lastUndo.token}</Text>
                  </Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    备份：<Text code style={{ fontSize: 11 }}>{lastUndo.backup}</Text>
                  </Text>
                </Space>
              }
              closable
              onClose={() => setLastUndo(null)}
            />
          )}
        </Card>

        {/* 表格 */}
        <Card>
          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col flex="auto">
              <Input
                prefix={<SearchOutlined />}
                placeholder="按 ID / 标题 / 工作目录 / 模型过滤"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                allowClear
              />
            </Col>
            <Col flex="none">
              <Space>
                <Text type="secondary">
                  已选 {selected.length} / 共 {filtered.length}
                </Text>
                <Popconfirm
                  title="批量删除"
                  description={`确认删除选中的 ${selected.length} 个会话？将依次备份。`}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  disabled={selected.length === 0}
                  onConfirm={handleBatchDelete}
                >
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    disabled={selected.length === 0}
                    loading={batchDeleting}
                  >
                    批量删除
                  </Button>
                </Popconfirm>
              </Space>
            </Col>
          </Row>

          {filtered.length === 0 && !loading ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                sessions.length === 0
                  ? "本地 SQLite 中还没有会话记录"
                  : "没有匹配的会话"
              }
            />
          ) : (
            <Table<LocalSession>
              rowKey="id"
              size="small"
              dataSource={filtered}
              columns={columns}
              pagination={{ pageSize: 20, showSizeChanger: true }}
              scroll={{ x: 900 }}
              rowSelection={{
                selectedRowKeys: selected,
                onChange: (keys) => setSelected(keys as string[]),
              }}
            />
          )}
        </Card>
      </Space>
    </Spin>
  );
};
