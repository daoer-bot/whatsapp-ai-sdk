/**
 * content/ai-button.js — 锚定到输入区旁的行内 AI 入口
 *
 * 设计原则：
 * - 优先锚定麦克风按钮所在横向 flex 行（多语言 aria-label + data-icon）
 * - 失败则退到 `#main footer .copyable-area`
 * - 根据输入框是否已有内容，切换「帮我回复 / 帮我优化」模式
 */

import {
  MIC_BUTTON_SELECTORS,
  COPYABLE_AREA_SELECTOR,
  queryFirst,
} from '../core/selectors.js';

const WRAPPER_ID = 'waai-entry-wrapper';
const BUTTON_ID = 'waai-entry-btn';
const STYLE_ID = 'waai-entry-style';

/** @typedef {'ask' | 'polish'} AiButtonMode */

const MODE_LABELS = {
  ask: {
    title: '帮我回复',
    text: '帮我回复',
    loading: '生成中',
  },
  polish: {
    title: '帮我优化',
    text: '帮我优化',
    loading: '优化中',
  },
};

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;

  const keyframesId = 'waai-dots';
  if (!document.getElementById(keyframesId)) {
    const kf = document.createElement('style');
    kf.id = keyframesId;
    kf.textContent = `@keyframes waai-pulse{0%,100%{opacity:.35}50%{opacity:1}}`;
    document.documentElement.appendChild(kf);
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${WRAPPER_ID} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-right: 8px;
      flex-shrink: 0;
      order: 0;
    }

    #${BUTTON_ID} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      height: 30px;
      min-height: 30px;
      padding: 0 12px;
      border: none;
      border-radius: 9999px;
      cursor: pointer;
      outline: none;
      transition: background .15s ease, box-shadow .15s ease, transform .1s ease, color .15s ease, filter .15s ease;
      box-sizing: border-box;
      flex-shrink: 0;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
      letter-spacing: 0;
      box-shadow: 0 1px 2px rgba(11,20,26,.08);
    }

    /* 帮我回复：绿色主行动，贴近 WhatsApp 发送色 */
    #${BUTTON_ID}[data-mode="ask"] {
      background: linear-gradient(180deg, #25d366 0%, #1da851 100%);
      color: #fff;
    }

    #${BUTTON_ID}[data-mode="ask"]:hover {
      background: linear-gradient(180deg, #2fe074 0%, #22b85a 100%);
      box-shadow: 0 2px 8px rgba(37,211,102,.35);
      filter: brightness(1.02);
    }

    /* 帮我优化：蓝色次行动，区分润色场景 */
    #${BUTTON_ID}[data-mode="polish"] {
      background: linear-gradient(180deg, #2f9bff 0%, #0b7dff 100%);
      color: #fff;
    }

    #${BUTTON_ID}[data-mode="polish"]:hover {
      background: linear-gradient(180deg, #4dabff 0%, #1a89ff 100%);
      box-shadow: 0 2px 8px rgba(11,125,255,.35);
      filter: brightness(1.02);
    }

    #${BUTTON_ID}:active {
      transform: scale(.97);
      filter: brightness(.98);
    }

    #${BUTTON_ID} span {
      display: block;
      transform: translateY(-.5px);
    }

    #${BUTTON_ID}.xm-loading {
      cursor: wait;
      pointer-events: none;
      box-shadow: none;
      filter: none;
    }

    #${BUTTON_ID}[data-mode="ask"].xm-loading {
      background: rgba(37,211,102,.16);
      color: #128c7e;
    }

    #${BUTTON_ID}[data-mode="polish"].xm-loading {
      background: rgba(11,125,255,.14);
      color: #0b7dff;
    }

    /* spinner 需要覆盖掉上面 span 的 display:block + transform */
    #${BUTTON_ID} .xm-spinner {
      display: none;
      width: 13px;
      height: 13px;
      border: 2px solid rgba(255,255,255,.35);
      border-top-color: currentColor;
      border-radius: 50%;
      animation: waai-spin .6s linear infinite;
      flex-shrink: 0;
      transform: none !important;
    }

    #${BUTTON_ID}.xm-loading .xm-spinner {
      display: inline-block !important;
      border-color: rgba(18,140,126,.25);
      border-top-color: currentColor;
    }

    #${BUTTON_ID}[data-mode="polish"].xm-loading .xm-spinner {
      border-color: rgba(11,125,255,.25);
      border-top-color: currentColor;
    }

    #${BUTTON_ID}.xm-loading .xm-btn-text {
      display: none !important;
    }

    #${BUTTON_ID}.xm-loading .xm-loading-text {
      display: block !important;
    }

    #${BUTTON_ID} .xm-loading-text {
      display: none;
    }

    @keyframes waai-spin {
      to { transform: rotate(360deg); }
    }
    `;
  document.documentElement.appendChild(style);
}

function createButtonElement(mode = 'ask') {
  const labels = MODE_LABELS[mode] || MODE_LABELS.ask;
  const wrapper = document.createElement('div');
  wrapper.id = WRAPPER_ID;

  const btn = document.createElement('button');
  btn.id = BUTTON_ID;
  btn.type = 'button';
  btn.dataset.mode = mode;
  btn.setAttribute('data-mode', mode);
  btn.title = labels.title;
  btn.innerHTML = `
    <span class="xm-spinner"></span>
    <span class="xm-btn-text">${labels.text}</span>
    <span class="xm-loading-text">${labels.loading}</span>
  `;

  wrapper.appendChild(btn);
  return { wrapper, btn };
}

function applyModeToButton(btn, mode) {
  const labels = MODE_LABELS[mode] || MODE_LABELS.ask;
  btn.dataset.mode = mode;
  btn.setAttribute('data-mode', mode);
  btn.title = labels.title;

  const textEl = btn.querySelector('.xm-btn-text');
  const loadingEl = btn.querySelector('.xm-loading-text');
  if (textEl) textEl.textContent = labels.text;
  if (loadingEl) loadingEl.textContent = labels.loading;
}

function findMicElement() {
  const hit = queryFirst(MIC_BUTTON_SELECTORS);
  if (!hit) return null;
  // span[data-icon] → 找外层 button
  if (hit.tagName === 'BUTTON' || hit.getAttribute('role') === 'button') return hit;
  return hit.closest('button, [role="button"]') || hit;
}

function findMicAnchorRow() {
  const mic = findMicElement();
  let row = null;

  if (mic) {
    let node = mic.parentElement;
    let steps = 0;
    // 动态向上找最近的横向 flex 行容器
    while (node && steps < 8) {
      const cs = getComputedStyle(node);
      if (cs.display.includes('flex') && (cs.flexDirection === 'row' || cs.flexDirection === 'row-reverse')) {
        row = node;
        break;
      }
      node = node.parentElement;
      steps += 1;
    }
  }

  // fallback：退回到 copyable-area，至少保证按钮可见
  if (!row) {
    row = document.querySelector(COPYABLE_AREA_SELECTOR);
  }
  if (!row) return null;

  return { row, mic };
}

export function createAiButton({ onTrigger }) {
  let loading = false;
  /** @type {AiButtonMode} */
  let mode = 'ask';

  function setLoading(state) {
    loading = state;
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    if (state) btn.classList.add('xm-loading');
    else btn.classList.remove('xm-loading');
  }

  /**
   * 切换按钮文案/模式。
   * @param {AiButtonMode} nextMode
   */
  function setMode(nextMode) {
    const resolved = nextMode === 'polish' ? 'polish' : 'ask';
    if (mode === resolved) {
      // 即使 mode 相同，也确保 DOM 文案正确（重建后可能丢失）
      const btn = document.getElementById(BUTTON_ID);
      if (btn && btn.dataset.mode !== resolved) {
        applyModeToButton(btn, resolved);
      }
      return;
    }
    mode = resolved;
    const btn = document.getElementById(BUTTON_ID);
    if (btn) applyModeToButton(btn, mode);
  }

  function getMode() {
    return mode;
  }

  function inject() {
    if (document.getElementById(WRAPPER_ID)) return true;

    const anchor = findMicAnchorRow();
    if (!anchor) return false;

    const { row, mic } = anchor;

    ensureStyle();
    const { wrapper, btn } = createButtonElement(mode);

    btn.addEventListener('click', () => {
      if (loading) return;
      onTrigger(mode);
    });

    // 优先放到麦克风左侧；如果行容器不直接包含麦克风 slot，则退到末尾
    const micSlot = mic?.parentElement;
    if (mic && micSlot && row.contains(micSlot)) {
      row.insertBefore(wrapper, micSlot);
    } else {
      row.appendChild(wrapper);
    }

    console.log('[AI button] injected into:', row, 'mode=', mode);
    return true;
  }

  function uninject() {
    const wrapper = document.getElementById(WRAPPER_ID);
    if (wrapper) wrapper.remove();
  }

  function isInjected() {
    return !!document.getElementById(WRAPPER_ID);
  }

  return {
    inject,
    uninject,
    isInjected,
    setLoading,
    setMode,
    getMode,
  };
}
