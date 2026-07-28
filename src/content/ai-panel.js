/**
 * content/ai-panel.js — 输入框上方 AI 说明面板
 *
 * 设计取舍：
 * - 不用塞进 #main footer 的 flex 流（WA 改版后 order:-1 经常挂不上 / 看不见）
 * - 用 fixed 浮层，按 composer / footer 几何定位，暗色主题可读
 * - 默认展开详情（summary / explanation / translation），不再只剩一行细条
 * - 文本可选中；按钮只绑一次 click
 */

const PANEL_ID = 'waai-explain-panel';
const STYLE_ID = 'waai-explain-style';

/** @type {{ summary: string, explanation: string, translation: string } | null} */
let lastMeta = null;

/** 说明条所属会话，切换会话后必须失效 */
let boundChatId = '';

/** @type {boolean} */
let expanded = true;

/** 最近一次写入 DOM 的内容指纹 */
let lastRenderKey = '';

/** @type {number | null} */
let repositionRaf = null;

/** @type {(() => void) | null} */
let viewportCleanup = null;

function ensureStyle() {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.documentElement.appendChild(style);
  }
  // 每次确保样式内容是当前版本（热重载 / 旧 style 残留时也能覆盖）
  style.textContent = `
    #${PANEL_ID} {
      position: fixed;
      z-index: 2147483000;
      box-sizing: border-box;
      max-width: min(520px, calc(100vw - 24px));
      min-width: min(280px, calc(100vw - 24px));
      margin: 0;
      padding: 0;
      border: none;
      background: transparent;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
      line-height: 1.45;
      color: #e9edef;
      user-select: text;
      -webkit-user-select: text;
      pointer-events: none;
    }

    #${PANEL_ID} .waai-card {
      pointer-events: auto;
      box-sizing: border-box;
      background: #1f2c34;
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 14px;
      box-shadow: 0 10px 28px rgba(0,0,0,.35), 0 0 0 1px rgba(168,85,247,.18);
      overflow: hidden;
      backdrop-filter: blur(8px);
    }

    #${PANEL_ID} .waai-head {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      min-height: 36px;
      padding: 10px 8px 10px 12px;
    }

    #${PANEL_ID} .waai-badge {
      flex: 0 0 auto;
      margin-top: 1px;
      padding: 2px 8px;
      border-radius: 999px;
      background: linear-gradient(135deg, #a855f7, #6366f1);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.02em;
      user-select: none;
      -webkit-user-select: none;
    }

    #${PANEL_ID} .waai-main {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow: hidden;
      cursor: text;
    }

    #${PANEL_ID} .waai-k {
      color: #a78bfa;
      font-weight: 700;
      font-size: 11px;
      user-select: none;
      -webkit-user-select: none;
    }

    #${PANEL_ID} .waai-v {
      color: #e9edef;
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
      color: #aebac1;
      padding: 0 8px;
      line-height: 1;
      font-size: 12px;
      font-weight: 600;
    }

    #${PANEL_ID} .waai-btn:hover {
      background: rgba(255,255,255,.08);
      color: #f0f2f5;
    }

    #${PANEL_ID} .waai-btn-toggle {
      color: #c4b5fd;
      font-size: 11px;
    }

    #${PANEL_ID} .waai-btn-toggle:hover {
      background: rgba(168,85,247,.18);
      color: #e9d5ff;
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
      padding: 0 12px 12px;
      border-top: 1px solid rgba(255,255,255,.08);
      user-select: text;
      -webkit-user-select: text;
    }

    #${PANEL_ID}.is-expanded .waai-body {
      display: block;
    }

    #${PANEL_ID} .waai-item {
      padding-top: 10px;
    }

    #${PANEL_ID} .waai-item-k {
      display: block;
      color: #8696a0;
      font-size: 11px;
      font-weight: 700;
      margin-bottom: 3px;
      user-select: none;
      -webkit-user-select: none;
    }

    #${PANEL_ID} .waai-item-v {
      color: #e9edef;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-word;
      user-select: text;
      -webkit-user-select: text;
    }

    @media (prefers-color-scheme: light) {
      #${PANEL_ID} .waai-card {
        background: #ffffff;
        border-color: rgba(0,0,0,.08);
        box-shadow: 0 8px 24px rgba(11,20,26,.12), 0 0 0 1px rgba(168,85,247,.12);
      }
      #${PANEL_ID} .waai-k { color: #7c3aed; }
      #${PANEL_ID} .waai-v,
      #${PANEL_ID} .waai-item-v { color: #111b21; }
      #${PANEL_ID} .waai-item-k { color: #667781; }
      #${PANEL_ID} .waai-btn { color: #54656f; }
      #${PANEL_ID} .waai-btn:hover {
        background: rgba(0,0,0,.06);
        color: #111b21;
      }
      #${PANEL_ID} .waai-body {
        border-top-color: rgba(0,0,0,.06);
      }
    }
  `;
}

