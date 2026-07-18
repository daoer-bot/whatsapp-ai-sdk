/**
 * content/options.js — 扩展设置页
 */

import { getDefaultAiConfig, loadAiConfig, saveAiConfig } from '../core/ai-config.js';

const form = document.getElementById('config-form');
const statusEl = document.getElementById('status');

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#dc2626' : '#047857';
}

function fillForm(config) {
  form.provider.value = config.provider || 'dify';
  form.baseUrl.value = config.baseUrl || '';
  form.apiKey.value = config.apiKey || '';
  form.prompt.value = config.prompt || '';
  if (form.polishPrompt) {
    form.polishPrompt.value = config.polishPrompt || '';
  }
}

async function init() {
  try {
    const config = await loadAiConfig();
    fillForm(config);
  } catch (error) {
    fillForm(getDefaultAiConfig());
    setStatus(`加载配置失败：${error?.message || error}`, true);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('保存中...');

  try {
    await saveAiConfig({
      provider: form.provider.value,
      baseUrl: form.baseUrl.value.trim(),
      apiKey: form.apiKey.value.trim(),
      prompt: form.prompt.value.trim(),
      polishPrompt: form.polishPrompt ? form.polishPrompt.value.trim() : '',
    });
    setStatus('配置已保存');
  } catch (error) {
    setStatus(`保存失败：${error?.message || error}`, true);
  }
});

init();
