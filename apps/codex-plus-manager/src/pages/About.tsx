// 关于页 - 版本、启动参数、诊断
// 真实从后端拉 backend_version / startup_options / diagnostics

import { useEffect, useState } from "react";
import {
  Card,
  Typography,
  Alert,
  Space,
  Descriptions,
  Button,
  message,
  Tag,
} from "antd";
import {
  CopyOutlined,
  ReloadOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons";
import { useLogsStore, useUIStore } from "@/lib/store";
import { tauri } from "@/lib/tauri";
import { isSuccessStatus } from "@/lib/utils";

const { Title, Paragraph, Text } = Typography;

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    message.success("已复制到剪贴板");
  } catch {
    message.error("复制失败");
  }
};

export const About = () => {
  const diagnostics = useLogsStore((s) => s.diagnostics);
  const setDiagnostics = useLogsStore((s) => s.setDiagnostics);
  const setNotice = useUIStore((s) => s.setNotice);

  const [backend, setBackend] = useState<{ version: string; gitHash: string } | null>(null);
  const [startup, setStartup] = useState<{
    debugPort: number;
    helperPort: number;
    defaultLogLines: number;
  } | null>(null);
  const [loadingDiag, setLoadingDiag] = useState(false);

  // 启动时拉版本/启动参数
  useEffect(() => {
    Promise.all([tauri.backendVersion(), tauri.startupOptions()])
      .then(([b, s]) => {
        setBackend(b);
        setStartup(s);
      })
      .catch((e) => {
        console.error("load about info failed", e);
      });
  }, []);

  const refreshDiagnostics = async () => {
    setLoadingDiag(true);
    try {
      const r = await tauri.copyDiagnostics();
      if (r) {
        setDiagnostics(r);
        if (isSuccessStatus(r.status)) {
          setNotice({ title: "诊断报告已生成", message: "可点击「复制」按钮复制到剪贴板", status: "ok" });
        } else {
          message.error(`生成失败：${r.message}`);
        }
      }
    } finally {
      setLoadingDiag(false);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card>
        <Title level={4} style={{ marginTop: 0 }}>
          <InfoCircleOutlined /> 关于 GPT Work++
        </Title>
        <Paragraph type="secondary">
          本地 Codex 增强、管理工具和安装包维护。
        </Paragraph>
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="应用名称">GPT Work++ Manager</Descriptions.Item>
          <Descriptions.Item label="前端版本">1.2.34</Descriptions.Item>
          <Descriptions.Item label="后端版本">
            {backend ? (
              <Space size={4}>
                <Text>{backend.version}</Text>
                {backend.gitHash && (
                  <Text code style={{ fontSize: 11 }}>
                    {backend.gitHash}
                  </Text>
                )}
              </Space>
            ) : (
              <Text type="secondary">加载中…</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="运行模式">
            <Tag color="blue">Tauri 2.x</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="技术栈">React 19 + AntD 5</Descriptions.Item>
          <Descriptions.Item label="路由">React Router 7（hash 模式）</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="启动参数">
        {startup ? (
          <Descriptions column={3} size="small">
            <Descriptions.Item label="Debug 端口">
              <Text code>{startup.debugPort}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Helper 端口">
              <Text code>{startup.helperPort}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="默认日志行数">
              <Text code>{startup.defaultLogLines}</Text>
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <Text type="secondary">加载中…</Text>
        )}
        <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          如需修改，启动时通过环境变量 / CLI 参数注入。
        </Paragraph>
      </Card>

      <Card
        title="诊断报告"
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={refreshDiagnostics}
              loading={loadingDiag}
            >
              生成
            </Button>
            {diagnostics?.report && (
              <Button
                icon={<CopyOutlined />}
                onClick={() => copyText(diagnostics.report)}
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
              margin: 0,
            }}
          >
            {diagnostics.report}
          </pre>
        ) : (
          <Alert
            type="info"
            showIcon
            message="点击「生成」按钮生成诊断报告"
            description="报告会包含设置、Relay、Codex 路径、最近日志等关键信息，方便排查问题。"
          />
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
