# ChatGPT Patcher

把 `/Applications/ChatGPT.app` 拖入 Patcher，输出 `/Applications/ChatGPT++.app`，不修改原 ChatGPT.app。

## 用法

```bash
# 开发
npm run patcher:dev          # vite dev (5173) + electron (patcher UI)
npm run dev                  # 仅 vite dev (管理 UI)

# 构建
npm run build                # vite build 管理 UI
npm run payload              # 把 dist/ + server/ 拷到 payload/manager/
npm run patcher:build        # 出 Patcher.app dmg + zip (x64+arm64)
npm run patcher:build:dir    # 只出 .app bundle (快速验证)

# 双击
open release/mac-arm64/ChatGPT\ Patcher.app
```

## 工作流程

### 1. 拖拽 / 选择 ChatGPT.app

Patcher UI 接受 .app 拖入，验证 Info.plist。

### 2. 打补丁

Patcher 复制整个 .app 到 `ChatGPT++.app`，然后：
- 移动原 `Contents/MacOS/<exec>` 到 `Resources/.original_chatgpt/`
- 替换 `Contents/MacOS/<exec>` 为 wrapper 二进制
- 拷 `Frameworks/` (electron framework + helper apps)
- 重命名 helper apps 匹配新 `CFBundleName`
- 嵌入 `payload/manager/` (管理后端 + 前端)
- 拷 `app.asar` (wrapper 逻辑)
- 加 `PkgInfo`
- 用 Patcher.app 的 Info.plist 当模板，改 CFBundleIdentifier (加 .patched) + CFBundleName (加 ++)

### 3. 双击 ChatGPT++.app

wrapper 启动后：
- 启动后端 (Node server on :random)
- 启动原 ChatGPT (从 `Resources/.original_chatgpt/...`)
- 打开管理 UI (codex:// custom protocol)
- 退出时 kill 两者

## 限制

### ⚠️ Patched .app 启动需要 Apple Developer ID 签名

**当前状态**：patch 文件操作完全成功，但 patched app 启动时 macOS AMFI 拒绝加载 Patcher 自带的 Electron framework (`Error -423: adhoc signed or signed by an unknown certificate chain`)。

**原因**：
- `electron-builder` 打包时用 `electron-osx-sign` 工具给 framework 加签名，那个签名用 electron-builder 内部缓存的 Apple 证书
- 我们 `cp` 拷 framework 后 `codesign --force --sign -` 只产生 ad-hoc 签名，macOS Sonoma+ 严格模式不信任
- 需要 Apple Developer ID 证书 + 公证流程

**解决方案**（任选一）：
1. 申请 Apple Developer ID ($99/year)，用 `electron-osx-sign` 配 `--identity "Developer ID Application: Your Name"` + `notarytool` 公证
2. 用 Patcher.app 启动（已经签好），让 patched app 不嵌 framework 只引 Patcher.app — 不优雅
3. 接受运行时启动限制，用 `xattr -d com.apple.quarantine` 解除 quarantine + 手动允许 — 不优雅

### 已知兼容性

- macOS 14+ (Sonoma) 严格签名
- macOS 10.15-13 可能 ad-hoc 签名 OK
- 没有签名时 Patcher.app 第一次启动需要右键打开（macOS Gatekeeper）

## 文件结构

```
apps/chatgpt-patcher/
├── electron/
│   ├── patcher-main.cjs        # Patcher + Wrapper 双模式入口
│   ├── patcher-preload.js      # Patcher UI 的 contextBridge
│   └── wrapper-preload.js      # Wrapper 模式的 contextBridge
├── patcher.html/css/js         # 拖拽 UI (vanilla)
├── src/                        # React 管理 UI (开发)
├── server/                     # Node 后端 (开发)
├── scripts/
│   ├── build-payload.mjs       # dist/ + server/ -> payload/manager/
│   └── test-patch.mjs          # patch 逻辑独立测试
├── payload/                    # 构建产物 (gitignore)
└── release/                    # electron-builder 产物 (gitignore)
```

## 开发

```bash
# 工作流
1. 改 src/ 或 server/
2. npm run build              # vite build (前端)
3. npm run payload            # 嵌入到 payload/manager/
4. npm run patcher:build:dir  # 出 .app

# 调试
- ~/chatgpt-patcher.log       # Patcher 模式日志
- ~/chatgpt-plus.log          # Wrapper 模式日志
- /tmp/early-boot.log         # 最早启动 log (用于诊断)
```

## 架构

### Patcher 模式 (Patcher.app 双击启动)
- `electron/patcher-main.cjs` 顶部 `MODE === "patcher"`
- 创建 BrowserWindow 加载 `patcher.html`
- IPC handler: `inspect / patch / pickApp / openPath / revealInFinder`
- 拖入 .app → 调 `patch` handler → 输出 `ChatGPT++.app`

### Wrapper 模式 (ChatGPT++.app 双击启动)
- `electron/patcher-main.cjs` 顶部 `MODE === "wrapper"`
- 启动 `Resources/.original_chatgpt/Contents/MacOS/<exec>` (原 ChatGPT)
- 启动 `Resources/manager/server/index.js` (后端)
- 打开 BrowserWindow 加载 `codex://app/index.html` (管理 UI)
- 注册 `codex://` custom protocol 反向代理到后端
