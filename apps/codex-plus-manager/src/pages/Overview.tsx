// 概览页 - 健康检查、最近启动、日志、诊断
import { Card, Col, Row, Statistic, Typography, Space, Button, Alert, Divider } from "antd";
import { useEffect } from "react";
import { api as tauri } from "@/lib/api";
import { useOverviewStore, useLogsStore, useSettingsStore } from "@/lib/store";
import { formatDuration, isSuccessStatus } from "@/lib/utils";

const { Title, Text, Paragraph } = Typography;

export const Overview = () => {
  const overview = useOverviewStore((s) => s.overview);
  const setOverview = useOverviewStore((s) => s.setOverview);
  const logs = useLogsStore((s) => s.logs);
  const setLogs = useLogsStore((s) => s.setLogs);
  const settings = useSettingsStore((s) => s.settings);

  const refresh = async () => {
    const [ov, l] = await Promise.all([tauri.loadOverview(), tauri.readLatestLogs({ lines: 30 })]);
    if (ov) setOverview(ov);
    if (l) setLogs(l);
  };

  useEffect(() => {
    refresh();
  }, []);

  const codexApp = overview?.codex_app;
  const launch = overview?.latest_launch;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card>
        <Title level={4} style={{ marginTop: 0 }}>健康检查</Title>
        <Paragraph type="secondary">概览只展示关键问题，具体配置在对应页面处理。</Paragraph>
        <Row gutter={16}>
          <Col span={6}>
            <Statistic
              title="Codex 应用路径"
              value={codexApp?.path ?? "未配置"}
              valueStyle={{ fontSize: 14 }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="Codex 版本"
              value={overview?.codex_version ?? "未检测到"}
              valueStyle={{ fontSize: 14 }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="最近启动"
              value={launch?.status ?? "无记录"}
              valueStyle={{ fontSize: 14 }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="设置文件"
              value={overview?.settings_path ?? "—"}
              valueStyle={{ fontSize: 12 }}
            />
          </Col>
        </Row>
        {launch && (
          <Alert
            style={{ marginTop: 16 }}
            type={isSuccessStatus(launch.status as any) ? "success" : "warning"}
            message={launch.message}
            description={launch.started_at_ms ? `已运行 ${formatDuration(launch.started_at_ms)}` : "尚未启动"}
            showIcon
          />
        )}
        {settings?.settings && (
          <>
            <Divider />
            <Space wrap>
              <Text>启动模式：</Text>
              <Text strong>{settings.settings.launchMode}</Text>
              <Text>·</Text>
              <Text>Relay Profiles：</Text>
              <Text strong>{settings.settings.relayProfiles?.length ?? 0}</Text>
              <Text>·</Text>
              <Text>用户脚本：</Text>
              <Text strong>{Object.keys(settings.settings.userScripts?.installed ?? {}).length}</Text>
            </Space>
          </>
        )}
        <Divider />
        <Button onClick={refresh}>刷新</Button>
      </Card>

      <Card>
        <Title level={5} style={{ marginTop: 0 }}>最近启动</Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          日志文件：{overview?.logs_path ?? "暂无"}
        </Paragraph>
        {logs?.text ? (
          <pre
            style={{
              background: theme === "dark" ? "#1f1f1f" : "#fafafa",
              padding: 12,
              borderRadius: 6,
              maxHeight: 400,
              overflow: "auto",
              fontSize: 12,
            }}
          >
            {logs.text}
          </pre>
        ) : (
          <Text type="secondary">暂无日志</Text>
        )}
      </Card>
    </Space>
  );
};

// 注入一个 theme 引用避免未使用报错
const theme = (typeof window !== "undefined" && window.localStorage.getItem("codex-plus-theme") === "light") ? "light" : "dark";
