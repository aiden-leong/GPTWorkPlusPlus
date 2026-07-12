// 上游 /v1/models HTTP 探测
// 对应 Rust crates/codex-plus-core/src/model_catalog.rs::fetch_relay_profile_model_ids
// 和 test_relay_profile / diagnose_relay_profile

const DEFAULT_TIMEOUT_MS = 10_000;

function headersFor(apiKey) {
  const h = { "Content-Type": "application/json" };
  if (apiKey && apiKey.trim()) {
    h["Authorization"] = `Bearer ${apiKey.trim()}`;
  }
  return h;
}

function endpointsFor(baseUrl) {
  const u = baseUrl.trim().replace(/\/+$/, "");
  return [`${u}/v1/models`, `${u}/models`];
}

function isAuthError(status) {
  return status === 401 || status === 403;
}

export async function fetchRelayProfileModels(profile) {
  const baseUrl = profile?.baseUrl ?? profile?.upstreamBaseUrl ?? "";
  const apiKey = profile?.apiKey ?? "";
  if (!baseUrl) {
    return { models: [], endpoint: "", error: "Base URL 为空" };
  }
  const headers = headersFor(apiKey);
  for (const endpoint of endpointsFor(baseUrl)) {
    try {
      const res = await fetch(endpoint, { method: "GET", headers, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
      if (!res.ok) {
        if (isAuthError(res.status)) {
          return { models: [], endpoint, error: `鉴权失败 (HTTP ${res.status})` };
        }
        continue;
      }
      const data = await res.json();
      const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      const models = list
        .map((m) => (typeof m === "string" ? m : m?.id))
        .filter((s) => typeof s === "string" && s.length > 0);
      return { models, endpoint };
    } catch (err) {
      // 试下一个 endpoint
      continue;
    }
  }
  return { models: [], endpoint: endpointsFor(baseUrl)[0], error: "所有 endpoint 都失败" };
}

export async function testRelayProfile(profile) {
  const baseUrl = profile?.baseUrl ?? profile?.upstreamBaseUrl ?? "";
  const apiKey = profile?.apiKey ?? "";
  const model = profile?.testModel ?? profile?.model ?? "";
  if (!baseUrl) {
    return { httpStatus: 0, endpoint: "", responsePreview: "Base URL 为空" };
  }
  const endpoint = `${baseUrl.trim().replace(/\/+$/, "")}/v1/chat/completions`;
  const headers = headersFor(apiKey);
  const body = JSON.stringify({
    model: model || "gpt-4o-mini",
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 1,
  });
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");
    return {
      httpStatus: res.status,
      endpoint,
      responsePreview: text.slice(0, 500),
    };
  } catch (err) {
    return {
      httpStatus: 0,
      endpoint,
      responsePreview: err?.message ?? String(err),
    };
  }
}

export async function diagnoseRelayProfile(profile) {
  const checks = [];
  const baseUrl = profile?.baseUrl ?? profile?.upstreamBaseUrl ?? "";
  const apiKey = profile?.apiKey ?? "";
  const model = profile?.testModel ?? profile?.model ?? "";

  // Check 1: 配置完整性
  if (!baseUrl || !apiKey) {
    checks.push({
      id: "config",
      title: "配置完整性",
      status: "failed",
      detail: !baseUrl ? "Base URL 为空" : "API Key 为空",
    });
  } else {
    checks.push({
      id: "config",
      title: "配置完整性",
      status: "ok",
      detail: `Base URL + API Key 已配置`,
    });
  }

  // Check 2: 模型列表
  let modelsResult = { models: [], endpoint: "", error: "" };
  if (baseUrl) {
    modelsResult = await fetchRelayProfileModels(profile);
    if (modelsResult.models.length > 0) {
      checks.push({
        id: "models",
        title: "模型列表",
        status: "ok",
        detail: `获取到 ${modelsResult.models.length} 个模型`,
      });
    } else {
      checks.push({
        id: "models",
        title: "模型列表",
        status: "failed",
        detail: modelsResult.error || "未获取到任何模型",
      });
    }
  } else {
    checks.push({
      id: "models",
      title: "模型列表",
      status: "not_checked",
      detail: "跳过（Base URL 为空）",
    });
  }

  // Check 3: 真实请求
  if (baseUrl && apiKey) {
    const test = await testRelayProfile(profile);
    if (test.httpStatus >= 200 && test.httpStatus < 400) {
      checks.push({
        id: "request",
        title: "真实请求",
        status: "ok",
        detail: `HTTP ${test.httpStatus}`,
      });
    } else {
      checks.push({
        id: "request",
        title: "真实请求",
        status: "failed",
        detail: test.httpStatus
          ? `HTTP ${test.httpStatus}: ${test.responsePreview.slice(0, 100)}`
          : test.responsePreview,
      });
    }
  } else {
    checks.push({
      id: "request",
      title: "真实请求",
      status: "not_checked",
      detail: "跳过（配置不完整）",
    });
  }

  const failed = checks.filter((c) => c.status === "failed").length;
  return {
    profileName: profile?.name ?? "",
    model,
    summary:
      failed === 0
        ? "所有检查通过"
        : `${failed} 项检查未通过`,
    recommendation:
      failed === 0
        ? "可以切换到该 profile"
        : "请检查 Base URL / API Key / 模型名是否正确",
    checks,
  };
}
