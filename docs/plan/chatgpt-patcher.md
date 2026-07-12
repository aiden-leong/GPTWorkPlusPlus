# ChatGPT Patcher 计划 (v2 — Clone + Rebuild)

## 背景

Codex.app 已并入 ChatGPT.app。本项目从"独立管理工具"转型为"把 ChatGPT.app 改造成 ChatGPT++.app 的 Patcher"。

## 关键洞察（v2 架构）

**ChatGPT.app 本质上是个 Electron app**：里面装的是 Electron framework + JS 代码 + 资源。
我们**不用 patch 原 binary**，而是**克隆它的所有数据** + **重新打包成我们自己的 app**，**用我们自己的 Developer ID 签名**。

## 目标

- **新项目名**：ChatGPT Patcher
- **Patcher.app**：拖入 `/Applications/ChatGPT.app` → 输出 `/Applications/ChatGPT++.app`
- **不修改原 ChatGPT.app**：原文件完全不动
- **ChatGPT++.app**：本质是 Patcher 重新打包的 Electron app
  - 用我们的 Developer ID 签名（不是 ad-hoc）
  - 含原 ChatGPT 的所有功能（因为我们克隆了它的代码）
  - 加我们的管理功能（注入 hook 打开管理窗口）

## 架构

```
ChatGPT Patcher (项目)
└── apps/chatgpt-patcher/
    ├── electron/
    │   ├── patcher-main.cjs      # Patcher 主进程 (拖拽 + 克隆 + 重签)
    │   ├── patcher-preload.js
    │   └── patcher.html/css/js   # Patcher 拖拽 UI
    ├── inject/
    │   ├── hook.js               # 注入到原 ChatGPT main 的代码
    │   └── admin-ui/             # 管理 UI 静态文件 (HTML/CSS/JS)
    │       ├── index.html
    │       ├── admin.css
    │       └── admin.js
    └── scripts/
        └── build-payload.mjs     # 准备 inject/ 目录
```

## 流程

### 1. 构建 Patcher
- `npm run build:patcher` → `release/ChatGPT Patcher.app` (dmg + zip)
- Patcher.app 自带：拖拽 UI + inject/hook.js + inject/admin-ui/

### 2. Patcher.app 工作流
1. 用户双击 Patcher.app
2. 拖拽区显示"拖入 /Applications/ChatGPT.app"
3. 验证 Info.plist 是合法 Electron app（找 Electron framework）
4. 在 `/Applications/` 创建 `ChatGPT++.app`：
   a. **复制整个 .app bundle**
   b. **更新 Info.plist**：CFBundleIdentifier = `<原>.patched`，CFBundleName = `ChatGPT++`
   c. **注入管理 hook**：在 `Contents/Resources/app/` 的 main JS 文件开头 prepend 我们的 hook.js
      - hook.js 加 menu item "管理"
      - 点 menu item → 打开 BrowserWindow 加载 admin-ui/index.html
   d. **嵌入 admin-ui/** 到 `Contents/Resources/admin-ui/`
   e. **重新签名整个 .app**：用 Developer ID Application: Hefei Ragdoll (BR8ZH293JZ)
5. 显示"完成！双击 ChatGPT++.app 打开"

### 3. ChatGPT++.app 启动
1. macOS 加载 MacOS/ChatGPT（保留原 binary，未修改）
2. binary 启动 Electron framework（用我们提供的 framework，已用我们 Developer ID 签名）
3. Electron 加载 `Resources/app/` 下的 main（我们 prepend 了 hook）
4. **hook 执行**：注册 menu item "管理"
5. **原 main 继续执行**：原 ChatGPT UI 起来
6. 用户点 menu "管理" → 打开管理窗口（admin-ui/）

## 为什么这样能跑（v1 失败原因）

**v1 失败原因**：
- v1 patch 时把 Patcher 自带 Electron framework 拷过去 + 改 helper apps 名字 + ad-hoc 签名
- macOS AMFI 拒：`Error -423: adhoc signed or signed by an unknown certificate chain`
- 原因：Electron framework 是 macOS 严格签名的二进制，ad-hoc 签不被接受
- 改用 `disable-library-validation` entitlement 也不够：macOS 14+ Sonoma 严格模式不豁免 ad-hoc 签名的 app

**v2 解决方案**：
- 不嵌入原 framework 元素 — 我们用 Patcher 自带的 framework + 整个 .app 用 Developer ID 重签
- 所有 Mach-O 二进制（Electron framework, helper apps, MacOS/ChatGPT）都用同一 Developer ID 签名
- macOS 接受：Developer ID 签名的 framework + 相同 Team ID 加载 → 全部通过
- 实际上：electron-builder 已经在 release/ 阶段给 Patcher.app 的 framework 用了某类签名（可能是 Apple Distribution cert 签的），patched app 用我们的 Developer ID 重签后，**新 framework 也是同一 Developer ID 签的**，跟 helper 一致

## 实施步骤

1. ✅ 新 plan doc
2. [ ] 建一个真 Electron test app（验证 patch 流，不依赖 ChatGPT.app）
3. [ ] 写 inject/hook.js（加 menu + 打开管理窗口）
4. [ ] 写 inject/admin-ui/（vanilla HTML 管理 UI）
5. [ ] 重写 patcher-main.cjs：
   - 拖拽 UI 不变
   - patch 流程：clone + 改 plist + 注入 hook + 嵌入 admin-ui + Developer ID 重签
   - 用 `@electron/osx-sign` 或 `electron-osx-sign` 包
6. [ ] 测：build test app → patch → 双击跑通
7. [ ] commit + push

## 测试方案

### Test 1: Electron test app
```bash
# 建 test app: /tmp/test-electron-app.app
# 一个简单的 Electron app，显示 "Hello from TestApp"
# 跑 Patcher 拖入它 → /tmp/test-electron-app++.app
# 双击 test-electron-app++.app → 应该跑出原 UI + 菜单有"管理"
# 点"管理" → 打开管理窗口
```

### Test 2: 真实 ChatGPT.app
等用户提供 `/Applications/ChatGPT.app` 后跑同样流程。

## 文件结构

```
apps/chatgpt-patcher/
├── electron/
│   ├── patcher-main.cjs        # Patcher 主进程
│   ├── patcher-preload.js
│   └── patcher.html/css/js     # Patcher 拖拽 UI
├── inject/
│   ├── hook.js                 # 注入到原 main 的代码
│   └── admin-ui/               # 管理 UI
│       ├── index.html
│       ├── admin.css
│       └── admin.js
└── scripts/
    └── build-payload.mjs       # 准备 inject/ 目录 (build 时)
```
