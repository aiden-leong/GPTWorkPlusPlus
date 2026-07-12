# ChatGPT Patcher 计划

## 背景

Codex.app 已并入 ChatGPT.app。本项目从"独立管理工具"转型为"对 ChatGPT.app 做补丁的工具"。

## 目标

- **新项目名**：ChatGPT Patcher
- **Patcher.app**：拖入 `/Applications/ChatGPT.app` → 输出 `/Applications/ChatGPT++.app`
- **不修改原 ChatGPT.app**：原文件完全不动
- **ChatGPT++.app**：内含原 ChatGPT + 管理工具，双击同时启动两者

## 架构

```
ChatGPT Patcher (仓库)
└── apps/chatgpt-patcher/         # 重命名自 codex-plus-manager
    ├── electron/
    │   ├── patcher-main.cjs      # Patcher.app 入口 (拖拽 UI host)
    │   ├── patcher-preload.js
    │   ├── patcher.html/css/js   # vanilla 拖拽 UI（不上 React）
    │   ├── wrapper-main.cjs      # 嵌入 ChatGPT++.app 的 wrapper (替代原 MacOS/ChatGPT)
    │   └── wrapper-preload.js
    ├── payload/                  # 嵌入到 ChatGPT++.app 的内容
    │   ├── manager/              # 旧管理工具
    │   │   ├── server/           # Node 后端
    │   │   ├── dist/             # Vite 静态产物
    │   │   └── electron/         # 管理工具 BrowserWindow preload
    │   └── icon.icns             # 补丁后 ChatGPT++.app 用的图标
    ├── server/                   # 同 payload/manager/server/ (开发用)
    ├── src/                      # React 前端 (开发用)
    └── ...
```

## 流程

### 1. 构建
- `npm run build:patcher` → 出 `release/Patcher.app` (Patcher.app dmg)
- payload 在构建时自动嵌入 Patcher.app 的 `Resources/payload/`

### 2. Patcher.app 工作流
1. 用户双击 Patcher.app
2. 拖拽区显示 "拖入 /Applications/ChatGPT.app"
3. 验证 Info.plist 是合法 .app
4. 在 `/Applications/` 创建 `ChatGPT++.app/`：
   - 复制原 `Contents/*`（除 MacOS/ChatGPT 自身）
   - 把原 `MacOS/ChatGPT` 移到 `Resources/.original_chatgpt/...`
   - 替换 `MacOS/ChatGPT` 为我们的 wrapper 二进制 (electron + wrapper-main.cjs)
   - 把 `payload/manager/` 拷到 `Resources/manager/`
   - 改 Info.plist 的 CFBundleIdentifier（加 `.patched`）
5. 显示 "完成！点击打开 ChatGPT++.app"

### 3. ChatGPT++.app 启动 (wrapper-main.cjs)
1. 启动时：spawn `Resources/.original_chatgpt/<原 MacOS/ChatGPT>`
2. spawn `Resources/manager/server/index.js`（后台 API）
3. 打开 BrowserWindow，加载 `codex://` 协议 → 管理 UI
4. 退出时 kill 两者

## 关键决策

1. **wrapper = electron 二进制重命名**
   - Patcher 替换 MacOS/ChatGPT 时，把 Patcher 自带的 Electron binary 拷过去
   - 配 Resources/app.asar 包含 wrapper-main.cjs
   - CFBundleExecutable 仍叫 "ChatGPT"（匹配原 .app 名）

2. **不签名 / 公证**
   - 跟之前一样：本地用，右键打开
   - 后续可加 Apple Developer ID

3. **UI 简化**
   - Patcher.app 不用 React，vanilla HTML 拖拽即可
   - 大幅减小 Patcher.app 体积

4. **payload 共享**
   - `payload/manager/server/` 跟开发时的 `server/` 是同一份（构建时拷贝）
   - Vite build 产物也在 payload/manager/dist/

## 实施步骤

1. ✅ Plan doc
2. [ ] 新建 worktree `feature/chatgpt-patcher`（继承 `feature/electron-app`）
3. [ ] 改名 `codex-plus-manager` → `chatgpt-patcher`
4. [ ] 写 Patcher UI（vanilla HTML drag-drop）
5. [ ] 写 wrapper main.cjs（ChatGPT++.app 启动逻辑）
6. [ ] 拆 payload 目录
7. [ ] 配 electron-builder（Patcher.app + ChatGPT++.app template）
8. [ ] 测试 Patcher 用 dummy .app
9. [ ] commit + push origin

## 测试方案

本机没有 ChatGPT.app 真实安装。做 dummy .app 模拟：

```bash
mkdir -p /tmp/dummy-chatgpt/Contents/MacOS
cat > /tmp/dummy-chatgpt/Contents/Info.plist <<EOF
<plist><dict>
  <key>CFBundleIdentifier</key><string>com.openai.chatgpt</string>
  <key>CFBundleExecutable</key><string>ChatGPT</string>
  <key>CFBundleName</key><string>ChatGPT</string>
</dict></plist>
EOF
echo '#!/bin/sh' > /tmp/dummy-chatgpt/Contents/MacOS/ChatGPT
echo 'echo "fake ChatGPT running"; sleep 999' >> /tmp/dummy-chatgpt/Contents/MacOS/ChatGPT
chmod +x /tmp/dummy-chatgpt/Contents/MacOS/ChatGPT
```

Patcher 拖入这个 dummy → 出 /tmp/dummy-chatgpt++.app → 双击验证：
- dummy ChatGPT 启动
- 管理 UI 启动
- 退出关掉两者
