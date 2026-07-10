// 供应商配置页 - Profile 列表、增删改、CC-switch 导入、Env 冲突
// 阶段 2 详细实现 - 当前是占位骨架

import { Card, Typography, Alert } from "antd";

const { Title, Paragraph } = Typography;

export const Relay = () => {
  return (
    <Card>
      <Title level={4}>供应商配置</Title>
      <Paragraph type="secondary">阶段 2 详细实现：供应商列表、增删改、CC-switch 导入、Relay 上下文管理、文件编辑。</Paragraph>
      <Alert
        type="info"
        showIcon
        message="页面骨架已就绪"
        description="阶段 1 完成：路由、状态层、Tauri bridge 已就位。阶段 2 将重写此页面的完整交互。"
      />
    </Card>
  );
};
