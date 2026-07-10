// 检查与修复页 - 入口管理、Watcher、Codex 应用路径

import { Card, Typography, Alert } from "antd";

const { Title, Paragraph } = Typography;

export const Maintenance = () => {
  return (
    <Card>
      <Title level={4}>检查与修复</Title>
      <Paragraph type="secondary">阶段 3 详细实现：桌面快捷方式、Watcher 状态、Codex 应用路径选择。</Paragraph>
      <Alert type="info" showIcon message="页面骨架已就绪" />
    </Card>
  );
};
