// 全局 Notice 消息显示 - AntD App.useApp + zustand 桥接
// 显示来自 store 的全局通知

import { useEffect } from "react";
import { App as AntdApp, notification } from "antd";
import { useUIStore } from "@/lib/store";

export const NoticeManager = () => {
  const notice = useUIStore((s) => s.notice);
  const setNotice = useUIStore((s) => s.setNotice);
  const { message } = AntdApp.useApp();

  useEffect(() => {
    if (!notice) return;
    const { title, message: msg, status } = notice;
    if (status === "ok") {
      message.success(`${title}：${msg}`);
    } else if (status === "failed") {
      message.error(`${title}：${msg}`);
    } else {
      notification.info({
        message: title,
        description: msg,
        placement: "topRight",
      });
    }
    setNotice(null);
  }, [notice, message, setNotice]);

  return null;
};
