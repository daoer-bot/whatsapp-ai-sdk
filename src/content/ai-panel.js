/**
 * content/ai-panel.js — 输入框上方 AI 说明（单一面板，就地展开）
 *
 * 稳定原则：
 * - reanchor 位置正确时完全 no-op，绝不重绘
 * - 计算插入点时跳过面板自身，避免 “before=自己” 导致永远 needsMove
 * - 按钮只绑一次 click（不再 pointerup+click 双触发导致点一次等于 toggle 两次）
 * - 文本可选中
 */

const PANEL_ID = 'waai-explain-panel';
const STYLE_ID = 'waai-explain-style';

/** @type {{ summary: string, explanation: string, translation: string } | null} */
let lastMeta = null;

/** @type {boolean} */
let expanded = false;

/** 最近一次写入 DOM 的内容指纹 */
let lastRenderKey = '';

/** 说明条所属会话，切换会话后必须失效 */
let boundChatId = '';

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${PANEL_ID} {
      position: relative;
      z-index: 30;
      box-sizing: border-box;
      flex: 0 0 auto;
      order: -1;
      width: auto;
      margin: 0 10px 6px;
      padding: 0;
      background: transparent;
      border: none;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
      line-height: 1.4;
      color: #111b21;
      user-select: text;
      -webkit-user-select: text;
    }

    #${PANEL_ID} .waai-card {
      box-sizing: border-box;
      background: #fff;
      border: 1px solid rgba(0,0,0,.08);
      border-radius: 14px;
      box-shadow: 0 1px 2px rgba(11,20,26,.04);
      overflow: hidden;
    }

    #${PANEL_ID} .waai-head {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 34px;
      padding: 6px 8px 6px 12px;
    }

    #${PANEL_ID} .waai-main {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      align-items: baseline;
      gap: 6px;
      overflow: hidden;
      cursor: text;
    }

    #${PANEL_ID} .waai-k {
      flex: 0 0 auto;
      color: #0085ff;
      font-weight: 700;
      font-size: 12px;
      user-select: none;
      -webkit-user-select: none;
    }

    #${PANEL_ID} .waai-v {
      flex: 1 1 auto;
      min-width: 0;
      color: #111b21;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      user-select: text;
      -webkit-user-select: text;
    }

    #${PANEL_ID}.is-expanded .waai-v {
      white-space: normal;
      overflow: visible;
      text-overflow: unset;
      word-break: break-word;
    }

    #${PANEL_ID} .waai-actions {
      display: inline-flex;
      align-items: center;
      flex: 0 0 auto;
      user-select: none;
      -webkit-user-select: none;
    }

    #${PANEL_ID} .waai-btn {
      appearance: none;
      border: none;
      background: transparent;
      height: 28px;
      min-width: 28px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #54656f;
      padding: 0 6px;
      line-height: 1;
      font-size: 12px;
      font-weight: 600;
    }

    #${PANEL_ID} .waai-btn:hover {
      background: rgba(0,0,0,.06);
      color: #111b21;
    }

    #${PANEL_ID} .waai-btn-toggle {
      color: #0085ff;
      font-size: 11px;
    }

    #${PANEL_ID} .waai-btn-toggle:hover {
      background: rgba(0,133,255,.1);
      color: #0085ff;
    }

    #${PANEL_ID} .waai-btn-close {
      width: 28px;
      padding: 0;
      border-radius: 50%;
      font-size: 16px;
      font-weight: 400;
      color: #8696a0;
    }

    #${PANEL_ID} .waai-body {
      display: none;
      padding: 0 12px 10px;
      border-top: 1px solid rgba(0,0,0,.06);
      user-select: text;
      -webkit-user-select: text;
    }

    #${PANEL_ID}.is-expanded .waai-body {
      display: block;
    }

    #${PANEL_ID} .waai-item {
      padding-top: 8px;
    }

    #${PANEL_ID} .waai-item-k {
      display: block;
      color: #667781;
      font-size: 11px;
      font-weight: 700;
      margin-bottom: 2px;
      user-select: none;
      -webkit-user-select: none;
    }

    #${PANEL_ID} .waai-item-v {
      color: #111b21;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-word;
      user-select: text;
      -webkit-user-select: text;
    }
  `;
  document.documentElement.appendChild(style);
}

/**
 * 计算应插入的位置：footer 内、输入区之前。
 * 关键：before 不能是面板自己，否则永远判定 needsMove。
 */
function findInsertPoint() {
  const footer = document.querySelector('#main footer');
  if (!footer) return null;

  let before = footer.firstElementChild;
  // 跳过已挂载的面板，拿到真正的输入区节点
  while (before && before.id === PANEL_ID) {
    before = before.nextElementSibling;
  }

  return { parent: footer, before };
}

/**
 * 面板是否已在正确位置（footer 内、输入区之前）。
 */
function isPanelWellPlaced(panel) {
  if (!panel || !panel.isConnected) return false;
  const point = findInsertPoint();
  if (!point) return false;
  if (panel.parentElement !== point.parent) return false;

  // 正确：panel 是 footer 子节点，且紧挨在 before（输入区）前面
  // 若 before 为 null，则 panel 应是最后一个子节点
  if (point.before) {
    return panel.nextElementSibling === point.before;
  }
  return panel.parentElement.lastElementChild === panel;
}

/**
 * 只负责挂到正确位置；已在正确位置则不动 DOM。
 * @returns {{ panel: HTMLElement, moved: boolean } | null}
 */
function ensurePanelMounted() {
  ensureStyle();
  const point = findInsertPoint();
  if (!point) return null;

  let panel = document.getElementById(PANEL_ID);
  let created = false;
  if (!panel) {
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    created = true;
  }

  const needsMove = created || !isPanelWellPlaced(panel);

  if (needsMove) {
    // 再次取 before，避免 insert 时 before 仍是旧引用
    const fresh = findInsertPoint();
    if (!fresh) return null;
    if (fresh.before) fresh.parent.insertBefore(panel, fresh.before);
    else fresh.parent.appendChild(panel);
  }

  if (panel.style.order !== '-1') {
    panel.style.order = '-1';
  }

  return { panel, moved: needsMove };
}

function getMeta() {
  return lastMeta || { summary: '', explanation: '', translation: '' };
}

function hasExtra(meta) {
  return !!(meta.summary || meta.explanation);
}

function primaryText(meta) {
  if (meta.translation) return { label: '翻译', value: meta.translation };
  if (meta.summary) return { label: '背景总结', value: meta.summary };
  if (meta.explanation) return { label: '话术解释', value: meta.explanation };
  return { label: '', value: '' };
}

function metaKey(meta, isExpanded) {
  return [
    isExpanded ? '1' : '0',
    meta.summary || '',
    meta.explanation || '',
    meta.translation || '',
  ].join('\u0001');
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stopFocusSteal(e) {
  e.preventDefault();
  e.stopPropagation();
}

function onToggleClick(e) {
  stopFocusSteal(e);
  expanded = !expanded;
  const panel = document.getElementById(PANEL_ID);
  if (panel) paintPanel(panel, true);
}

function onCloseClick(e) {
  stopFocusSteal(e);
  hideAiExplainPanel();
}

function ensureShell(panel) {
  if (panel.querySelector('.waai-card')) return;

  panel.innerHTML =
    '<div class="waai-card">' +
      '<div class="waai-head">' +
        '<div class="waai-main">' +
          '<span class="waai-k" data-waai="label"></span>' +
          '<span class="waai-v" data-waai="value"></span>' +
        '</div>' +
        '<div class="waai-actions">' +
          '<button type="button" class="waai-btn waai-btn-toggle" data-waai="toggle" title="展开说明" aria-label="展开说明" hidden>详情</button>' +
          '<button type="button" class="waai-btn waai-btn-close" data-waai="close" title="关闭" aria-label="关闭">×</button>' +
        '</div>' +
      '</div>' +
      '<div class="waai-body" data-waai="body"></div>' +
    '</div>';

  const toggleBtn = panel.querySelector('[data-waai="toggle"]');
  const closeBtn = panel.querySelector('[data-waai="close"]');

  // 只绑 click。pointerdown 仅阻止输入框抢焦点，不在 pointerup 再 toggle（否则会双触发）。
  if (toggleBtn) {
    toggleBtn.addEventListener('pointerdown', stopFocusSteal);
    toggleBtn.addEventListener('mousedown', stopFocusSteal);
    toggleBtn.addEventListener('click', onToggleClick);
  }

  if (closeBtn) {
    closeBtn.addEventListener('pointerdown', stopFocusSteal);
    closeBtn.addEventListener('mousedown', stopFocusSteal);
    closeBtn.addEventListener('click', onCloseClick);
  }
}

function buildBodyHtml(meta) {
  const parts = [];
  if (meta.summary) {
    parts.push(
      '<div class="waai-item">' +
        '<span class="waai-item-k">背景总结</span>' +
        '<div class="waai-item-v">' + escapeHtml(meta.summary) + '</div>' +
      '</div>'
    );
  }
  if (meta.explanation) {
    parts.push(
      '<div class="waai-item">' +
        '<span class="waai-item-k">话术解释</span>' +
        '<div class="waai-item-v">' + escapeHtml(meta.explanation) + '</div>' +
      '</div>'
    );
  }
  return parts.join('');
}

function paintPanel(panel, force) {
  ensureShell(panel);

  const meta = getMeta();
  const canExpand = hasExtra(meta);
  if (!canExpand) expanded = false;

  const key = metaKey(meta, expanded);
  if (!force && key === lastRenderKey) {
    panel.classList.toggle('is-expanded', expanded);
    return;
  }
  lastRenderKey = key;

  const primary = primaryText(meta);
  const labelEl = panel.querySelector('[data-waai="label"]');
  const valueEl = panel.querySelector('[data-waai="value"]');
  const toggleBtn = panel.querySelector('[data-waai="toggle"]');
  const body = panel.querySelector('[data-waai="body"]');

  panel.classList.toggle('is-expanded', expanded);

  if (labelEl && labelEl.textContent !== (primary.label || '')) {
    labelEl.textContent = primary.label || '';
  }

  if (valueEl) {
    const next = primary.value || '';
    if (valueEl.textContent !== next) valueEl.textContent = next;
    if (valueEl.getAttribute('title') !== next) valueEl.title = next;
  }

  if (toggleBtn) {
    const wantHidden = !canExpand;
    if (toggleBtn.hidden !== wantHidden) toggleBtn.hidden = wantHidden;
    const label = expanded ? '收起' : '详情';
    if (toggleBtn.textContent !== label) toggleBtn.textContent = label;
    toggleBtn.title = expanded ? '收起' : '展开说明';
    toggleBtn.setAttribute('aria-label', expanded ? '收起' : '展开说明');
  }

  if (body) {
    if (expanded && canExpand) {
      const html = buildBodyHtml(meta);
      if (body.innerHTML !== html) body.innerHTML = html;
    } else if (body.innerHTML) {
      body.innerHTML = '';
    }
  }
}

/**
 * @param {object} meta
 * @param {string} [meta.summary]
 * @param {string} [meta.explanation]
 * @param {string} [meta.translation]
 */
export function showAiExplainPanel(meta = {}) {
  lastMeta = {
    summary: (meta.summary || '').trim(),
    explanation: (meta.explanation || '').trim(),
    translation: (meta.translation || '').trim(),
  };
  boundChatId = String(meta.chatId || '').trim();
  expanded = false;
  lastRenderKey = '';

  if (!lastMeta.summary && !lastMeta.explanation && !lastMeta.translation) {
    hideAiExplainPanel();
    return null;
  }

  const mounted = ensurePanelMounted();
  if (!mounted) return null;
  mounted.panel.dataset.chatId = boundChatId;
  paintPanel(mounted.panel, true);
  return mounted.panel;
}

export function hideAiExplainPanel() {
  const panel = document.getElementById(PANEL_ID);
  if (panel) panel.remove();
  lastMeta = null;
  expanded = false;
  lastRenderKey = '';
  boundChatId = '';
}

export function isAiExplainPanelVisible() {
  return !!document.getElementById(PANEL_ID);
}

/**
 * footer 重建时调用：
 * - 位置正确 → 完全 no-op
 * - 丢了/错位 → remount，仅在必要时补绘
 */
/**
 * footer 重建时调用。
 * @param {string} [activeChatId] 当前会话；若与 boundChatId 不一致则直接关闭
 */
export function reanchorAiExplainPanel(activeChatId) {
  if (!lastMeta) return;

  const active = String(activeChatId || '').trim();
  if (boundChatId && active && boundChatId !== active) {
    hideAiExplainPanel();
    return;
  }

  // 没有有效绑定会话时，不擅自复活
  if (!boundChatId) {
    hideAiExplainPanel();
    return;
  }

  const existing = document.getElementById(PANEL_ID);
  if (existing && isPanelWellPlaced(existing) && existing.querySelector('.waai-card')) {
    return;
  }

  const mounted = ensurePanelMounted();
  if (!mounted) return;
  mounted.panel.dataset.chatId = boundChatId;

  if (mounted.moved || !mounted.panel.querySelector('.waai-card')) {
    paintPanel(mounted.panel, true);
  }
}

/** 当前说明条绑定的会话 id */
export function getAiExplainPanelChatId() {
  return boundChatId || '';
}
