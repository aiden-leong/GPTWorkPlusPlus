// Relay Profile 编辑器 - 完整 Modal
// 30+ 字段，支持验证、预设填表、模型列表、上下文窗口

import { useState, useEffect, useMemo } from "react";
import {
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Button,
  Space,
  Tabs,
  Alert,
  Typography,
  Tag,
  Divider,
  Row,
  Col,
  message,
  Spin,
  AutoComplete,
} from "antd";
import {
  ApiOutlined,
  SettingOutlined,
  CodeOutlined,
  ExperimentOutlined,
  FunctionOutlined,
} from "@ant-design/icons";
import { api as tauri } from "@/lib/api";
import { useSettingsStore, useUIStore } from "@/lib/store";
import type { RelayProfile, BackendSettings, RelayMode, RelayProtocol } from "@/lib/types";
import { isSuccessStatus } from "@/lib/utils";
import { PRESETS, type ProviderPreset } from "@/lib/presets";
import { globalConfirm } from "@/components/ConfirmManager";

const { Text, Paragraph } = Typography;

type Props = {
  open: boolean;
  profile: RelayProfile | null;
  isNew: boolean;
  onClose: () => void;
  onSaved: () => void;
};

const RELAY_MODES: { value: RelayMode; label: string; description: string }[] = [
  { value: "official", label: "官方登录", description: "使用官方 ChatGPT 账号登录" },
  { value: "mixedApi", label: "官方+API", description: "保留官方登录，API 请求走自定义 Key" },
  { value: "pureApi", label: "纯 API", description: "完全使用自定义 API Key" },
  { value: "aggregate", label: "聚合", description: "聚合多个供应商的请求" },
];

const PROTOCOLS: { value: RelayProtocol; label: string }[] = [
  { value: "responses", label: "Responses" },
  { value: "chatCompletions", label: "Chat Completions" },
];

const createEmptyProfile = (): RelayProfile => ({
  id: "",
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
  step: { enabled: false, baseUrl: "", apiKey: "", model: "" },
  enabled: true,
});

const applyPreset = (profile: RelayProfile, preset: ProviderPreset): RelayProfile => ({
  ...profile,
  name: profile.name || preset.name,
  baseUrl: preset.baseUrl,
  protocol: preset.protocol,
  modelList: preset.modelList ? preset.modelList.join("\n") : preset.model,
});

