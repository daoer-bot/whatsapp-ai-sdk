/**
 * content/ai-panel.js — 输入框旁 AI 说明浮层
 *
 * 设计取舍：
 * - fixed 浮层，贴在输入框右上（靠近 ✦），不再拉满整条 composer
 * - 展开后标题栏不重复正文，详情只在 body 出现一次
 * - 选中/复制：面板内 selection 存活期间禁止 reanchor / 改 style，避免选区被冲掉
 * - 文本区只 stopPropagation，不 preventDefault（否则选不中）
 */

const PANEL_ID = 'waai-explain-panel';
const STYLE_ID = 'waai-explain-style';

/** @type {{ summary: string, explanation: string, translation: string } | null} */
let lastMeta = null;

/** 说明条所属会话 */
let boundChatId = '';

/** @type {boolean} */
let expanded = true;

/** 最近一次写入 DOM 的内容指纹 */
let lastRenderKey = '';

/** @type {number | null} */
let repositionRaf = null;

/** @type {(() => void) | null} */
let viewportCleanup = null;

/** 用户正在面板内划选 / 按住时，禁止改定位 */
let selectionLock = false;

/** @type {{ left: number, bottom: number, width: number } | null} */
let lastBox = null;

function ensureStyle() {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.documentElement.appendChild(style);
  }
  style.textContent = `
    #${PANEL_ID} {
      position: fixed;
      z-index: 2147483000;
      box-sizing: border-box;
      width: min(340px, calc(100vw - 24px));
      max-width: min(340px, calc(100vw - 24px));
      margin: 0;
      padding: 0;
      border: none;
      background: transparent;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
      line-height: 1.45;
      color: #111b21;
      user-select: text;
      -webkit-user-select: text;
      pointer-events: none;
    }

    #${PANEL_ID} .waai-card {
      pointer-events: auto;
      box-sizing: border-box;
      background: #ffffff;
      border: 1px solid rgba(11, 20, 26, 0.10);
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(11, 20, 26, 0.14);
      overflow: hidden;
      max-height: min(42vh, 320px);
      display: flex;
      flex-direction: column;
    }

    #${PANEL_ID} .waai-head {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
      min-height: 36px;
      padding: 8px 6px 8px 10px;
      border-bottom: 1px solid rgba(11, 20, 26, 0.06);
      background: #fafbfc;
    }

    #${PANEL_ID} .waai-badge {
      flex: 0 0 auto;
      padding: 2px 8px;
      border-radius: 999px;
      background: linear-gradient(135deg, #a855f7, #6366f1);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.02em;
      user-select: none;
      -webkit-user-select: none;
      white-space: nowrap;
    }

    #${PANEL_ID} .waai-title {
      flex: 1 1 auto;
      min-width: 0;
      color: #3b4a54;
      font-size: 12px;
      font-weight: 650;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      user-select: none;
      -webkit-user-select: none;
    }

    #${PANEL_ID} .waai-actions {
      display: inline-flex;
      align-items: center;
      flex: 0 0 auto;
      gap: 2px;
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
      padding: 0 8px;
      line-height: 1;
      font-size: 12px;
      font-weight: 600;
    }

    #${PANEL_ID} .waai-btn:hover {
      background: rgba(11, 20, 26, 0.06);
      color: #111b21;
    }

    #${PANEL_ID} .waai-btn-toggle {
      color: #7c3aed;
      font-size: 11px;
    }

    #${PANEL_ID} .waai-btn-toggle:hover {
      background: rgba(124, 58, 237, 0.1);
      color: #6d28d9;
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
      flex: 1 1 auto;
      overflow: auto;
      padding: 8px 12px 12px;
      overscroll-behavior: contain;
      user-select: text;
      -webkit-user-select: text;
      cursor: text;
    }

    #${PANEL_ID}.is-expanded .waai-body {
      display: block;
    }

    #${PANEL_ID}:not(.is-expanded) .waai-head {
      border-bottom: none;
    }

    #${PANEL_ID} .waai-item {
      padding-top: 8px;
    }

    #${PANEL_ID} .waai-item:first-child {
      padding-top: 4px;
    }

    #${PANEL_ID} .waai-item-k {
      display: block;
      color: #667781;
      font-size: 11px;
      font-weight: 700;
      margin-bottom: 3px;
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
      cursor: text;
    }

    #${PANEL_ID} .waai-preview {
      display: none;
      flex: 1 1 auto;
      min-width: 0;
      color: #3b4a54;
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      user-select: text;
      -webkit-user-select: text;
    }

    #${PANEL_ID}:not(.is-expanded) .waai-preview {
      display: block;
    }

    #${PANEL_ID}:not(.is-expanded) .waai-title {
      display: none;
    }

    @media (prefers-color-scheme: dark) {
      #${PANEL_ID} .waai-card {
        background: #1f2c34;
        border-color: rgba(255,255,255,.12);
        box-shadow: 0 10px 28px rgba(0,0,0,.35);
      }
      #${PANEL_ID} .waai-head {
        background: #193039;
        border-bottom-color: rgba(255,255,255,.08);
      }
      #${PANEL_ID} .waai-title,
      #${PANEL_ID} .waai-preview { color: #d1d7db; }
      #${PANEL_ID} .waai-item-k { color: #8696a0; }
      #${PANEL_ID} .waai-item-v { color: #e9edef; }
      #${PANEL_ID} .waai-btn { color: #aebac1; }
      #${PANEL_ID} .waai-btn:hover {
        background: rgba(255,255,255,.08);
        color: #f0f2f5;
      }
      #${PANEL_ID} .waai-btn-toggle { color: #c4b5fd; }
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

function isSelectionInsidePanel() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return false;
  const sel = document.getSelection?.();
  if (!sel || sel.isCollapsed || sel.rangeCount < 1) return false;
  try {
    const node = sel.getRangeAt(0).commonAncestorContainer;
    const el = node.nodeType === 1 ? node : node.parentElement;
    return !!(el && panel.contains(el));
  } catch {
    return false;
  }
}

function shouldSkipReposition() {
  return selectionLock || isSelectionInsidePanel();
}

/**
 * 紧凑浮层：固定宽度，贴在输入框右上（靠近 AI 按钮），不拉满 composer。
 */
function positionPanel(panel) {
  if (!panel || !panel.isConnected) return;
  if (shouldSkipReposition()) return;

  const rect = queryComposerRect();
  const gap = 8;
  const width = Math.min(340, window.innerWidth - 24);

  let left;
  let bottom;

  if (!rect) {
    left = Math.max(12, window.innerWidth - width - 16);
    bottom = 96;
  } else {
    // 右对齐输入框，略向内收，避免贴边
    left = Math.round(rect.right - width);
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    bottom = Math.round(window.innerHeight - rect.top + gap);
    // 防止顶出视口：若估算高度过大，bottom 仍用输入框上方，由 max-height 内部滚动
    if (bottom < 12) bottom = 12;
  }

  const next = { left, bottom, width: Math.round(width) };
  // 几何几乎不变则不写 style，减少清 selection 的概率
  if (
    lastBox
    && Math.abs(lastBox.left - next.left) < 1
    && Math.abs(lastBox.bottom - next.bottom) < 1
    && lastBox.width === next.width
  ) {
    return;
  }
  lastBox = next;

  panel.style.width = `${next.width}px`;
  panel.style.left = `${next.left}px`;
  panel.style.right = 'auto';
  panel.style.top = 'auto';
  panel.style.bottom = `${next.bottom}px`;
}

function schedulePosition(panel) {
  if (shouldSkipReposition()) return;
  if (repositionRaf != null) cancelAnimationFrame(repositionRaf);
  repositionRaf = requestAnimationFrame(() => {
    repositionRaf = null;
    if (shouldSkipReposition()) return;
    positionPanel(panel || document.getElementById(PANEL_ID));
  });
}

function bindViewportWatchers() {
  if (viewportCleanup) return;
  const onMove = () => {
    if (shouldSkipReposition()) return;
    schedulePosition();
  };
  window.addEventListener('resize', onMove, { passive: true });
  // 不用 capture scroll：WA 内部滚动很密，容易在划选时抖 style
  window.addEventListener('scroll', onMove, { passive: true });
  const main = document.querySelector('#main');
  if (main) main.addEventListener('scroll', onMove, { passive: true });

  const onSelChange = () => {
    // 选区离开面板后允许恢复定位
    if (!isSelectionInsidePanel()) {
      selectionLock = false;
    }
  };
  document.addEventListener('selectionchange', onSelChange);

  viewportCleanup = () => {
    window.removeEventListener('resize', onMove);
    window.removeEventListener('scroll', onMove);
    if (main) main.removeEventListener('scroll', onMove);
    document.removeEventListener('selectionchange', onSelChange);
    viewportCleanup = null;
  };
}

function unbindViewportWatchers() {
  if (typeof viewportCleanup === 'function') viewportCleanup();
  if (repositionRaf != null) {
    cancelAnimationFrame(repositionRaf);
    repositionRaf = null;
  }
  selectionLock = false;
  lastBox = null;
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
  if (created) schedulePosition(panel);
  return { panel, moved: created };
}

function getMeta() {
  return lastMeta || { summary: '', explanation: '', translation: '' };
}

function previewText(meta) {
  return meta.summary || meta.explanation || meta.translation || '';
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

/** 按钮：阻止抢焦点 + 冒泡到 WA */
function stopButtonEvent(e) {
  e.preventDefault();
  e.stopPropagation();
}

/** 文本区：只挡冒泡，允许默认划选 */
function stopBubbleOnly(e) {
  e.stopPropagation();
}

function lockSelectionFromEvent() {
  selectionLock = true;
}

function unlockSelectionSoon() {
  // mouseup 后若仍有选区则保持 lock，直到 selectionchange 清空
  queueMicrotask(() => {
    if (!isSelectionInsidePanel()) selectionLock = false;
  });
}

function onToggleClick(e) {
  stopButtonEvent(e);
  expanded = !expanded;
  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    lastBox = null; // 高度变化，允许重算一次
    paintPanel(panel, true);
  }
}

function onCloseClick(e) {
  stopButtonEvent(e);
  hideAiExplainPanel();
}

function onCopyClick(e) {
  stopButtonEvent(e);
  const meta = getMeta();
  const lines = [];
  if (meta.summary) lines.push(`背景总结\n${meta.summary}`);
  if (meta.explanation) lines.push(`话术解释\n${meta.explanation}`);
  if (meta.translation) lines.push(`原文翻译\n${meta.translation}`);
  const text = lines.join('\n\n').trim();
  if (!text) return;
  const done = () => {
    const btn = e.currentTarget;
    if (!(btn instanceof HTMLElement)) return;
    const prev = btn.textContent;
    btn.textContent = '已复制';
    setTimeout(() => {
      if (btn.isConnected) btn.textContent = prev || '复制';
    }, 1200);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => {
      fallbackCopy(text);
      done();
    });
  } else {
    fallbackCopy(text);
    done();
  }
}

function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  } catch {
    // ignore
  }
}

function ensureShell(panel) {
  if (panel.querySelector('.waai-card')) return;

  panel.innerHTML =
    '<div class="waai-card">' +
      '<div class="waai-head">' +
        '<span class="waai-badge">AI 解释</span>' +
        '<span class="waai-title">说明</span>' +
        '<span class="waai-preview" data-waai="preview"></span>' +
        '<div class="waai-actions">' +
          '<button type="button" class="waai-btn" data-waai="copy" title="复制全部" aria-label="复制全部">复制</button>' +
          '<button type="button" class="waai-btn waai-btn-toggle" data-waai="toggle" title="展开说明" aria-label="展开说明">详情</button>' +
          '<button type="button" class="waai-btn waai-btn-close" data-waai="close" title="关闭" aria-label="关闭">×</button>' +
        '</div>' +
      '</div>' +
      '<div class="waai-body" data-waai="body"></div>' +
    '</div>';

  // 整卡：挡 WA 冒泡，但文本可默认划选
  panel.addEventListener('pointerdown', (e) => {
    stopBubbleOnly(e);
    const t = e.target;
    if (t instanceof Element && t.closest('.waai-btn')) return;
    lockSelectionFromEvent();
  });
  panel.addEventListener('mousedown', (e) => {
    stopBubbleOnly(e);
    const t = e.target;
    if (t instanceof Element && t.closest('.waai-btn')) return;
    lockSelectionFromEvent();
  });
  panel.addEventListener('mouseup', unlockSelectionSoon);
  panel.addEventListener('click', stopBubbleOnly);

  const toggleBtn = panel.querySelector('[data-waai="toggle"]');
  const closeBtn = panel.querySelector('[data-waai="close"]');
  const copyBtn = panel.querySelector('[data-waai="copy"]');

  for (const btn of [toggleBtn, closeBtn, copyBtn]) {
    if (!btn) continue;
    btn.addEventListener('pointerdown', stopButtonEvent);
    btn.addEventListener('mousedown', stopButtonEvent);
  }
  toggleBtn?.addEventListener('click', onToggleClick);
  closeBtn?.addEventListener('click', onCloseClick);
  copyBtn?.addEventListener('click', onCopyClick);
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
  const hasAny = !!(meta.summary || meta.explanation || meta.translation);
  if (!hasAny) expanded = false;

  const key = metaKey(meta, expanded);
  if (!force && key === lastRenderKey) {
    panel.classList.toggle('is-expanded', expanded);
    // 内容没变时：仅在未划选时轻量定位
    if (!shouldSkipReposition()) schedulePosition(panel);
    return;
  }
  lastRenderKey = key;

  const previewEl = panel.querySelector('[data-waai="preview"]');
  const toggleBtn = panel.querySelector('[data-waai="toggle"]');
  const body = panel.querySelector('[data-waai="body"]');

  panel.classList.toggle('is-expanded', expanded);

  if (previewEl) {
    const next = previewText(meta);
    if (previewEl.textContent !== next) previewEl.textContent = next;
    if (previewEl.getAttribute('title') !== next) previewEl.title = next;
  }

  if (toggleBtn) {
    const wantHidden = !hasAny;
    if (toggleBtn.hidden !== wantHidden) toggleBtn.hidden = wantHidden;
    const label = expanded ? '收起' : '详情';
    if (toggleBtn.textContent !== label) toggleBtn.textContent = label;
    toggleBtn.title = expanded ? '收起' : '展开说明';
    toggleBtn.setAttribute('aria-label', expanded ? '收起' : '展开说明');
  }

  if (body) {
    if (expanded && hasAny) {
      const html = buildBodyHtml(meta);
      // 仅 HTML 真变了才写，避免清掉选区
      if (body.innerHTML !== html) body.innerHTML = html;
    } else if (body.innerHTML) {
      body.innerHTML = '';
    }
  }

  if (!shouldSkipReposition()) {
    lastBox = null;
    schedulePosition(panel);
  }
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
  lastBox = null;
  selectionLock = false;

  if (!lastMeta.summary && !lastMeta.explanation && !lastMeta.translation) {
    hideAiExplainPanel();
    return null;
  }

  const mounted = ensurePanelMounted();
  if (!mounted) return null;
  mounted.panel.dataset.chatId = boundChatId;
  if (meta.mode) mounted.panel.dataset.mode = String(meta.mode);
  paintPanel(mounted.panel, true);
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
 * footer / toolbar 重建时：刷新位置；会话不一致则关闭。
 * 划选期间 no-op，避免清 selection。
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

  if (shouldSkipReposition()) return;

  const existing = document.getElementById(PANEL_ID);
  if (existing?.querySelector('.waai-card')) {
    schedulePosition(existing);
    return;
  }

  const mounted = ensurePanelMounted();
  if (!mounted) return;
  mounted.panel.dataset.chatId = boundChatId;
  paintPanel(mounted.panel, true);
}

/** 当前说明条绑定的会话 id */
export function getAiExplainPanelChatId() {
  return boundChatId || '';
}