function queryComposerRect() {
  const candidates = [
    '#main footer [contenteditable="true"]',
    '#main footer div[role="textbox"]',
    'footer [contenteditable="true"]',
    '#main footer',
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 40 && rect.height > 8) return rect;
  }
  return null;
}

function positionPanel(panel) {
  if (!panel || !panel.isConnected) return;
  const rect = queryComposerRect();
  const gap = 10;
  const maxW = Math.min(520, window.innerWidth - 24);

  if (!rect) {
    // 找不到输入框时：屏幕底部居中兜底，至少可见
    panel.style.left = `${Math.max(12, (window.innerWidth - maxW) / 2)}px`;
    panel.style.width = `${maxW}px`;
    panel.style.bottom = '96px';
    panel.style.top = 'auto';
    panel.style.right = 'auto';
    return;
  }

  const width = Math.min(maxW, Math.max(280, rect.width));
  let left = rect.left + (rect.width - width) / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));

  panel.style.width = `${Math.round(width)}px`;
  panel.style.left = `${Math.round(left)}px`;
  panel.style.right = 'auto';

  // 优先贴在输入框上方；若上方空间不够则贴下方
  const estimatedHeight = panel.offsetHeight || 120;
  const spaceAbove = rect.top - 12;
  if (spaceAbove >= estimatedHeight + gap || spaceAbove >= 80) {
    panel.style.top = 'auto';
    panel.style.bottom = `${Math.round(window.innerHeight - rect.top + gap)}px`;
  } else {
    panel.style.bottom = 'auto';
    panel.style.top = `${Math.round(rect.bottom + gap)}px`;
  }
}

function schedulePosition(panel) {
  if (repositionRaf != null) cancelAnimationFrame(repositionRaf);
  repositionRaf = requestAnimationFrame(() => {
    repositionRaf = null;
    positionPanel(panel || document.getElementById(PANEL_ID));
  });
}

function bindViewportWatchers() {
  if (viewportCleanup) return;
  const onMove = () => schedulePosition();
  window.addEventListener('resize', onMove, { passive: true });
  window.addEventListener('scroll', onMove, true);
  // WA 主栏内部滚动
  const main = document.querySelector('#main');
  if (main) main.addEventListener('scroll', onMove, { passive: true });
  viewportCleanup = () => {
    window.removeEventListener('resize', onMove);
    window.removeEventListener('scroll', onMove, true);
    if (main) main.removeEventListener('scroll', onMove);
    viewportCleanup = null;
  };
}

function unbindViewportWatchers() {
  if (typeof viewportCleanup === 'function') viewportCleanup();
  if (repositionRaf != null) {
    cancelAnimationFrame(repositionRaf);
    repositionRaf = null;
  }
}

function ensurePanelMounted() {
  ensureStyle();
  let panel = document.getElementById(PANEL_ID);
  let created = false;
  if (!panel) {
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'AI 解释面板');
    created = true;
    (document.body || document.documentElement).appendChild(panel);
  } else if (panel.parentElement !== document.body && panel.parentElement !== document.documentElement) {
    (document.body || document.documentElement).appendChild(panel);
    created = true;
  }
  bindViewportWatchers();
  schedulePosition(panel);
  return { panel, moved: created };
}

function getMeta() {
  return lastMeta || { summary: '', explanation: '', translation: '' };
}

function hasExtra(meta) {
  const fields = [meta.summary, meta.explanation, meta.translation].filter((x) => !!(x && String(x).trim()));
  return fields.length > 1 || !!(meta.explanation && meta.explanation.trim()) || !!(meta.translation && meta.translation.trim());
}

function primaryText(meta) {
  if (meta.summary) return { label: '背景总结', value: meta.summary };
  if (meta.explanation) return { label: '话术解释', value: meta.explanation };
  if (meta.translation) return { label: '原文翻译', value: meta.translation };
  return { label: 'AI 说明', value: '' };
}

