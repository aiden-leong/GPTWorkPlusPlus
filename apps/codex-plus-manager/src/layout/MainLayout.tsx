// 主布局 - AntD Sider + Header + Content
// 8 个页面的左侧导航

import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Layout, Menu, Switch, Space, Typography, Tag } from "antd";
import {
  DashboardOutlined,
  ApiOutlined,
  RocketOutlined,
  SnippetsOutlined,
  DatabaseOutlined,
  ToolOutlined,
  InfoCircleOutlined,
  SunOutlined,
  MoonOutlined,
} from "@ant-design/icons";
import { useUIStore } from "@/lib/store";
import { NoticeManager } from "@/components/NoticeManager";
import { ConfirmManager } from "@/components/ConfirmManager";
import { api as tauri } from "@/lib/api";

const { Sider, Content, Header } = Layout;
const { Text } = Typography;

const navItems = [
  { key: "/overview", icon: <DashboardOutlined />, label: "概览" },
  { key: "/relay", icon: <ApiOutlined />, label: "供应商配置" },
  { key: "/enhance", icon: <RocketOutlined />, label: "增强与守护" },
  { key: "/user-scripts", icon: <SnippetsOutlined />, label: "用户脚本" },
  { key: "/sessions", icon: <DatabaseOutlined />, label: "会话管理" },
  { key: "/maintenance", icon: <ToolOutlined />, label: "检查与修复" },
  { key: "/about", icon: <InfoCircleOutlined />, label: "关于" },
];

export const MainLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);

  // 启动时从 hash 兼容老路由
  useEffect(() => {
    if (window.location.hash === "#about" && location.pathname !== "/about") {
      navigate("/about", { replace: true });
    }
  }, [location.pathname, navigate]);

  // 托盘事件监听
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    tauri.onTrayUpdate((state: any) => {
      console.log("tray update", state);
    }).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, []);

  const selectedKey = navItems.find((item) => location.pathname.startsWith(item.key))?.key ?? "/overview";

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        theme={theme}
        breakpoint="lg"
        collapsedWidth="0"
        width={220}
        style={{
          borderRight: theme === "dark" ? "1px solid #303030" : "1px solid #f0f0f0",
        }}
      >
        <div
          style={{
            padding: "20px 16px",
            textAlign: "center",
            borderBottom: theme === "dark" ? "1px solid #303030" : "1px solid #f0f0f0",
          }}
        >
          <Text strong style={{ fontSize: 16 }}>
            GPT Work++ 管理器
          </Text>
          <div style={{ marginTop: 4 }}>
            <Tag color="blue" style={{ margin: 0 }}>
              v1.2.34
            </Tag>
          </div>
        </div>
        <Menu
          theme={theme}
          mode="inline"
          selectedKeys={[selectedKey]}
          items={navItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            padding: "0 24px",
            background: theme === "dark" ? "#141414" : "#fff",
            borderBottom: theme === "dark" ? "1px solid #303030" : "1px solid #f0f0f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text type="secondary">
            {navItems.find((i) => i.key === selectedKey)?.label}
          </Text>
          <Space>
            <Switch
              checkedChildren={<MoonOutlined />}
              unCheckedChildren={<SunOutlined />}
              checked={theme === "dark"}
              onChange={(checked) => setTheme(checked ? "dark" : "light")}
            />
          </Space>
        </Header>
        <Content style={{ padding: "24px", overflow: "auto" }}>
          <Outlet />
        </Content>
      </Layout>
      <NoticeManager />
      <ConfirmManager />
    </Layout>
  );
};
