// ChatGPT++ inject hook
// 注入到原 ChatGPT main 开头 (prepend)
// 添加 "管理" 菜单项 + 打开管理窗口 (admin-ui/index.html)
//
// 用法 (在原 main 顶部):
//   require('chatgpt-plus-hook');  // ← 这行被 patcher prepend
//   // 下面是原 main 代码
//
// 实现:
// - 注册 "管理" menu item 到应用菜单
// - 点 menu item 打开 BrowserWindow 加载 admin-ui/index.html
// - 用 IPC 跟 admin UI 通信 (暴露原 app 的 API)

const { app, BrowserWindow, Menu, MenuItem, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// admin UI 路径
// 我们的资源在 Contents/Resources/admin-ui/
// 原 main 在 Contents/Resources/app/main.js
// 相对路径从 main.js 算: ../../admin-ui/
const ADMIN_UI_DIR = path.resolve(__dirname, '..', '..', 'admin-ui');
const ADMIN_UI_INDEX = path.join(ADMIN_UI_DIR, 'index.html');

let adminWindow = null;

function openAdminWindow() {
  if (adminWindow && !adminWindow.isDestroyed()) {
    adminWindow.focus();
    return;
  }
  if (!fs.existsSync(ADMIN_UI_INDEX)) {
    console.error('[ChatGPT++] admin UI not found at', ADMIN_UI_INDEX);
    return;
  }
  adminWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    title: 'ChatGPT++ 管理',
    backgroundColor: '#0d1117',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  adminWindow.loadFile(ADMIN_UI_INDEX);
  adminWindow.on('closed', () => {
    adminWindow = null;
  });
}

function installMenu() {
  // 等待 app ready + 原 main 注册完 menu 后再加
  app.whenReady().then(() => {
    setTimeout(() => {
      const existingMenu = Menu.getApplicationMenu();
      const newItem = new MenuItem({
        label: '管理',
        submenu: Menu.buildFromTemplate([
          {
            label: '打开管理面板',
            accelerator: 'CmdOrCtrl+Shift+M',
            click: () => openAdminWindow(),
          },
          {
            label: '关于 ChatGPT++',
            click: () => {
              const { dialog } = require('electron');
              dialog.showMessageBox({
                type: 'info',
                title: 'ChatGPT++',
                message: 'ChatGPT++ 管理工具',
                detail: '基于 ChatGPT Patcher\nPatched by Hefei Ragdoll Technology Co.,Ltd.',
              });
            },
          },
        ]),
      });
      if (existingMenu) {
        existingMenu.append(newItem);
      } else {
        Menu.setApplicationMenu(Menu.buildFromTemplate([newItem]));
      }
    }, 100);  // 给原 main 一点时间注册 menu
  });
}

installMenu();

// IPC: admin UI 查询 app info
ipcMain.handle('chatgpt-plus:get-app-info', () => ({
  version: app.getVersion(),
  name: app.getName(),
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node,
  platform: process.platform,
  appPath: app.getAppPath(),
}));

// 暴露到 global 让 admin UI 能访问
global.chatgptPlus = {
  openAdminWindow,
  getAppInfo: () => ({
    version: app.getVersion(),
    name: app.getName(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
    appPath: app.getAppPath(),
  }),
};

console.log('[ChatGPT++] hook installed');
