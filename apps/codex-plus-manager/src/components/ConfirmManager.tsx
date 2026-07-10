// 全局 confirm dialog - AntD Modal + promise
// 用于替代原 App.tsx 中的 confirmDialog state

import { useState, useEffect } from "react";
import { App as AntdApp } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";

type PendingConfirm = {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  resolve: (confirmed: boolean) => void;
};

let pendingConfirm: PendingConfirm | null = null;
const listeners = new Set<(c: PendingConfirm | null) => void>();

export const globalConfirm = (opts: {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}): Promise<boolean> => {
  return new Promise((resolve) => {
    pendingConfirm = {
      title: opts.title,
      message: opts.message,
      confirmText: opts.confirmText ?? "确认",
      cancelText: opts.cancelText ?? "取消",
      resolve,
    };
    listeners.forEach((cb) => cb(pendingConfirm));
  });
};

export const ConfirmManager = () => {
  const { modal } = AntdApp.useApp();
  const [confirm, setConfirm] = useState<PendingConfirm | null>(pendingConfirm);

  useEffect(() => {
    const cb = (c: PendingConfirm | null) => setConfirm(c);
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);

  useEffect(() => {
    if (!confirm) return;
    const modalInstance = modal.confirm({
      title: confirm.title,
      icon: <ExclamationCircleOutlined />,
      content: confirm.message,
      okText: confirm.confirmText,
      cancelText: confirm.cancelText,
      onOk: () => {
        confirm.resolve(true);
        pendingConfirm = null;
        listeners.forEach((cb) => cb(null));
      },
      onCancel: () => {
        confirm.resolve(false);
        pendingConfirm = null;
        listeners.forEach((cb) => cb(null));
      },
    });
    return () => {
      modalInstance.destroy();
    };
  }, [confirm, modal]);

  return null;
};
