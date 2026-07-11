// 入口 - AntD ConfigProvider + RouterProvider + 主题加载
// zh_CN locale 提供组件内置中文文案

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider, App as AntdApp, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { RouterProvider, createHashRouter, Navigate } from "react-router-dom";

import { MainLayout } from "@/layout/MainLayout";
import { Overview } from "@/pages/Overview";
import { Relay } from "@/pages/Relay";
import { Enhance } from "@/pages/Enhance";
import { UserScripts } from "@/pages/UserScripts";
import { Sessions } from "@/pages/Sessions";
import { Maintenance } from "@/pages/Maintenance";
import { About } from "@/pages/About";
import { App as AppBootstrap } from "@/App";
import { useUIStore } from "@/lib/store";

import "antd/dist/reset.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";

const router = createHashRouter([
  {
    path: "/",
    element: (
      <>
        <AppBootstrap />
        <MainLayout />
      </>
    ),
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      { path: "overview", element: <Overview /> },
      { path: "relay", element: <Relay /> },
      { path: "enhance", element: <Enhance /> },
      { path: "user-scripts", element: <UserScripts /> },
      { path: "sessions", element: <Sessions /> },
      { path: "maintenance", element: <Maintenance /> },
      { path: "about", element: <About /> },
      { path: "*", element: <Navigate to="/overview" replace /> },
    ],
  },
]);

const Root = () => {
  const theme = useUIStore((s) => s.theme);
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: "#1677ff",
          borderRadius: 6,
        },
      }}
    >
      <AntdApp>
        <RouterProvider router={router} />
      </AntdApp>
    </ConfigProvider>
  );
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
