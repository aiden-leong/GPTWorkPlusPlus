// 工具函数 - 错误处理、状态判定、时间格式化

import type { Status } from "./types";

export const isSuccessStatus = (status: Status | undefined | null): boolean => {
  if (!status) return false;
  return status === "ok" || status === "not_implemented";
};

export const isFailedStatus = (status: Status | undefined | null): boolean => {
  if (!status) return true;
  return status !== "ok" && status !== "not_implemented";
};

export const stringifyError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export const formatTime = (value: number | null | undefined): string => {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN");
};

export const formatDuration = (startedAtMs: number | null | undefined): string => {
  if (!startedAtMs) return "-";
  const elapsed = Date.now() - startedAtMs;
  if (elapsed < 0) return formatTime(startedAtMs);
  const mins = Math.floor(elapsed / 60000);
  if (mins < 1) return "刚刚启动";
  if (mins < 60) return `已运行 ${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `已运行 ${hours} 小时 ${remainMins} 分钟`;
};

export const truncateSessionDeletePreview = (s: string): string => {
  if (s.length <= 30) return s;
  return s.slice(0, 28) + "…";
};

/** 通用 try-catch 包装器：用于 tauri invoke 调用 */
export const safeCall = async <T>(fn: () => Promise<T>): Promise<T | null> => {
  try {
    return await fn();
  } catch (error) {
    console.error("tauri call failed:", error);
    return null;
  }
};
