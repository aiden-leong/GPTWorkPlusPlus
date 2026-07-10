// 用户脚本页 - 脚本市场 + 本地脚本管理

import { Card, Typography, Alert } from "antd";

const { Title, Paragraph } = Typography;

export const UserScripts = () => {
  return (
    <Card>
      <Title level={4}>用户脚本</Title>
      <Paragraph type="secondary">阶段 3 详细实现：GitHub 脚本市场清单、本地脚本启停/删除/手动导入。</Paragraph>
      <Alert type="info" showIcon message="页面骨架已就绪" />
    </Card>
  );
};
