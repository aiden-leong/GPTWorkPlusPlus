// ChatGPT Patcher UI logic
// 拖拽 / 选文件 / 调主进程 patch

const dz = document.getElementById("dropzone");
const promptEl = document.getElementById("prompt");
const pickBtn = document.getElementById("pickBtn");
const patchBtn = document.getElementById("patchBtn");
const infoEl = document.getElementById("info");
const resultEl = document.getElementById("result");
const errorEl = document.getElementById("error");
const logsEl = document.getElementById("log-content");

let currentApp = null;

// ===== 拖拽 =====
["dragenter", "dragover"].forEach(evt => {
  dz.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dz.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach(evt => {
  dz.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dz.classList.remove("dragover");
  });
});

dz.addEventListener("drop", async (e) => {
  const files = Array.from(e.dataTransfer.files);
  for (const f of files) {
    // Electron 暴露 file.path
    if (f.path) {
      await loadApp(f.path);
      return;
    }
  }
  showError("没拿到文件路径，请用选择按钮");
});

dz.addEventListener("click", async (e) => {
  if (e.target.closest("button")) return;
  await pickApp();
});

pickBtn.addEventListener("click", pickApp);

async function pickApp() {
  const p = await window.patcher.pickApp();
  if (p) await loadApp(p);
}

patchBtn.addEventListener("click", doPatch);

openBtn.addEventListener("click", async () => {
  if (currentApp?._target) {
    await window.patcher.openPath(currentApp._target);
  }
});
revealBtn.addEventListener("click", async () => {
  if (currentApp?._target) {
    await window.patcher.revealInFinder(currentApp._target);
  }
});

// ===== 加载 + 校验 =====
async function loadApp(appPath) {
  hideError(); hideResult();
  try {
    const info = await window.patcher.inspect(appPath);
    currentApp = { ...info, _target: appPath.replace(/\.app$/, "++.app") };
    showInfo(currentApp);
    patchBtn.disabled = false;
    dz.classList.add("valid");
    log(`✓ 校验通过: ${info.name} (${info.bundleId} v${info.version})`);
  } catch (err) {
    currentApp = null;
    patchBtn.disabled = true;
    dz.classList.add("invalid");
    showError(err.message || String(err));
    log(`✗ ${err.message}`);
  }
}

function showInfo(info) {
  document.getElementById("info-path").textContent = info.path;
  document.getElementById("info-bundleid").textContent = info.bundleId;
  document.getElementById("info-version").textContent = info.version;
  document.getElementById("info-target").textContent = info._target;
  infoEl.classList.remove("hidden");
}

function hideInfo() { infoEl.classList.add("hidden"); }

// ===== patch =====
async function doPatch() {
  if (!currentApp) return;
  patchBtn.disabled = true;
  patchBtn.textContent = "打补丁中…";
  hideError(); hideResult();
  log(`→ 开始 patch: ${currentApp.path}`);
  try {
    const result = await window.patcher.patch(currentApp.path);
    currentApp._target = result.target;
    showResult(result);
    log(`✓ 完成: ${result.target}`);
  } catch (err) {
    showError(err.message || String(err));
    log(`✗ ${err.message}`);
  } finally {
    patchBtn.disabled = false;
    patchBtn.textContent = "打补丁 → 生成 ChatGPT++.app";
  }
}

function showResult(result) {
  document.getElementById("result-path").textContent = result.target;
  resultEl.classList.remove("hidden");
}
function hideResult() { resultEl.classList.add("hidden"); }

function showError(msg) {
  document.getElementById("error-msg").textContent = msg;
  errorEl.classList.remove("hidden");
}
function hideError() { errorEl.classList.add("hidden"); }

// ===== log =====
function log(msg) {
  const ts = new Date().toLocaleTimeString();
  logsEl.textContent += `[${ts}] ${msg}\n`;
  logsEl.scrollTop = logsEl.scrollHeight;
}

window.patcher.onLog((msg) => log(msg));
