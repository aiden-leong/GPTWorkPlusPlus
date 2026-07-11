import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    // 拆分 vendor 块减少初始加载体积
    // - react/react-dom 几乎所有页面都要 → 拆出独立 chunk
    // - antd + 字体库占大头（>500KB）→ 单独拆
    // - router + zustand + sortablejs 一起拆
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return;
          // React 核心
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) {
            return "vendor-react";
          }
          // React Router
          if (id.includes("/react-router") || id.includes("/@remix-run/")) {
            return "vendor-router";
          }
          // 状态管理
          if (id.includes("/zustand/") || id.includes("/use-sync-external-store/")) {
            return "vendor-store";
          }
          // Antd 全家桶（包含 @ant-design/icons、rc-*）
          if (
            id.includes("/antd/") ||
            id.includes("/@ant-design/") ||
            id.includes("/rc-") ||
            id.includes("/@rc-component/")
          ) {
            return "vendor-antd";
          }
          // 字体
          if (id.includes("/@fontsource/")) {
            return "vendor-fonts";
          }
          // 拖拽
          if (id.includes("/sortablejs/")) {
            return "vendor-sortable";
          }
          return "vendor";
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
