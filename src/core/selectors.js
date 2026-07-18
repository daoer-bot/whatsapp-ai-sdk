/**
 * core/selectors.js — WhatsApp Web DOM 选择器集中管理
 *
 * 输入框 / 发送按钮 / 滚动容器等会随 WA 版本变化，
 * 统一放这里，避免 content / inject / composer 各写一份。
 */

/** 输入框（contenteditable）候选，按优先级 */
export const COMPOSE_BOX_SELECTORS = [
  'div[spellcheck="true"][role="textbox"][data-testid="conversation-compose-box-input"]',
  'footer > div.copyable-area div.lexical-rich-text-input',
  '#main footer [contenteditable="true"][data-tab]',
  '#main footer [contenteditable="true"]',
  '#main footer > .copyable-area .copyable-text',
];

/** 发送按钮图标 / 测试 id */
export const SEND_BUTTON_SELECTORS = [
  'span[data-icon="send"]',
  'span[data-testid="send"]',
  'span[data-icon="wds-ic-send-filled"]',
  'button[data-testid="send"]',
  'button[aria-label="发送"]',
  'button[aria-label="Send"]',
];

/** 消息列表可滚动容器 */
export const SCROLLER_SELECTORS = [
  '#main .copyable-area > div[tabindex="0"]',
  '#main div[tabindex="0"]',
];

/** 麦克风按钮（多语言 aria-label + data-icon） */
export const MIC_BUTTON_SELECTORS = [
  'button[data-testid="compose-btn-voice"]',
  'button[aria-label="语音消息"]',
  'button[aria-label="Voice message"]',
  'button[aria-label="Mensagem de voz"]',
  'button[aria-label="Mensaje de voz"]',
  'span[data-icon="mic"]',
  'span[data-icon="ptt"]',
  'span[data-icon="wds-ic-mic-on"]',
];

/** 输入区容器 */
export const COPYABLE_AREA_SELECTOR = '#main footer .copyable-area';

/**
 * 按候选选择器找第一个匹配元素
 * @param {string[]} selectors
 * @param {ParentNode} [root]
 * @returns {Element|null}
 */
export function queryFirst(selectors, root = document) {
  for (const sel of selectors) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch {
      // ignore invalid selector
    }
  }
  return null;
}

/**
 * 读取输入框纯文本（去掉 zero-width 占位）
 * @returns {string}
 */
export function readComposerText() {
  for (const sel of COMPOSE_BOX_SELECTORS) {
    try {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = (el.innerText || el.textContent || '').replace(/\u200B/g, '').trim();
      // 命中节点即返回（允许空串，表示输入框存在但为空）
      if (el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox') {
        return text;
      }
      // 非 contenteditable 的中间层，继续找
      if (text) return text;
    } catch {
      // continue
    }
  }
  return '';
}
