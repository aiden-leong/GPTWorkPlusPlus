// Stepwise 配置测试 — 对应 Rust crates/codex-plus-core/src/stepwise.rs
//
// Stepwise 是用大模型生成"下一步建议"（chat completions → JSON {items: [...]}）
// test 调用：发一个简单的"测试 Stepwise 配置"prompt，看 upstream 返回的 item 数量。
//
// settings 字段（与 settings.rs 同步）：
// - codexAppStepwiseEnabled
// - codexAppStepwiseBaseUrl
// - codexAppStepwiseApiKey / codexAppStepwiseApiKeyEnv
// - codexAppStepwiseModel
// - codexAppStepwiseMaxItems
// - codexAppStepwiseTimeoutMs

const DEFAULT_TIMEOUT_MS = 10_000;

function stepwiseApiKey(settings) {
  const direct = (settings.codexAppStepwiseApiKey ?? "").trim();
  if (direct) return direct;
  const envName = (settings.codexAppStepwiseApiKeyEnv ?? "").trim();
  if (envName) {
    const envValue = (process.env[envName] ?? "").trim();
    if (envValue) return envValue;
  }
  return "";
}

function clampItems(value, maxItems) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const prompt =
      (typeof raw === "string" ? raw : raw?.prompt ?? raw?.text ?? raw?.action ?? raw?.content ?? "")
        .toString()
        .replace(/\s+/g, " ")
        .trim();
    if (!prompt || seen.has(prompt)) continue;
    seen.add(prompt);
    out.push(prompt);
    if (out.length >= maxItems) break;
  }
  return out;
}

function extractItemsFromResponse(data, maxItems) {
  if (!data || typeof data !== "object") return [];
  // choices[0].message.content 可能是 JSON 字符串
  const choices = Array.isArray(data.choices) ? data.choices : [];
  if (choices.length > 0) {
    const content = choices[0]?.message?.content;
    if (typeof content === "string") {
      try {
        const parsed = JSON.parse(content);
        const items = clampItems(parsed.items ?? parsed.suggestions ?? parsed, maxItems);
        if (items.length > 0) return items;
      } catch {
        // 非 JSON 字符串，跳过
      }
    }
  }
  for (const key of ["items", "suggestions", "nextSteps", "actions", "prompts"]) {
    if (Array.isArray(data[key])) {
      const items = clampItems(data[key], maxItems);
      if (items.length > 0) return items;
    }
  }
  return [];
}

export async function testStepwiseSettings(settings) {
  if (!settings?.codexAppStepwiseEnabled) {
    return {
      status: "failed",
      message: "Stepwise 未启用",
      itemCount: 0,
      error: "Stepwise 未启用",
    };
  }
  const baseUrl = (settings.codexAppStepwiseBaseUrl ?? "").trim().replace(/\/+$/, "");
  const apiKey = stepwiseApiKey(settings);
  const model = (settings.codexAppStepwiseModel ?? "").trim();
  const maxItems = Math.max(1, Math.min(6, Number(settings.codexAppStepwiseMaxItems ?? 3)));
  const timeoutMs = Math.max(1000, Math.min(120_000, Number(settings.codexAppStepwiseTimeoutMs ?? DEFAULT_TIMEOUT_MS)));

  if (!baseUrl) {
    return {
      status: "failed",
      message: "Stepwise Base URL 未配置",
      itemCount: 0,
      error: "Base URL 为空",
    };
  }
  if (!model) {
    return {
      status: "failed",
      message: "Stepwise Model 未配置",
      itemCount: 0,
      error: "Model 为空",
    };
  }
  if (!apiKey) {
    return {
      status: "failed",
      message: "Stepwise API Key 未配置",
      itemCount: 0,
      error: "API Key 为空",
    };
  }

  const endpoint = `${baseUrl}/chat/completions`;
  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          'You generate concise Codex Stepwise actions. Return strict JSON only: {"items":[{"prompt":"..."}]}',
      },
      {
        role: "user",
        content: JSON.stringify({
          lastUserMessage: "测试 Stepwise 配置。",
          lastAssistantMessage: "Stepwise 应返回 0 到 6 条建议。",
          languageInput: "测试",
          threadTitle: "Codex++ Stepwise test",
          pageUrl: "",
          maxItems,
        }),
      },
    ],
    temperature: 0.2,
    max_tokens: Math.max(50, Number(settings.codexAppStepwiseMaxOutputTokens ?? 200)),
    response_format: { type: "json_object" },
  };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        status: "failed",
        message: `Stepwise upstream ${res.status}`,
        itemCount: 0,
        error: text.slice(0, 240) || `HTTP ${res.status}`,
      };
    }
    const data = await res.json().catch(() => ({}));
    const items = extractItemsFromResponse(data, maxItems);
    if (items.length === 0) {
      return {
        status: "failed",
        message: "Stepwise 返回 0 条建议",
        itemCount: 0,
        error: "返回中未找到 items 数组",
      };
    }
    return {
      status: "ok",
      message: `Stepwise 返回 ${items.length} 条建议`,
      itemCount: items.length,
      error: "",
    };
  } catch (err) {
    return {
      status: "failed",
      message: `Stepwise 测试失败：${err?.message ?? String(err)}`,
      itemCount: 0,
      error: err?.message ?? String(err),
    };
  }
}
