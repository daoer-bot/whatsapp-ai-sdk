/**
 * content/ai-button.js — 锚定到输入区旁的 AI 入口
 *
 * 设计原则：
 * - 优先锚定麦克风按钮所在横向 flex 行
 * - 失败则退到 `#main footer .copyable-area`
 * - 可发现但不吵：紧凑色点 +「AI」微标，不是大绿文案胶囊，也不藏成灰图标
 * - 左键触发 ask/polish；右键（或长按）打开页内设置抽屉
 * - 回复 / 润色用色相区分，体量保持一致
 */

import {
  MIC_BUTTON_SELECTORS,
  COPYABLE_AREA_SELECTOR,
  queryFirst,
} from '../core/selectors.js';

const WRAPPER_ID = 'waai-entry-wrapper';
const BUTTON_ID = 'waai-entry-btn';
/** 升版清掉：大绿胶囊 / 纯 ghost 灰图标 / 白底描边 */
const STYLE_ID = 'waai-entry-style-v5';
const LEGACY_STYLE_IDS = [
  'waai-entry-style',
  'waai-entry-style-v3',
  'waai-entry-style-v4',
  'waai-dots',
];

/** @typedef {'ask' | 'polish'} AiButtonMode */

const MODE_LABELS = {
  ask: {
    title: 'AI 回复 · 右键打开设置',
    aria: 'AI 回复',
    text: 'AI',
  },
  polish: {
    title: 'AI 润色 · 右键打开设置',
    aria: 'AI 润色',
    text: '润色',
  },
};

/** 实心 sparkle：白底色块上更干净 */
const AI_ICON_SVG =
  '<svg class="waai-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
  + '<path d="M12 2.8 13.35 9.05 19.2 11.25 13.35 13.45 12 19.7 10.65 13.45 4.8 11.25 10.65 9.05 12 2.8Z" '
  + 'fill="currentColor"/>'
  + '<path d="M18.6 4.6 19.05 6.05 20.5 6.5 19.05 6.95 18.6 8.4 18.15 6.95 16.7 6.5 18.15 6.05 18.6 4.6Z" '
  + 'fill="currentColor"/>'
  + '</svg>';

function purgeLegacyStyles() {
  for (const id of LEGACY_STYLE_IDS) {
    document.getElementById(id)?.remove();
  }
}

