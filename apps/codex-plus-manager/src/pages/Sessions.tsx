// 会话管理页 - 本地 SQLite 会话库

import { Card, Typography, Alert } from "antd";

const { Title, Paragraph } = Typography;

export const Sessions = () => {
  return (
    <Card>
      <Title level={4}>会话管理</Title>
      <Paragraph type="secondary">阶段 3 详细实现：本地 SQLite 会话库读取、删除、批量删除、修复。</Paragraph>
      <Alert type="info" showIcon message="页面骨架已就绪" />
    </Card>
  );
};
