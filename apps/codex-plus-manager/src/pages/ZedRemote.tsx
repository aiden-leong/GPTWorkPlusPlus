// Zed 远程项目页

import { Card, Typography, Alert } from "antd";

const { Title, Paragraph } = Typography;

export const ZedRemote = () => {
  return (
    <Card>
      <Title level={4}>Zed 远程项目</Title>
      <Paragraph type="secondary">阶段 3 详细实现：远程项目列表、打开策略、discovered from Codex。</Paragraph>
      <Alert
        type="info"
        showIcon
        message="页面骨架已就绪"
      />
    </Card>
  );
};
