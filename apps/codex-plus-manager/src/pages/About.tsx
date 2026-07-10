// 关于页 - 版本、启动参数、诊断

import { Card, Typography, Alert, Space, Descriptions, Button } from "antd";
import { CopyOutlined, ReloadOutlined } from "@ant-design/icons";
import { useLogsStore } from "@/lib/store";
import { tauri } from "@/lib/tauri";
import { isSuccessStatus } from "@/lib/utils";

const { Title, Paragraph } = Typography;

export const About = () => {
  const diagnostics = useLogsStore((s) => s.diagnostics);
  const setDiagnostics = useLogsStore((s) => s.setDiagnostics);

  const refresh = async () => {
    const r = await tauri.copyDiagnostics();
    if (r) setDiagnostics(r);
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card>
        <Title level={4} style={{ marginTop: 0 }}>关于 GPT Work++</Title>
        <Paragraph type="secondary">
          本地 Codex 增强、管理工具和安装包维护。
        </Paragraph>
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="应用名称">GPT Work++ Manager</Descriptions.Item>
          <Descriptions.Item label="版本">1.2.34</Descriptions.Item>
          <Descriptions.Item label="Tauri">2.x</Descriptions.Item>
          <Descriptions.Item label="React">19.x</Descriptions.Item>
          <Descriptions.Item label="AntD">5.x</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        title="诊断报告"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={refresh}>生成</Button>
            {diagnostics && (
              <Button
                icon={<CopyOutlined />}
                onClick={() => navigator.clipboard.writeText(diagnostics.report)}
              >
                复制
              </Button>
            )}
          </Space>
        }
      >
        {diagnostics?.report ? (
          <pre
            style={{
              background: "var(--ant-color-bg-layout, #fafafa)",
              padding: 12,
              borderRadius: 6,
              maxHeight: 500,
              overflow: "auto",
              fontSize: 12,
            }}
          >
            {diagnostics.report}
          </pre>
        ) : (
          <Alert type="info" showIcon message="点击「生成」按钮生成诊断报告" />
        )}
        {diagnostics && !isSuccessStatus(diagnostics.status) && (
          <Alert
            style={{ marginTop: 12 }}
            type="error"
            showIcon
            message={diagnostics.message}
          />
        )}
      </Card>
    </Space>
  );
};