function metaKey(meta, isExpanded) {
  return [
    isExpanded ? '1' : '0',
    meta.summary || '',
    meta.explanation || '',
    meta.translation || '',
  ].join('');
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
  if (panel) {
    paintPanel(panel, true);
    schedulePosition(panel);
  }
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
        '<span class="waai-badge">AI 解释</span>' +
        '<div class="waai-main">' +
          '<span class="waai-k" data-waai="label"></span>' +
          '<span class="waai-v" data-waai="value"></span>' +
        '</div>' +
        '<div class="waai-actions">' +
          '<button type="button" class="waai-btn waai-btn-toggle" data-waai="toggle" title="展开说明" aria-label="展开说明">详情</button>' +
          '<button type="button" class="waai-btn waai-btn-close" data-waai="close" title="关闭" aria-label="关闭">×</button>' +
        '</div>' +
      '</div>' +
      '<div class="waai-body" data-waai="body"></div>' +
    '</div>';

  const toggleBtn = panel.querySelector('[data-waai="toggle"]');
  const closeBtn = panel.querySelector('[data-waai="close"]');

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
      '</div>',
    );
  }
  if (meta.explanation) {
    parts.push(
      '<div class="waai-item">' +
        '<span class="waai-item-k">话术解释</span>' +
        '<div class="waai-item-v">' + escapeHtml(meta.explanation) + '</div>' +
      '</div>',
    );
  }
  if (meta.translation) {
    parts.push(
      '<div class="waai-item">' +
        '<span class="waai-item-k">原文翻译</span>' +
        '<div class="waai-item-v">' + escapeHtml(meta.translation) + '</div>' +
      '</div>',
    );
  }
  return parts.join('');
}

function paintPanel(panel, force) {
  ensureShell(panel);

  const meta = getMeta();
  const canExpand = hasExtra(meta) || !!(meta.summary && meta.summary.trim());
  if (!canExpand) expanded = false;

  const key = metaKey(meta, expanded);
  if (!force && key === lastRenderKey) {
    panel.classList.toggle('is-expanded', expanded);
    schedulePosition(panel);
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
    // 有任意详情字段就显示展开按钮
    const wantHidden = !(meta.summary || meta.explanation || meta.translation);
    if (toggleBtn.hidden !== wantHidden) toggleBtn.hidden = wantHidden;
    const label = expanded ? '收起' : '详情';
    if (toggleBtn.textContent !== label) toggleBtn.textContent = label;
    toggleBtn.title = expanded ? '收起' : '展开说明';
    toggleBtn.setAttribute('aria-label', expanded ? '收起' : '展开说明');
  }

  if (body) {
    if (expanded && (meta.summary || meta.explanation || meta.translation)) {
      const html = buildBodyHtml(meta);
      if (body.innerHTML !== html) body.innerHTML = html;
    } else if (body.innerHTML) {
      body.innerHTML = '';
    }
  }

  schedulePosition(panel);
}

/**
 * @param {object} meta
 * @param {string} [meta.summary]
 * @param {string} [meta.explanation]
 * @param {string} [meta.translation]
 * @param {string} [meta.chatId]
 * @param {string} [meta.mode]
 */
export function showAiExplainPanel(meta = {}) {
  lastMeta = {
    summary: (meta.summary || '').trim(),
    explanation: (meta.explanation || '').trim(),
    translation: (meta.translation || '').trim(),
  };
  boundChatId = String(meta.chatId || '').trim();
  expanded = true;
  lastRenderKey = '';

  if (!lastMeta.summary && !lastMeta.explanation && !lastMeta.translation) {
    hideAiExplainPanel();
    return null;
  }

  const mounted = ensurePanelMounted();
  if (!mounted) return null;
  mounted.panel.dataset.chatId = boundChatId;
  if (meta.mode) mounted.panel.dataset.mode = String(meta.mode);
  paintPanel(mounted.panel, true);
  // 二次定位：展开后高度变化
  schedulePosition(mounted.panel);
  setTimeout(() => schedulePosition(mounted.panel), 50);
  return mounted.panel;
}

export function hideAiExplainPanel() {
  const panel = document.getElementById(PANEL_ID);
  if (panel) panel.remove();
  lastMeta = null;
  expanded = true;
  lastRenderKey = '';
  boundChatId = '';
  unbindViewportWatchers();
}

export function isAiExplainPanelVisible() {
  return !!document.getElementById(PANEL_ID);
}

/**
 * footer / toolbar 重建时调用：刷新 fixed 位置；会话不一致则关闭。
 * @param {string} [activeChatId]
 */
export function reanchorAiExplainPanel(activeChatId) {
  if (!lastMeta) return;

  const active = String(activeChatId || '').trim();
  if (boundChatId && active && boundChatId !== active) {
    hideAiExplainPanel();
    return;
  }

  if (!boundChatId) {
    hideAiExplainPanel();
    return;
  }

  const mounted = ensurePanelMounted();
  if (!mounted) return;
  mounted.panel.dataset.chatId = boundChatId;

  if (!mounted.panel.querySelector('.waai-card')) {
    paintPanel(mounted.panel, true);
  } else {
    schedulePosition(mounted.panel);
  }
}

/** 当前说明条绑定的会话 id */
export function getAiExplainPanelChatId() {
  return boundChatId || '';
}
