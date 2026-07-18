/**
 * content/toast.js — 轻量 toast / 错误提示
 *
 * 不依赖外部 UI 库，挂在 documentElement 上，自动消失。
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
      max-width: min(420px, calc(100vw - 32px));
      padding: 10px 14px;
      border-radius: 12px;
      background: rgba(17, 27, 33, 0.92);
      color: #fff;
      font: 600 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      box-shadow: 0 8px 24px rgba(0,0,0,.18);
      pointer-events: none;
      opacity: 0;
      transition: opacity .15s ease, transform .15s ease;
    }
    #${TOAST_ID}.is-error {
      background: rgba(185, 28, 28, 0.95);
    }
    #${TOAST_ID}.is-visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
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
 * @param {{ type?: 'info'|'error', durationMs?: number }} [options]
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

  el.textContent = text;
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

  hideTimer = setTimeout(() => {
    el.classList.remove('is-visible');
    hideTimer = null;
  }, duration == null ? 2200 : duration);
}

export function showErrorToast(message) {
  showToast(message, { type: 'error', durationMs: 3600 });
}