export const RelayProfileEditor = ({ open, profile, isNew, onClose, onSaved }: Props) => {
  const [form] = Form.useForm<RelayProfile>();
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const setNotice = useUIStore((s) => s.setNotice);
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [doctorResult, setDoctorResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("basic");

  // 初始化表单
  useEffect(() => {
    if (open) {
      form.setFieldsValue(profile ?? createEmptyProfile());
      setActiveTab("basic");
      setDoctorResult(null);
    }
  }, [open, profile, form]);

  // 选预设填表
  const handlePreset = (presetId: string) => {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const current = form.getFieldsValue();
    form.setFieldsValue(applyPreset(current, preset));
    message.success(`已应用预设：${preset.name}`);
  };

  // 测试连接
  const handleTest = async () => {
    if (!profile) return;
    setTesting(true);
    const values = form.getFieldsValue();
    const testProfile: RelayProfile = { ...values, id: profile.id || "test-" + Date.now() };
    const r = await tauri.testRelayProfile(testProfile);
    setTesting(false);
    if (r) {
      if (isSuccessStatus(r.status) && r.httpStatus > 0) {
        message.success(`连接成功 (HTTP ${r.httpStatus})`);
      } else {
        message.error(`连接失败：${r.message}`);
      }
    }
  };

  // 拉取模型列表
  const handleFetchModels = async () => {
    const values = form.getFieldsValue();
    if (!values.baseUrl || !values.apiKey) {
      message.warning("请先填写 Base URL 和 API Key");
      return;
    }
    setFetchingModels(true);
    const probe: RelayProfile = {
      ...values,
      id: "probe-" + Date.now(),
      name: values.name || "probe",
    };
    const r = await tauri.fetchRelayProfileModels(probe);
    setFetchingModels(false);
    if (r && isSuccessStatus(r.status)) {
      const existing = (values.modelList ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
      const merged = Array.from(new Set([...existing, ...r.models]));
      form.setFieldValue("modelList", merged.join("\n"));
      message.success(`已拉取 ${r.models.length} 个模型`);
    } else {
      message.error(`拉取失败：${r?.message ?? "未知错误"}`);
    }
  };

  // 诊断
  const handleDiagnose = async () => {
    const values = form.getFieldsValue();
    const probe: RelayProfile = { ...values, id: "diag-" + Date.now(), name: values.name || "diag" };
    const r = await tauri.diagnoseRelayProfile(probe);
    if (r) {
      setDoctorResult(`${r.summary}\n\n${r.recommendation}`);
    }
  };

  // 保存
  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const next: RelayProfile = { ...profile, ...values };

      // 合并到 settings.relayProfiles
      if (!settings?.settings) {
        message.error("设置未加载");
        return;
      }
      const profiles = [...settings.settings.relayProfiles];
      const idx = profiles.findIndex((p) => p.id === next.id);
      if (idx >= 0) profiles[idx] = next;
      else profiles.push(next);

      const nextSettings: BackendSettings = {
        ...settings.settings,
        relayProfiles: profiles,
      };
      const r = await tauri.saveSettings(nextSettings);
      if (r && isSuccessStatus(r.status)) {
        setSettings(r);
        setNotice({ title: "保存成功", message: `供应商 ${next.name} 已保存`, status: "ok" });
        onSaved();
      } else {
        message.error(`保存失败：${r?.message ?? "未知错误"}`);
      }
    } catch (e: any) {
      if (e?.errorFields) {
        message.error("请检查表单填写");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!profile || isNew) return;
    const ok = await globalConfirm({
      title: "删除供应商",
      message: `确认删除供应商「${profile.name}」？此操作不可撤销。`,
      confirmText: "删除",
      cancelText: "取消",
    });
    if (!ok) return;

    if (!settings?.settings) return;
    const profiles = settings.settings.relayProfiles.filter((p) => p.id !== profile.id);
    const r = await tauri.saveSettings({ ...settings.settings, relayProfiles: profiles });
    if (r && isSuccessStatus(r.status)) {
      setSettings(r);
      setNotice({ title: "删除成功", message: `供应商「${profile.name}」已删除`, status: "ok" });
      onSaved();
    }
  };

  const presetOptions = useMemo(
    () => PRESETS.map((p) => ({ value: p.id, label: `${p.name}（${p.category}）` })),
    [],
  );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={840}
      title={isNew ? "新增供应商" : `编辑供应商：${profile?.name}`}
      okText="保存"
      cancelText="取消"
      onOk={handleSave}
      confirmLoading={submitting}
      destroyOnHidden
      footer={[
        !isNew && (
          <Button key="delete" danger onClick={handleDelete} style={{ float: "left" }}>
            删除
          </Button>
        ),
        <Button key="test" onClick={handleTest} loading={testing}>
          测试连接
        </Button>,
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="ok" type="primary" onClick={handleSave} loading={submitting}>
          保存
        </Button>,
      ]}
    >
      <Spin spinning={submitting}>
        <Form form={form} layout="vertical" preserve={false} initialValues={profile ?? createEmptyProfile()}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: "basic",
                label: <span><ApiOutlined /> 基本信息</span>,
                children: <BasicTab onPreset={handlePreset} presetOptions={presetOptions} />,
              },
              {
                key: "advanced",
                label: <span><SettingOutlined /> 高级</span>,
                children: <AdvancedTab />,
              },
              {
                key: "model",
                label: <span><ExperimentOutlined /> 模型与上下文</span>,
                children: (
                  <ModelTab
                    onFetchModels={handleFetchModels}
                    fetchingModels={fetchingModels}
                    onDiagnose={handleDiagnose}
                    doctorResult={doctorResult}
                  />
                ),
              },
              {
                key: "context",
                label: <span><CodeOutlined /> 上下文与高级特性</span>,
                children: <ContextTab />,
              },
            ]}
          />
        </Form>
      </Spin>
    </Modal>
  );
};

