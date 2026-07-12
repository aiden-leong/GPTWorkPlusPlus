// ChatGPT++ 管理 UI
// 加载应用信息 + tab 切换

const { ipcRenderer } = require('electron');

// Tab 切换
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(target).classList.add('active');
    if (target === 'info') loadAppInfo();
  });
});

async function loadAppInfo() {
  const el = document.getElementById('app-info');
  el.textContent = '加载中...';
  try {
    const info = await ipcRenderer.invoke('chatgpt-plus:get-app-info');
    el.textContent = JSON.stringify(info, null, 2);
  } catch (err) {
    el.textContent = '加载失败: ' + err.message;
  }
}

document.getElementById('refresh-info').addEventListener('click', loadAppInfo);

// 自动加载 info tab
loadAppInfo();
