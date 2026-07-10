// Relay 配置文件直接编辑 - config.toml + auth.json
// 高级功能：直接修改 Codex 实际的配置文件

import { useState, useEffect } from "react";
import {
  Card,
  Tabs,
  Input,
  Button,
  Space,
  Alert,
  Typography,
  Tag,
  message,
} from "antd";
import {
  SaveOutlined,
  ReloadOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { tauri } from "@/lib/tauri";
import { useRelayStore } from "@/lib/store";
import { isSuccessStatus } from "@/lib/utils";
import { globalConfirm } from "@/components/ConfirmManager";

const { Text, Paragraph } = Typography;

export const RelayFileEditors = () => {
  const relayFiles = useRelayStore((s) => s.relayFiles);
  const setRelayFiles = useRelayStore((s) => s.setRelayFiles);
  const [configText, setConfigText] = useState("");
  const [authText, setAuthText] = useState("");
  const [authVisible, setAuthVisible] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingAuth, setSavingAuth] = useState(false);
  const [dirty, setDirty] = useState<{ config: boolean; auth: boolean }>({ config: false, auth: false });

  useEffect(() => {
    if (relayFiles) {
      setConfigText(relayFiles.configContents ?? "");
      setAuthText(relayFiles.authContents ?? "");
      setDirty({ config: false, auth: false });
    }
  }, [relayFiles]);

  const refresh = async () => {
    const r = await tauri.readRelayFiles();
    if (r && isSuccessStatus(r.status)) {
      setRelayFiles(r);
    }
  };

  const handleSave = async (file: "config" | "auth") => {
    if (file === "config" && !configText.trim()) {
      message.warning("config 内容不能为空");
      return;
    }
    const ok = await globalConfirm({
      title: `保存 ${file === "config" ? "config.toml" : "auth.json"}`,
      message: `确认写入到 Codex 配置文件？错误的配置会导致 Codex 启动失败。`,
      confirmText: "保存",
    });
    if (!ok) return;

    if (file === "config") {
      setSavingConfig(true);
      const r = await tauri.saveRelayFile({ file: "config", contents: configText });
      setSavingConfig(false);
      if (r && isSuccessStatus(r.status)) {
        message.success("config.toml 已保存");
        setDirty((d) => ({ ...d, config: false }));
        await refresh();
      } else {
        message.error(`保存失败：${r?.message ?? "未知"}`);
      }
    } else {
      setSavingAuth(true);
      const r = await tauri.saveRelayFile({ file: "auth", contents: authText });
      setSavingAuth(false);
      if (r && isSuccessStatus(r.status)) {
        message.success("auth.json 已保存");
        setDirty((d) => ({ ...d, auth: false }));
        await refresh();
      } else {
        message.error(`保存失败：${r?.message ?? "未知"}`);
      }
    }
  };

  return (
    <Card
      title={
        <Space>
          <FileTextOutlined />
          配置文件直编
        </Space>
      }
      extra={
        <Button icon={<ReloadOutlined />} onClick={refresh}>
          重新加载
        </Button>
      }
    >
      <Alert
        type="warning"
        message="高级功能：直接编辑 config.toml 和 auth.json"
        description={
          <Space direction="vertical" size={4}>
            <Paragraph style={{ margin: 0 }}>
              修改后需要重启 Codex 才生效。错误配置会导致 Codex 无法启动。
            </Paragraph>
            <Text code style={{ fontSize: 11 }}>
              config: {relayFiles?.configPath ?? "—"}
            </Text>
            <Text code style={{ fontSize: 11 }}>
              auth: {relayFiles?.authPath ?? "—"}
            </Text>
          </Space>
        }
        style={{ marginBottom: 16 }}
        showIcon
      />
      <Tabs
        items={[
          {
            key: "config",
            label: (
              <Space>
                config.toml
                {dirty.config && <Tag color="orange">未保存</Tag>}
              </Space>
            ),
            children: (
              <>
                <Input.TextArea
                  value={configText}
                  onChange={(e) => {
                    setConfigText(e.target.value);
                    setDirty((d) => ({ ...d, config: true }));
                  }}
                  rows={18}
                  style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}
                  spellCheck={false}
                />
                <Space style={{ marginTop: 12 }}>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    onClick={() => handleSave("config")}
                    loading={savingConfig}
                    disabled={!dirty.config}
                  >
                    保存 config.toml
                  </Button>
                </Space>
              </>
            ),
          },
          {
            key: "auth",
            label: (
              <Space>
                auth.json
                {dirty.auth && <Tag color="orange">未保存</Tag>}
              </Space>
            ),
            children: (
              <>
                <Space style={{ marginBottom: 8 }}>
                  <Button
                    icon={authVisible ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                    onClick={() => setAuthVisible(!authVisible)}
                  >
                    {authVisible ? "隐藏" : "显示"} 内容
                  </Button>
                </Space>
                <Input.TextArea
                  value={authVisible ? authText : "•".repeat(Math.min(authText.length, 100))}
                  onChange={(e) => {
                    setAuthText(e.target.value);
                    setDirty((d) => ({ ...d, auth: true }));
                  }}
                  rows={18}
                  style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}
                  spellCheck={false}
                />
                <Space style={{ marginTop: 12 }}>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    onClick={() => handleSave("auth")}
                    loading={savingAuth}
                    disabled={!dirty.auth}
                  >
                    保存 auth.json
                  </Button>
                </Space>
              </>
            ),
          },
        ]}
      />
    </Card>
  );
};