// ============== 子 Tab 组件 ==============

const BasicTab = ({
  onPreset,
  presetOptions,
}: {
  onPreset: (id: string) => void;
  presetOptions: { value: string; label: string }[];
}) => (
  <>
    <Alert
      type="info"
      message="选预设自动填表"
      description="从下方选择一个供应商预设，基础字段会自动填充（之后可手动调整）。"
      style={{ marginBottom: 16 }}
      showIcon
    />
    <Form.Item label="应用预设" name="_preset">
      <AutoComplete
        options={presetOptions}
        placeholder="搜索供应商预设…"
        onSelect={onPreset}
        allowClear
        filterOption={(input, option) =>
          (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
        }
      />
    </Form.Item>
    <Divider plain>基本信息</Divider>
    <Row gutter={16}>
      <Col span={12}>
        <Form.Item
          label="供应商名称"
          name="name"
          rules={[{ required: true, message: "请输入供应商名称" }]}
        >
          <Input placeholder="例如：我的 DeepSeek" />
        </Form.Item>
      </Col>
      <Col span={12}>
        <Form.Item
          label="模式"
          name="relayMode"
          tooltip="official=官方登录 / mixedApi=官方+API / pureApi=纯 API / aggregate=聚合"
        >
          <Select options={RELAY_MODES.map((m) => ({ value: m.value, label: m.label }))} />
        </Form.Item>
      </Col>
    </Row>
    <Row gutter={16}>
      <Col span={16}>
        <Form.Item
          label="Base URL"
          name="baseUrl"
          rules={[{ required: true, message: "请输入 Base URL" }]}
        >
          <Input placeholder="https://api.example.com/v1" />
        </Form.Item>
      </Col>
      <Col span={8}>
        <Form.Item label="协议" name="protocol">
          <Select options={PROTOCOLS} />
        </Form.Item>
      </Col>
    </Row>
    <Form.Item
      label="API Key"
      name="apiKey"
      rules={[{ required: true, message: "请输入 API Key" }]}
    >
      <Input.Password placeholder="sk-..." />
    </Form.Item>
    <Row gutter={16}>
      <Col span={12}>
        <Form.Item label="上游 Base URL（可选）" name="upstreamBaseUrl">
          <Input placeholder="用于代理透传" />
        </Form.Item>
      </Col>
      <Col span={12}>
        <Form.Item label="User Agent（可选）" name="userAgent">
          <Input placeholder="自定义 User-Agent" />
        </Form.Item>
      </Col>
    </Row>
    <Form.Item label="测试模型" name="testModel">
      <Input placeholder="用于测试连接的模型名" />
    </Form.Item>
  </>
);

const AdvancedTab = () => {
  const relayMode = Form.useWatch("relayMode", { preserve: true });
  return (
    <>
      <Alert
        type="warning"
        message="高级选项"
        description="如无特殊需求保持默认即可。错误配置可能导致 Codex 无法启动。"
        style={{ marginBottom: 16 }}
        showIcon
      />
      <Form.Item
        label="使用 common config（与所有供应商共享）"
        name="useCommonConfig"
        valuePropName="checked"
        tooltip="关闭后该供应商的 config.toml/auth.toml 不与 common 合并"
      >
        <Switch />
      </Form.Item>
      {relayMode === "mixedApi" && (
        <Form.Item
          label="API Key 与官方混用"
          name="officialMixApiKey"
          valuePropName="checked"
          tooltip="保留官方账号，但 API 请求使用当前 Key"
        >
          <Switch />
        </Form.Item>
      )}
      <Divider plain>Stepwise（后续建议）</Divider>
      <Form.Item label="启用 Stepwise" name={["step", "enabled"]} valuePropName="checked">
        <Switch />
      </Form.Item>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item label="Stepwise Base URL" name={["step", "baseUrl"]}>
            <Input placeholder="https://..." />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="Stepwise API Key" name={["step", "apiKey"]}>
            <Input.Password placeholder="sk-..." />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item label="Stepwise 模型" name={["step", "model"]}>
        <Input placeholder="gpt-4o-mini" />
      </Form.Item>
    </>
  );
};

const ModelTab = ({
  onFetchModels,
  fetchingModels,
  onDiagnose,
  doctorResult,
}: {
  onFetchModels: () => void;
  fetchingModels: boolean;
  onDiagnose: () => void;
  doctorResult: string | null;
}) => (
  <>
    <Alert
      type="info"
      message="模型与上下文窗口"
      description="每行一个模型；模型名后可用 [1M] / [200K] / [1000000] 指定该模型的上下文窗口。"
      style={{ marginBottom: 16 }}
      showIcon
    />
    <Form.Item
      label="模型列表"
      name="modelList"
      tooltip="每行一个模型名，可加 [1M] 后缀指定窗口"
    >
      <Input.TextArea
        rows={6}
        placeholder={"gpt-4o\ngpt-4o-mini\ndeepseek-chat[1M]"}
        style={{ fontFamily: "JetBrains Mono, monospace" }}
      />
    </Form.Item>
    <Form.Item label="插入模式" name="modelInsertMode" tooltip="overwrite=覆盖 / append=追加">
      <Select
        options={[
          { value: "overwrite", label: "覆盖（清空原列表）" },
          { value: "append", label: "追加（合并）" },
        ]}
      />
    </Form.Item>
    <Space>
      <Button icon={<ApiOutlined />} loading={fetchingModels} onClick={onFetchModels}>
        从服务器拉取模型列表
      </Button>
      <Button icon={<FunctionOutlined />} onClick={onDiagnose}>
        诊断
      </Button>
    </Space>
    {doctorResult && (
      <Alert
        type="info"
        message="诊断结果"
        description={<pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{doctorResult}</pre>}
        style={{ marginTop: 16 }}
        showIcon
      />
    )}
  </>
);

const ContextTab = () => (
  <>
    <Alert
      type="info"
      message="MCP / Skills / Plugins 选择"
      description="该供应商生效时，勾选要启用的 context 入口。完整增删改在主页面的「工具与插件」入口管理。"
      style={{ marginBottom: 16 }}
      showIcon
    />
    <Paragraph type="secondary">此 Tab 仅展示该供应商的 context 引用。完整增删改见主页"工具与插件"。</Paragraph>
    <Row gutter={16}>
      <Col span={8}>
        <Tag color="blue">MCP 数量</Tag>
        <Form.Item shouldUpdate noStyle>
          {({ getFieldValue }) => {
            const v = getFieldValue(["contextSelection", "mcpServers"]) as string[] | undefined;
            return <Text>{v?.length ?? 0}</Text>;
          }}
        </Form.Item>
      </Col>
      <Col span={8}>
        <Tag color="green">Skills 数量</Tag>
        <Form.Item shouldUpdate noStyle>
          {({ getFieldValue }) => {
            const v = getFieldValue(["contextSelection", "skills"]) as string[] | undefined;
            return <Text>{v?.length ?? 0}</Text>;
          }}
        </Form.Item>
      </Col>
      <Col span={8}>
        <Tag color="purple">Plugins 数量</Tag>
        <Form.Item shouldUpdate noStyle>
          {({ getFieldValue }) => {
            const v = getFieldValue(["contextSelection", "plugins"]) as string[] | undefined;
            return <Text>{v?.length ?? 0}</Text>;
          }}
        </Form.Item>
      </Col>
    </Row>
  </>
);
