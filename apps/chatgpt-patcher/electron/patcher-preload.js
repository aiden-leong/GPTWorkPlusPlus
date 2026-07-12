// ChatGPT Patcher preload
// 暴露 ipcRenderer.invoke 包装给 renderer

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("patcher", {
  inspect: (appPath) => ipcRenderer.invoke("inspect", appPath),
  patch: (appPath) => ipcRenderer.invoke("patch", appPath),
  pickApp: () => ipcRenderer.invoke("pickApp"),
  openPath: (p) => ipcRenderer.invoke("openPath", p),
  revealInFinder: (p) => ipcRenderer.invoke("revealInFinder", p),
  onLog: (cb) => {
    const handler = (_evt, msg) => cb(msg);
    ipcRenderer.on("log", handler);
    return () => ipcRenderer.off("log", handler);
  },
});
