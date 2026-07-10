// 增强与守护页 - 粘贴/Stepwise/中文/快速启动/菜单汉化/镜像/Computer Use/启动参数/CLI 包装
// 全部开关落到 BackendSettings，单一保存按钮

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  Switch,
  Button,
  Space,
  Typography,
  Input,
  Select,
  Slider,
  Row,
  Col,
  Divider,
  Alert,
  Spin,
  Tag,
  message,
  Popconfirm,
} from "antd";
import {
  SaveOutlined,
  ReloadOutlined,
  RocketOutlined,
  TranslationOutlined,
  ThunderboltOutlined,
  MenuOutlined,
  PictureOutlined,
  SafetyCertificateOutlined,
  CodeOutlined,
  GlobalOutlined,
} from "@ant-design/icons";
import { tauri } from "@/lib/tauri";
import { useSettingsStore, useUIStore } from "@/lib/store";
import type {
  BackendSettings,
  ImageOverlayFitMode,
  LaunchMode,
} from "@/lib/types";
import { isSuccessStatus, stringifyError } from "@/lib/utils";

const { Title, Text, Paragraph } = Typography;

const FIT_OPTIONS: { value: ImageOverlayFitMode; label: string }[] = [
  { value: "fill", label: "填充（裁剪）" },
  { value: "fit", label: "适配（留白）" },
  { value: "stretch", label: "拉伸" },
  { value: "tile", label: "平铺" },
  { value: "center", label: "居中" },
];

const LAUNCH_MODE_OPTIONS: { value: LaunchMode; label: string }[] = [
  { value: "patch", label: "patch — 启动时注入补丁" },
  { value: "relay", label: "relay — 通过 Relay 路由" },
];

