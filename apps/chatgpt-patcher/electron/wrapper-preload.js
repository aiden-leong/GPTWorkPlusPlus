// ChatGPT++.app wrapper preload
// 暴露受限 API 到 renderer
// 前端只用 fetch，不暴露 node 能力 — 但保留 contextBridge 通道

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("chatgptPlus", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
});
