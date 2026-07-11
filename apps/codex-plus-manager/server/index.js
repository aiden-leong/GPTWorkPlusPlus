// HTTP API bridge — Node.js implementation
// 替代 Rust Axum server。所有端点都通过 POST /api/bridge 派发，
// 请求体为 { path, ...args }，响应体为 { ok, data }，
// data 内部含 CommandResult 形状的 status/message + 业务字段。
//
// 用法与原 Tauri commands.rs / Axum 保持一致：每个 handler 返回
// `{ status, message, ...payload }` 形态的 JSON 对象。

import express from "express";
import cors from "cors";
import * as handlers from "./handlers.js";

const PORT = Number(process.env.PORT || 29999);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "http://127.0.0.1:5173";

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(
  cors({
    origin: [ALLOWED_ORIGIN, "http://localhost:5173"],
    credentials: false,
  })
);

// 健康检查
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "0.0.0-node", impl: "node" });
});

// 派发端点：所有业务请求都走这里
app.post("/api/bridge", async (req, res) => {
  const { path, ...args } = req.body || {};
  if (typeof path !== "string") {
    return res.status(400).json({ ok: false, error: "path is required" });
  }
  const handler = handlers.PATH_TABLE[path];
  if (!handler) {
    return res.json({
      ok: true,
      data: {
        status: "failed",
        message: `Unknown bridge path: ${path}`,
      },
    });
  }
  try {
    const data = await handler(args);
    res.json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.json({
      ok: true,
      data: { status: "failed", message },
    });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[codex-plus-server-node] listening on http://127.0.0.1:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[codex-plus-server-node] CORS: ${ALLOWED_ORIGIN}`);
});