export const Enhance = () => {
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const setNotice = useUIStore((s) => s.setNotice);

  const [draft, setDraft] = useState<BackendSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  // 同步 settings → draft
  useEffect(() => {
    if (settings?.settings) {
      setDraft(settings.settings);
    }
  }, [settings?.settings]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await tauri.loadSettings();
      if (r && isSuccessStatus(r.status)) {
        setSettings(r);
      }
    } catch (e) {
      message.error(`加载失败：${stringifyError(e)}`);
    } finally {
      setLoading(false);
    }
  }, [setSettings]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!draft) {
    return (
      <Card>
        <Spin />
      </Card>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings?.settings);

  // 修改字段
  const update = <K extends keyof BackendSettings>(key: K, value: BackendSettings[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  };

  // 嵌套字段（imageOverlay）
  const updateOverlay = <K extends keyof BackendSettings["imageOverlay"]>(
    key: K,
    value: BackendSettings["imageOverlay"][K],
  ) => {
    setDraft((d) => (d ? { ...d, imageOverlay: { ...d.imageOverlay, [key]: value } } : d));
  };

  // 保存
  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await tauri.saveSettings(draft);
      if (r && isSuccessStatus(r.status)) {
        setSettings(r);
        message.success("已保存");
      } else {
        message.error(`保存失败：${r?.message ?? "未知"}`);
      }
    } catch (e) {
      message.error(`保存失败：${stringifyError(e)}`);
    } finally {
      setSaving(false);
    }
  };

  // 重置
  const handleReset = () => {
    if (settings?.settings) {
      setDraft(settings.settings);
      message.info("已重置为已保存值");
    }
  };

  // Stepwise 测试
  const [testing, setTesting] = useState(false);
  const handleTestStepwise = async () => {
    if (!draft) return;
    setTesting(true);
    try {
      const r = await tauri.testStepwiseSettings(draft);
      if (r && isSuccessStatus(r.status)) {
        if (r.itemCount && r.itemCount > 0) {
          setNotice({ title: "Stepwise 解析成功", message: `已识别 ${r.itemCount} 项`, status: "ok" });
        } else {
          message.warning(r.error || "未识别到 Stepwise 项目");
        }
      } else {
        message.error(`解析失败：${r?.message ?? "未知"}`);
      }
    } catch (e) {
      message.error(`解析失败：${stringifyError(e)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Spin spinning={loading}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        {/* 顶栏 */}
        <Card>
          <Row align="middle" justify="space-between">
            <Col>
              <Title level={4} style={{ margin: 0 }}>
                <RocketOutlined /> 增强与守护
              </Title>
              <Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 4 }}>
                Codex 应用行为增强、Computer Use 守护、启动参数。修改后点击「保存」生效。
              </Paragraph>
            </Col>
            <Col>
              <Space>
                <Button icon={<ReloadOutlined />} onClick={refresh}>
                  重新加载
                </Button>
                <Button onClick={handleReset} disabled={!dirty}>
                  重置
                </Button>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={saving}
                  disabled={!dirty}
                  onClick={handleSave}
                >
                  保存
                </Button>
              </Space>
            </Col>
          </Row>
          {dirty && (
            <Alert
              style={{ marginTop: 12 }}
              type="warning"
              showIcon
              message="有未保存的修改"
            />
          )}
        </Card>

        {/* 应用增强 */}
        <Card title={<><TranslationOutlined /> 应用行为增强</>}>
          <Row gutter={[16, 12]}>
            <Col span={12}>
              <Space>
                <Switch
                  checked={draft.codexAppPasteFix}
                  onChange={(v) => update("codexAppPasteFix", v)}
                />
                <Text strong>粘贴修复</Text>
                <Text type="secondary">修复 Codex 在 macOS 上粘贴图片/大文本的问题</Text>
              </Space>
            </Col>
            <Col span={12}>
              <Space>
                <Switch
                  checked={draft.codexAppForceChineseLocale}
                  onChange={(v) => update("codexAppForceChineseLocale", v)}
                />
                <Text strong>强制中文 locale</Text>
                <Text type="secondary">Codex 启动时强制使用 zh_CN</Text>
              </Space>
            </Col>
            <Col span={12}>
              <Space>
                <Switch
                  checked={draft.codexAppFastStartup}
                  onChange={(v) => update("codexAppFastStartup", v)}
                />
                <Text strong>
                  <ThunderboltOutlined /> 快速启动
                </Text>
                <Text type="secondary">跳过 Codex 启动时的网络检查</Text>
              </Space>
            </Col>
            <Col span={12}>
              <Space>
                <Switch
                  checked={draft.codexAppNativeMenuLocalization}
                  onChange={(v) => update("codexAppNativeMenuLocalization", v)}
                />
                <Text strong>
                  <MenuOutlined /> 原生菜单汉化
                </Text>
                <Text type="secondary">把 Codex 原生菜单的英文改成中文</Text>
              </Space>
            </Col>
          </Row>
        </Card>

        {/* Stepwise */}
        <Card
          title={
            <Space>
              <CodeOutlined />
              Stepwise 解析
            </Space>
          }
          extra={
            <Popconfirm
              title="启用后 Codex 会通过自定义端点解析"
              okText="明白"
              cancelText="取消"
              disabled={draft.codexAppStepwiseEnabled}
            >
              <Button onClick={handleTestStepwise} loading={testing}>
                测试解析
              </Button>
            </Popconfirm>
          }
        >
          <Row align="middle" style={{ marginBottom: 12 }}>
            <Col flex="none">
              <Space>
                <Switch
                  checked={draft.codexAppStepwiseEnabled}
                  onChange={(v) => update("codexAppStepwiseEnabled", v)}
                />
                <Text strong>启用 Stepwise</Text>
              </Space>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Text type="secondary">Base URL</Text>
              <Input
                value={draft.cliWrapperBaseUrl}
                onChange={(e) => update("cliWrapperBaseUrl", e.target.value)}
                placeholder="https://api.example.com/v1"
                style={{ marginTop: 4 }}
              />
            </Col>
            <Col span={8}>
              <Text type="secondary">Model</Text>
              <Input
                value={draft.cliWrapperModel}
                onChange={(e) => update("cliWrapperModel", e.target.value)}
                placeholder="gpt-4o"
                style={{ marginTop: 4 }}
              />
            </Col>
            <Col span={8}>
              <Text type="secondary">API Key 环境变量</Text>
              <Input
                value={draft.cliWrapperApiKeyEnv}
                onChange={(e) => update("cliWrapperApiKeyEnv", e.target.value)}
                placeholder="OPENAI_API_KEY"
                style={{ marginTop: 4 }}
              />
            </Col>
          </Row>
          <Divider style={{ margin: "12px 0" }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            <GlobalOutlined /> 留空时使用 Codex 默认值。修改后需重启 Codex。
          </Text>
        </Card>

        {/* 镜像覆盖层 */}
        <Card title={<><PictureOutlined /> 镜像覆盖层</>}>
          <Row gutter={16}>
            <Col span={6}>
              <Space>
                <Switch
                  checked={draft.imageOverlay.enabled}
                  onChange={(v) => updateOverlay("enabled", v)}
                />
                <Text strong>启用</Text>
              </Space>
            </Col>
            <Col span={6}>
              <Text type="secondary">显示方式</Text>
              <Select
                value={draft.imageOverlay.fit}
                onChange={(v) => updateOverlay("fit", v)}
                options={FIT_OPTIONS}
                style={{ width: "100%", marginTop: 4 }}
              />
            </Col>
            <Col span={12}>
              <Text type="secondary">不透明度：{Math.round(draft.imageOverlay.opacity * 100)}%</Text>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={draft.imageOverlay.opacity}
                onChange={(v) => updateOverlay("opacity", v)}
              />
            </Col>
          </Row>
        </Card>

        {/* Computer Use 守护 */}
        <Card title={<><SafetyCertificateOutlined /> Computer Use 守护</>}>
          <Row align="middle">
            <Col flex="auto">
              <Space direction="vertical" size={4}>
                <Space>
                  <Switch
                    checked={draft.codexAppComputerUseGuard}
                    onChange={(v) => update("codexAppComputerUseGuard", v)}
                  />
                  <Text strong>启用 Computer Use 守护</Text>
                </Space>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  拦截 Codex 试图执行高风险操作（系统命令、文件删除、网络访问等），需要用户确认。
                </Text>
              </Space>
            </Col>
            <Col>
              <Tag color={draft.codexAppComputerUseGuard ? "green" : "default"}>
                {draft.codexAppComputerUseGuard ? "已开启" : "已关闭"}
              </Tag>
            </Col>
          </Row>
        </Card>

        {/* 启动参数 */}
        <Card title="启动参数">
          <Row gutter={16}>
            <Col span={6}>
              <Text type="secondary">启动模式</Text>
              <Select
                value={draft.launchMode}
                onChange={(v) => update("launchMode", v)}
                options={LAUNCH_MODE_OPTIONS}
                style={{ width: "100%", marginTop: 4 }}
              />
            </Col>
            <Col span={18}>
              <Text type="secondary">启动参数（传给 Codex 的 CLI 参数）</Text>
              <Input.TextArea
                value={draft.launchArgs}
                onChange={(e) => update("launchArgs", e.target.value)}
                placeholder='例：--model gpt-4o --debug'
                rows={3}
                style={{ marginTop: 4, fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}
              />
            </Col>
          </Row>
        </Card>

        {/* Goals / Provider Sync / CLI Wrapper 汇总 */}
        <Card title="其他增强开关">
          <Row gutter={[16, 12]}>
            <Col span={8}>
              <Space>
                <Switch
                  checked={draft.codexGoalsEnabled}
                  onChange={(v) => update("codexGoalsEnabled", v)}
                />
                <Text strong>Goals 启用</Text>
              </Space>
            </Col>
            <Col span={8}>
              <Space>
                <Switch
                  checked={draft.providerSyncEnabled}
                  onChange={(v) => update("providerSyncEnabled", v)}
                />
                <Text strong>Provider Sync 启用</Text>
              </Space>
            </Col>
            <Col span={8}>
              <Space>
                <Switch
                  checked={draft.cliWrapperEnabled}
                  onChange={(v) => update("cliWrapperEnabled", v)}
                />
                <Text strong>CLI Wrapper 启用</Text>
              </Space>
            </Col>
          </Row>
        </Card>
      </Space>
    </Spin>
  );
};
