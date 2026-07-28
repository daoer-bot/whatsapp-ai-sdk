/**
 * content/toast.js — 轻量 toast / 错误提示
 *
 * 不依赖外部 UI 库，挂在 documentElement 上，自动消失。
 * 支持可选操作按钮（例如「打开设置」）。
 */

const TOAST_ID = 'waai-toast';
const STYLE_ID = 'waai-toast-style';

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${TOAST_ID} {
      position: fixed;
      left: 50%;
      bottom: 88px;
      transform: translateX(-50%);
      z-index: 99999;
      max-width: min(480px, calc(100vw - 32px));
      padding: 10px 14px;
      border-radius: 12px;
      background: rgba(17, 27, 33, 0.92);
      color: #fff;
      font: 600 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      box-shadow: 0 8px 24px rgba(0,0,0,.18);
      pointer-events: none;
      opacity: 0;
      transition: opacity .15s ease, transform .15s ease;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    #${TOAST_ID}.is-error {
      background: rgba(185, 28, 28, 0.95);
    }
    #${TOAST_ID}.is-visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    #${TOAST_ID}.has-action {
      pointer-events: auto;
    }
    #${TOAST_ID} .waai-toast-msg {
      flex: 1 1 auto;
      min-width: 0;
    }
    #${TOAST_ID} .waai-toast-action {
      flex: 0 0 auto;
      border: 1px solid rgba(255,255,255,.55);
      background: rgba(255,255,255,.12);
      color: #fff;
      border-radius: 9999px;
      padding: 4px 10px;
      font: 700 12px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      cursor: pointer;
      white-space: nowrap;
    }
    #${TOAST_ID} .waai-toast-action:hover {
      background: rgba(255,255,255,.22);
    }
  `;
  document.documentElement.appendChild(style);
}

let hideTimer = null;

/**
 * 立刻隐藏 toast
 */
export function hideToast() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  const el = document.getElementById(TOAST_ID);
  if (el) el.classList.remove('is-visible');
}

/**
 * @param {string} message
 * @param {{
 *   type?: 'info'|'error',
 *   durationMs?: number,
 *   actionLabel?: string,
 *   onAction?: () => void,
 * }} [options]
 *   durationMs: 0 = 不自动消失（需手动 hideToast）
 */
export function showToast(message, options = {}) {
  const text = String(message || '').trim();
  if (!text) return;

  ensureStyle();
  let el = document.getElementById(TOAST_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = TOAST_ID;
    document.documentElement.appendChild(el);
  }

  el.textContent = '';
  const msgEl = document.createElement('span');
  msgEl.className = 'waai-toast-msg';
  msgEl.textContent = text;
  el.appendChild(msgEl);

  const hasAction = !!(options.actionLabel && typeof options.onAction === 'function');
  el.classList.toggle('has-action', hasAction);
  if (hasAction) {
    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'waai-toast-action';
    actionBtn.textContent = String(options.actionLabel);
    actionBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideToast();
      try {
        options.onAction();
      } catch {
        // ignore action handler errors
      }
    });
    el.appendChild(actionBtn);
  }

  el.classList.toggle('is-error', options.type === 'error');
  // 强制 reflow 以便重复弹出时动画重放
  el.classList.remove('is-visible');
  void el.offsetWidth;
  el.classList.add('is-visible');

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;

  const duration = options.durationMs;
  // durationMs === 0：常驻，直到 hideToast / 下一次 toast
  if (duration === 0) return;

  // 带操作按钮时默认多留一会儿，方便点
  const fallback = hasAction ? 5200 : 2200;
  hideTimer = setTimeout(() => {
    el.classList.remove('is-visible');
    hideTimer = null;
  }, duration == null ? fallback : duration);
}

/**
 * @param {string} message
 * @param {{ actionLabel?: string, onAction?: () => void, durationMs?: number }} [options]
 */
export function showErrorToast(message, options = {}) {
  showToast(message, {
    type: 'error',
    durationMs: options.durationMs == null ? (options.actionLabel ? 5600 : 3600) : options.durationMs,
    actionLabel: options.actionLabel,
    onAction: options.onAction,
  });
}