function ensureStyle() {
  purgeLegacyStyles();
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${WRAPPER_ID} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin: 0 4px 0 2px;
      flex-shrink: 0;
      order: 0;
    }

    #${BUTTON_ID} {
      /* 可发现色点：WA 品牌绿，但体量是小 pill，不是「帮我回复」广告条 */
      --waai-bg: #00a884;
      --waai-bg-hover: #019a78;
      --waai-bg-active: #028a6c;
      --waai-fg: #ffffff;
      --waai-ring: rgba(0, 168, 132, 0.35);
      --waai-shadow: 0 1px 2px rgba(11, 20, 26, 0.12);
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      height: 28px;
      min-height: 28px;
      min-width: 28px;
      padding: 0 9px 0 8px;
      margin: 0;
      border: 0;
      border-radius: 9999px;
      cursor: pointer;
      outline: none;
      background: var(--waai-bg);
      color: var(--waai-fg);
      box-shadow: var(--waai-shadow);
      box-sizing: border-box;
      flex-shrink: 0;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.02em;
      line-height: 1;
      white-space: nowrap;
      transition:
        background .14s ease,
        box-shadow .14s ease,
        transform .1s ease,
        filter .14s ease;
      -webkit-tap-highlight-color: transparent;
    }

    #${BUTTON_ID}:hover {
      background: var(--waai-bg-hover);
      box-shadow: 0 2px 6px rgba(0, 168, 132, 0.28);
    }

    #${BUTTON_ID}:active {
      transform: scale(.97);
      background: var(--waai-bg-active);
      box-shadow: 0 1px 2px rgba(11, 20, 26, 0.1);
    }

    #${BUTTON_ID}:focus-visible {
      box-shadow: 0 0 0 3px var(--waai-ring);
    }

    /* 润色：同体量，换蓝相 */
    #${BUTTON_ID}[data-mode="polish"] {
      --waai-bg: #5271ff;
      --waai-bg-hover: #3f5ff0;
      --waai-bg-active: #3552d6;
      --waai-ring: rgba(82, 113, 255, 0.35);
    }

    #${BUTTON_ID}[data-mode="polish"]:hover {
      box-shadow: 0 2px 6px rgba(82, 113, 255, 0.28);
    }

    #${BUTTON_ID} .waai-icon {
      display: block;
      pointer-events: none;
      flex-shrink: 0;
    }

    #${BUTTON_ID} .waai-label {
      display: block;
      pointer-events: none;
      transform: translateY(0.3px);
      user-select: none;
      -webkit-user-select: none;
    }

    #${BUTTON_ID} .waai-spinner {
      display: none;
      width: 12px;
      height: 12px;
      border: 1.5px solid rgba(255, 255, 255, 0.35);
      border-top-color: #fff;
      border-radius: 50%;
      animation: waai-spin .65s linear infinite;
      box-sizing: border-box;
      flex-shrink: 0;
    }

    #${BUTTON_ID}.is-loading {
      cursor: wait;
      pointer-events: none;
      filter: none;
      box-shadow: none;
      opacity: .88;
    }

    #${BUTTON_ID}.is-loading .waai-icon,
    #${BUTTON_ID}.is-loading .waai-label {
      display: none;
    }

    #${BUTTON_ID}.is-loading .waai-spinner {
      display: block;
    }

    /* 首次注入轻提示：两下呼吸，然后安静 */
    #${BUTTON_ID}.waai-nudge {
      animation: waai-nudge 1.4s ease-in-out 2;
    }

    @keyframes waai-spin {
      to { transform: rotate(360deg); }
    }

    @keyframes waai-nudge {
      0%, 100% {
        box-shadow: 0 1px 2px rgba(11, 20, 26, 0.12);
        transform: scale(1);
      }
      50% {
        box-shadow: 0 0 0 5px rgba(0, 168, 132, 0.22);
        transform: scale(1.04);
      }
    }

    #${BUTTON_ID}[data-mode="polish"].waai-nudge {
      animation-name: waai-nudge-polish;
    }

    @keyframes waai-nudge-polish {
      0%, 100% {
        box-shadow: 0 1px 2px rgba(11, 20, 26, 0.12);
        transform: scale(1);
      }
      50% {
        box-shadow: 0 0 0 5px rgba(82, 113, 255, 0.22);
        transform: scale(1.04);
      }
    }

    /* 暗色：略提亮，避免在深灰 footer 里发闷 */
    @media (prefers-color-scheme: dark) {
      #${BUTTON_ID} {
        --waai-bg: #00c49a;
        --waai-bg-hover: #00d6a8;
        --waai-bg-active: #00b38c;
        --waai-ring: rgba(0, 196, 154, 0.4);
        --waai-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
      }
      #${BUTTON_ID}[data-mode="polish"] {
        --waai-bg: #6b8cff;
        --waai-bg-hover: #7d9bff;
        --waai-bg-active: #5a7cf0;
        --waai-ring: rgba(107, 140, 255, 0.4);
      }
    }

    html[data-theme="dark"] #${BUTTON_ID},
    body[data-theme="dark"] #${BUTTON_ID},
    .dark #${BUTTON_ID},
    [data-color-scheme="dark"] #${BUTTON_ID} {
      --waai-bg: #00c49a;
      --waai-bg-hover: #00d6a8;
      --waai-bg-active: #00b38c;
      --waai-ring: rgba(0, 196, 154, 0.4);
      --waai-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
    }

    html[data-theme="dark"] #${BUTTON_ID}[data-mode="polish"],
    body[data-theme="dark"] #${BUTTON_ID}[data-mode="polish"],
    .dark #${BUTTON_ID}[data-mode="polish"],
    [data-color-scheme="dark"] #${BUTTON_ID}[data-mode="polish"] {
      --waai-bg: #6b8cff;
      --waai-bg-hover: #7d9bff;
      --waai-bg-active: #5a7cf0;
      --waai-ring: rgba(107, 140, 255, 0.4);
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
  btn.setAttribute('aria-label', labels.aria);
  btn.innerHTML =
    `${AI_ICON_SVG}`
    + `<span class="waai-label">${labels.text}</span>`
    + `<span class="waai-spinner" aria-hidden="true"></span>`;

  wrapper.appendChild(btn);
  return { wrapper, btn };
}

