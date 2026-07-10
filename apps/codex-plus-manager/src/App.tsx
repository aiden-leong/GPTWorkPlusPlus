// 根组件 - 启动主题加载、初始化 stores
// 已迁移到 React Router + AntD Layout

import { useEffect } from "react";
import { useSettingsStore, useOverviewStore, useLogsStore, useRelayStore } from "@/lib/store";
import { api as tauri } from "@/lib/api";

export const App = () => {
  const setSettings = useSettingsStore((s) => s.setSettings);
  const setRelay = useRelayStore((s) => s.setRelay);
  const setOverview = useOverviewStore((s) => s.setOverview);
  const setWatcher = useLogsStore((s) => s.setWatcher);

  useEffect(() => {
    // 启动时并行加载全局数据
    Promise.all([
      tauri.loadSettings(),
      tauri.relayStatus(),
      tauri.loadOverview(),
      tauri.loadWatcherState(),
    ]).then(([s, r, o, w]) => {
      if (s) setSettings(s);
      if (r) setRelay(r);
      if (o) setOverview(o);
      if (w) setWatcher(w);
    });
  }, [setSettings, setRelay, setOverview, setWatcher]);

  return null;
};
