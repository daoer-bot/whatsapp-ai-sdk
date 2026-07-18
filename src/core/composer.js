/**
 * core/composer.js — 回复填入输入框 + 点击发送
 *
 * WhatsApp Web 的输入框是 contenteditable（Lexical），直接 setinnerText 不会触发
 * React 的受控更新，必须调用其 React props 上的 onInput，或用 execCommand 让 Lexical 处理。
 *
 * 两档策略：
 *   1) 优先走 React props.onInput(new InputEvent(""))
 *   2) 退化为 execCommand insertText
 */

import {
  COMPOSE_BOX_SELECTORS,
  SEND_BUTTON_SELECTORS,
  queryFirst,
} from './selectors.js';

/**
 * 清除 HTML 标签，只留纯文本（用于粘贴场景）
 */
function formatRichText(text) {
  return (text || '').replace(/<\/?[a-zA-Z]+(\s+[a-zA-Z]+=".*")*>/g, '');
}

/**
 * 找到输入框元素
 * @returns {HTMLElement|null}
 */
function getSendInput() {
  const dom = queryFirst(COMPOSE_BOX_SELECTORS);
  if (!dom) return null;
  // 有些选择器会命中内部 <p>，需要回到 contenteditable 容器
  if (dom.tagName === 'P' && dom.parentElement) {
    const parent = dom.parentElement;
    if (parent.isContentEditable || parent.getAttribute('contenteditable') === 'true') {
      return parent;
    }
  }
  return dom;
}

/**
 * 在 DOM 节点上找 React 事件处理器的 key
 */
function getReactEventHandler(dom) {
  const key = Object.keys(dom || {}).find(
    (k) => k.includes('reactEventHandlers') || k.includes('reactProps'),
  );
  return key ? dom[key] : null;
}

/**
 * 将文本写进输入框
 * @param {string} text
 * @param {boolean} isNeedClearInput — true=替换；false=追加到现有内容
 */
export function fillSendInput(text, isNeedClearInput = false) {
  const sendInput = getSendInput();
  if (!sendInput) {
    console.error('[composer] 输入框未找到');
    return false;
  }

  const richText = formatRichText(text);

  // 路径 1：通过 React props.onInput 更新（推荐）
  if (sendInput.previousElementSibling) {
    const sendCtx = getReactEventHandler(sendInput.parentElement)?.children?.[1]?.props;
    if (sendCtx && typeof sendCtx.onInput === 'function') {
      sendInput.previousElementSibling.style.visibility = 'hidden';

      if (isNeedClearInput) {
        // 替换模式：先彻底清空已有内容（包括子节点），再写入新文本
        sendInput.innerHTML = '';
        const p = document.createElement('p');
        p.innerText = richText;
        sendInput.appendChild(p);
      } else {
        const defaultText = sendInput.innerText || '';
        sendInput.innerText = defaultText + richText;
      }

      sendCtx.onInput(new InputEvent(''));
      return true;
    }
  }

  // 路径 2：Lexical 编辑器
  // WhatsApp 的输入框是 Lexical (data-lexical-editor="true")，
  // 直接操作 DOM + 派发 input 事件要么被 Lexical 二次插入（data 不为空），
  // 要么被 Lexical 清空（data 为空）。正确做法是用 execCommand 让 Lexical 自己处理。
  sendInput.setAttribute('contenteditable', true);
  sendInput.focus();

  if (isNeedClearInput) {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(sendInput);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('delete', false);

    if (richText) {
      document.execCommand('insertText', false, richText);
    }
  } else {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(sendInput);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);

    if (richText) {
      document.execCommand('insertText', false, richText);
    }
  }

  return true;
}

function findSendButton() {
  for (const sel of SEND_BUTTON_SELECTORS) {
    try {
      const el = document.querySelector(sel);
      if (!el) continue;
      // 图标节点 → 向上找 button / role=button
      const btn = el.closest?.('button, [role="button"]') || el.parentElement?.parentElement || el;
      if (btn) return btn;
    } catch {
      // continue
    }
  }
  // 输入框旁边的发送区
  const sendInput = getSendInput();
  const alt = sendInput?.parentElement?.parentElement?.nextElementSibling;
  if (alt) return alt;
  return null;
}

/**
 * 点击发送按钮
 * @returns {boolean}
 */
export function clickSendButton() {
  const btn = findSendButton();
  if (btn) {
    btn.click();
    return true;
  }
  console.error('[composer] 发送按钮未找到');
  return false;
}

/**
 * 等待发送按钮出现（填入文本后 WA 会把麦克风换成发送）
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function waitForSendButton(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (findSendButton()) return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(tick, 50);
    };
    tick();
  });
}

/**
 * 一步完成：填入文本 + 发送
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function sendReply(text) {
  const ok = fillSendInput(text, true);
  if (!ok) return false;
  // 给 React/Lexical 时间更新 send button 状态
  const ready = await waitForSendButton(1500);
  if (!ready) {
    // 再等一帧硬点一次
    await new Promise((r) => setTimeout(r, 100));
  }
  return clickSendButton();
}