function applyModeToButton(btn, mode) {
  const labels = MODE_LABELS[mode] || MODE_LABELS.ask;
  btn.dataset.mode = mode;
  btn.setAttribute('data-mode', mode);
  btn.title = labels.title;
  btn.setAttribute('aria-label', labels.aria);
  const labelEl = btn.querySelector('.waai-label');
  if (labelEl) labelEl.textContent = labels.text;
}

function findMicElement() {
  const hit = queryFirst(MIC_BUTTON_SELECTORS);
  if (!hit) return null;
  if (hit.tagName === 'BUTTON' || hit.getAttribute('role') === 'button') return hit;
  return hit.closest('button, [role="button"]') || hit;
}

function findMicAnchorRow() {
  const mic = findMicElement();
  let row = null;

  if (mic) {
    let node = mic.parentElement;
    let steps = 0;
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

  if (!row) {
    row = document.querySelector(COPYABLE_AREA_SELECTOR);
  }
  if (!row) return null;

  return { row, mic };
}

function maybeNudge(btn) {
  try {
    if (sessionStorage.getItem('waai-entry-nudged') === '1') return;
    sessionStorage.setItem('waai-entry-nudged', '1');
  } catch {
    // private mode 等：仍 nudge 一次，不持久
  }
  btn.classList.add('waai-nudge');
  const clear = () => btn.classList.remove('waai-nudge');
  btn.addEventListener('animationend', clear, { once: true });
  // 兜底：动画异常时不让 class 常驻
  window.setTimeout(clear, 3200);
}

/**
 * @param {object} args
 * @param {(mode: AiButtonMode) => void} args.onTrigger
 * @param {() => void} [args.onOpenSettings]
 */
export function createAiButton({ onTrigger, onOpenSettings }) {
  let loading = false;
  /** @type {AiButtonMode} */
  let mode = 'ask';
  /** @type {number | null} */
  let longPressTimer = null;
  let longPressOpened = false;

  function clearLongPress() {
    if (longPressTimer != null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function setLoading(state) {
    loading = state;
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    btn.classList.toggle('is-loading', !!state);
    btn.setAttribute('aria-busy', state ? 'true' : 'false');
  }

  /**
   * @param {AiButtonMode} nextMode
   */
  function setMode(nextMode) {
    const resolved = nextMode === 'polish' ? 'polish' : 'ask';
    if (mode === resolved) {
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

  function openSettings() {
    if (typeof onOpenSettings === 'function') onOpenSettings();
  }

  function inject() {
    if (document.getElementById(WRAPPER_ID)) return true;

    const anchor = findMicAnchorRow();
    if (!anchor) return false;

    const { row, mic } = anchor;

    ensureStyle();
    const { wrapper, btn } = createButtonElement(mode);

    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (loading) return;
      // 长按已打开设置时，抬起触发的 click 要吞掉
      if (longPressOpened) {
        longPressOpened = false;
        return;
      }
      onTrigger(mode);
    });

    btn.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (loading) return;
      openSettings();
    });

    // 触控：长按约 480ms 打开设置
    btn.addEventListener('pointerdown', (event) => {
      if (event.button != null && event.button !== 0) return;
      longPressOpened = false;
      clearLongPress();
      longPressTimer = window.setTimeout(() => {
        longPressTimer = null;
        longPressOpened = true;
        openSettings();
      }, 480);
    });
    btn.addEventListener('pointerup', clearLongPress);
    btn.addEventListener('pointercancel', clearLongPress);
    btn.addEventListener('pointerleave', clearLongPress);

    const micSlot = mic?.parentElement;
    if (mic && micSlot && row.contains(micSlot)) {
      row.insertBefore(wrapper, micSlot);
    } else {
      row.appendChild(wrapper);
    }

    maybeNudge(btn);
    return true;
  }

  function uninject() {
    clearLongPress();
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
