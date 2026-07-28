/**
 * content/settings-drawer.js — WhatsApp 页内 AI 设置抽屉
 *
 * 不再跳到 chrome-extension://options.html 占一整页；
 * 在当前标签页以右侧抽屉呈现，读写同一套 chrome.storage 配置。
 */

import { getDefaultAiConfig, loadAiConfig, saveAiConfig } from '../core/ai-config.js';

const ROOT_ID = 'waai-settings-root';
const STYLE_ID = 'waai-settings-style';

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID} {
      position: fixed;
      inset: 0;
      z-index: 100000;
      display: none;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #111b21;
    }
    #${ROOT_ID}.is-open {
      display: block;
    }
    #${ROOT_ID} .waai-settings-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(11, 20, 26, 0.28);
      backdrop-filter: blur(2px);
      border: 0;
      padding: 0;
      cursor: pointer;
    }
    #${ROOT_ID} .waai-settings-panel {
      position: absolute;
      top: 0;
      right: 0;
      height: 100%;
      width: min(420px, 100vw);
      background: #f0f2f5;
      box-shadow: -12px 0 40px rgba(11, 20, 26, 0.18);
      display: flex;
      flex-direction: column;
      transform: translateX(12px);
      opacity: 0;
      transition: transform .18s ease, opacity .18s ease;
    }
    #${ROOT_ID}.is-open .waai-settings-panel {
      transform: translateX(0);
      opacity: 1;
    }
    #${ROOT_ID} .waai-settings-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 18px 18px 12px;
      background: #fff;
      border-bottom: 1px solid rgba(11, 20, 26, 0.08);
    }
    #${ROOT_ID} .waai-settings-title {
      margin: 0;
      font-size: 16px;
      font-weight: 650;
      letter-spacing: 0.01em;
    }
    #${ROOT_ID} .waai-settings-sub {
      margin: 4px 0 0;
      font-size: 12px;
      color: #667781;
      font-weight: 500;
    }
    #${ROOT_ID} .waai-settings-close {
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: #54656f;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
    }
    #${ROOT_ID} .waai-settings-close:hover {
      background: rgba(11, 20, 26, 0.06);
      color: #111b21;
    }
    #${ROOT_ID} .waai-settings-body {
      flex: 1 1 auto;
      overflow: auto;
      padding: 14px 16px 24px;
    }
    #${ROOT_ID} .waai-settings-card {
      background: #fff;
      border-radius: 14px;
      padding: 14px 14px 6px;
      box-shadow: 0 1px 2px rgba(11, 20, 26, 0.04);
    }
    #${ROOT_ID} .waai-field {
      margin-bottom: 14px;
    }
    #${ROOT_ID} .waai-field label {
      display: block;
      margin-bottom: 6px;
      font-size: 12px;
      font-weight: 650;
      color: #3b4a54;
      letter-spacing: 0.02em;
    }
    #${ROOT_ID} .waai-field input,
    #${ROOT_ID} .waai-field select,
    #${ROOT_ID} .waai-field textarea {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid rgba(11, 20, 26, 0.12);
      border-radius: 10px;
      padding: 10px 11px;
      font-size: 13px;
      background: #fff;
      color: #111b21;
      outline: none;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    #${ROOT_ID} .waai-field input:focus,
    #${ROOT_ID} .waai-field select:focus,
    #${ROOT_ID} .waai-field textarea:focus {
      border-color: rgba(18, 140, 126, 0.55);
      box-shadow: 0 0 0 3px rgba(18, 140, 126, 0.12);
    }
    #${ROOT_ID} .waai-field textarea {
      min-height: 84px;
      resize: vertical;
      line-height: 1.45;
    }
    #${ROOT_ID} .waai-hint {
      margin-top: 6px;
      font-size: 11px;
      line-height: 1.45;
      color: #8696a0;
    }
    #${ROOT_ID} .waai-check {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 550;
      color: #3b4a54;
    }
    #${ROOT_ID} .waai-check input {
      width: auto;
      margin: 0;
    }
    #${ROOT_ID} .waai-settings-footer {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px 16px;
      background: #fff;
      border-top: 1px solid rgba(11, 20, 26, 0.08);
    }
    #${ROOT_ID} .waai-save {
      border: 0;
      border-radius: 999px;
      background: #111b21;
      color: #fff;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 650;
      cursor: pointer;
    }
    #${ROOT_ID} .waai-save:hover {
      background: #1f2c33;
    }
    #${ROOT_ID} .waai-status {
      font-size: 12px;
      color: #128c7e;
      min-height: 1em;
    }
    #${ROOT_ID} .waai-status.is-error {
      color: #b91c1c;
    }
  `;
  document.documentElement.appendChild(style);
}

function setStatus(root, text, isError = false) {
  const el = root.querySelector('[data-waai-settings="status"]');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('is-error', !!isError);
}

function fillForm(root, config) {
  const form = root.querySelector('form');
  if (!form) return;
  form.provider.value = config.provider || 'mock';
  form.baseUrl.value = config.baseUrl || '';
  form.apiKey.value = config.apiKey || '';
  form.model.value = config.model || '';
  if (form.outputMode) {
    form.outputMode.value = config.outputMode === 'structured' ? 'structured' : 'text';
  }
  form.prompt.value = config.prompt || '';
  form.polishPrompt.value = config.polishPrompt || '';
  form.debug.checked = config.debug === true;
}

function readForm(root) {
  const form = root.querySelector('form');
  return {
    provider: form.provider.value,
    baseUrl: form.baseUrl.value.trim(),
    apiKey: form.apiKey.value.trim(),
    model: form.model.value.trim(),
    outputMode: form.outputMode ? form.outputMode.value : 'text',
    prompt: form.prompt.value.trim(),
    polishPrompt: form.polishPrompt.value.trim(),
    debug: form.debug.checked === true,
  };
}

function buildRoot() {
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `
    <button type="button" class="waai-settings-backdrop" data-waai-settings="close" aria-label="关闭设置"></button>
    <aside class="waai-settings-panel" role="dialog" aria-modal="true" aria-label="AI 设置">
      <div class="waai-settings-header">
        <div>
          <h2 class="waai-settings-title">AI 设置</h2>
          <p class="waai-settings-sub">保存后立即生效 · 不离开当前会话</p>
        </div>
        <button type="button" class="waai-settings-close" data-waai-settings="close" aria-label="关闭">×</button>
      </div>
      <div class="waai-settings-body">
        <form class="waai-settings-card" data-waai-settings="form">
          <div class="waai-field">
            <label for="waai-provider">Provider</label>
            <select id="waai-provider" name="provider">
              <option value="mock">mock · 本地演示</option>
              <option value="dify">dify</option>
              <option value="openai">openai</option>
            </select>
            <div class="waai-hint">默认 mock，不向外部发送聊天内容。</div>
          </div>
          <div class="waai-field">
            <label for="waai-baseUrl">API Base URL</label>
            <input id="waai-baseUrl" name="baseUrl" type="url" placeholder="https://api.example.com/v1" autocomplete="off" />
            <div class="waai-hint">填到 /v1 即可；dify / openai 会自动补全路径。</div>
          </div>
          <div class="waai-field">
            <label for="waai-apiKey">API Key</label>
            <input id="waai-apiKey" name="apiKey" type="password" placeholder="app-xxxx / sk-xxxx" autocomplete="off" />
          </div>
          <div class="waai-field">
            <label for="waai-model">Model</label>
            <input id="waai-model" name="model" type="text" placeholder="gpt-4o-mini" autocomplete="off" />
            <div class="waai-hint">仅 openai 需要；留空默认 gpt-4o-mini。</div>
          </div>
          <div class="waai-field">
            <label for="waai-outputMode">输出模式</label>
            <select id="waai-outputMode" name="outputMode">
              <option value="text">text · 纯文本（只写输入框）</option>
              <option value="structured">structured · 结构化（解释面板）</option>
            </select>
            <div class="waai-hint">人设 Prompt 只管口吻；JSON 契约由扩展按模式自动追加。</div>
          </div>
          <div class="waai-field">
            <label for="waai-prompt">回复 Prompt（人设）</label>
            <textarea id="waai-prompt" name="prompt" placeholder="生成回复时的角色与口吻"></textarea>
          </div>
          <div class="waai-field">
            <label for="waai-polishPrompt">润色 Prompt（人设）</label>
            <textarea id="waai-polishPrompt" name="polishPrompt" placeholder="润色草稿时的角色与口吻"></textarea>
          </div>
          <div class="waai-field">
            <label class="waai-check">
              <input id="waai-debug" name="debug" type="checkbox" />
              开启调试日志
            </label>
            <div class="waai-hint">仅排查问题时开启；可能包含消息摘要。</div>
          </div>
        </form>
      </div>
      <div class="waai-settings-footer">
        <button type="button" class="waai-save" data-waai-settings="save">保存</button>
        <span class="waai-status" data-waai-settings="status"></span>
      </div>
    </aside>
  `;
  return root;
}

function bindRoot(root) {
  root.querySelectorAll('[data-waai-settings="close"]').forEach((el) => {
    el.addEventListener('click', () => {
      closeSettingsDrawer();
    });
  });

  root.querySelector('[data-waai-settings="save"]')?.addEventListener('click', async () => {
    setStatus(root, '保存中…');
    try {
      await saveAiConfig(readForm(root));
      setStatus(root, '已保存');
      // 给一点反馈后自动收起，减少打断感
      setTimeout(() => {
        if (root.classList.contains('is-open')) closeSettingsDrawer();
      }, 650);
    } catch (error) {
      setStatus(root, `保存失败：${error?.message || error}`, true);
    }
  });

  // Esc 关闭
  root._onKeydown = (event) => {
    if (event.key === 'Escape' && root.classList.contains('is-open')) {
      closeSettingsDrawer();
    }
  };
}

function ensureRoot() {
  ensureStyle();
  let root = document.getElementById(ROOT_ID);
  if (root) return root;
  root = buildRoot();
  bindRoot(root);
  document.documentElement.appendChild(root);
  return root;
}

export function isSettingsDrawerOpen() {
  return !!document.getElementById(ROOT_ID)?.classList.contains('is-open');
}

export function closeSettingsDrawer() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  root.classList.remove('is-open');
  if (root._onKeydown) {
    document.removeEventListener('keydown', root._onKeydown);
  }
}

/**
 * 打开页内设置抽屉并加载当前配置。
 */
export async function openSettingsDrawer() {
  const root = ensureRoot();
  setStatus(root, '');
  try {
    const config = await loadAiConfig();
    fillForm(root, config);
  } catch (error) {
    fillForm(root, getDefaultAiConfig());
    setStatus(root, `加载失败：${error?.message || error}`, true);
  }
  root.classList.add('is-open');
  if (root._onKeydown) {
    document.addEventListener('keydown', root._onKeydown);
  }
  // 焦点落到 provider，便于键盘操作
  queueMicrotask(() => {
    root.querySelector('#waai-provider')?.focus?.();
  });
}
