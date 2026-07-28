/**
 * core/composer.js — 回复填入输入框 + 点击发送
 *
 * WhatsApp Web 输入框是 Lexical contenteditable。
 *
 * 叠字铁律（血泪）：
 *   1. replace 模式任何时刻最多「成功写入」一次目标文案
 *   2. insertText 前必须确认：输入框已空，或选区覆盖全部内容
 *   3. 禁止「第一次写成功但校验误判 → 再 insert 一次」——会变成 text+text
 *   4. 多路径只能串行；前一路径已把内容写成 want / want+want 时立刻停
 *
 * 优先级：
 *   1) WPP ComposeBoxActions.setTextContent
 *   2) 全选 + 单次 insertText（选区无效则不写）
 *   3) 清空后单次 insertText
 */

import {
  COMPOSE_BOX_SELECTORS,
  SEND_BUTTON_SELECTORS,
  queryFirst,
} from './selectors.js';

function formatRichText(text) {
  return (text || '').replace(/<\/?[a-zA-Z]+(\s+[a-zA-Z]+=".*")*>/g, '');
}

export function normalizeComposerText(text) {
  return String(text || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function getSendInput() {
  const dom = queryFirst(COMPOSE_BOX_SELECTORS);
  if (!dom) return null;

  if (dom.tagName === 'P' && dom.parentElement) {
    const parent = dom.parentElement;
    if (parent.isContentEditable || parent.getAttribute('contenteditable') === 'true') {
      return parent;
    }
  }

  if (!(dom.isContentEditable || dom.getAttribute('contenteditable') === 'true')) {
    const inner =
      dom.querySelector?.('[contenteditable="true"][data-lexical-editor="true"]')
      || dom.querySelector?.('[contenteditable="true"][role="textbox"]')
      || dom.querySelector?.('[contenteditable="true"]');
    if (inner) return inner;
  }

  return dom;
}

function readInputText(el = getSendInput()) {
  if (!el) return '';
  return normalizeComposerText(el.innerText || el.textContent || '');
}

function focusInput(el) {
  if (!el) return;
  try { el.focus(); } catch { /* ignore */ }
  const p = el.querySelector?.('p');
  if (p) {
    try { p.focus?.(); } catch { /* ignore */ }
  }
  try { el.focus(); } catch { /* ignore */ }
}

function textsMatch(after, want) {
  if (!want) return !after;
  if (after === want) return true;
  // WA 有时在末尾多一个换行/空格，normalize 后仍可能残留单换行差异
  if (normalizeComposerText(after) === normalizeComposerText(want)) return true;
  return false;
}

/** 典型叠字：正好两遍目标文案 */
function isExactDouble(after, want) {
  if (!want || !after) return false;
  if (after === want + want) return true;
  // 中间可能被插了换行
  if (after === want + '\n' + want) return true;
  if (after.length >= want.length * 2 && after.startsWith(want) && after.endsWith(want)) {
    const mid = after.slice(want.length, after.length - want.length).trim();
    return mid === '';
  }
  return false;
}

/**
 * 选中整个输入框。返回是否选区看起来有效（非折叠或原本就空）。
 */
function selectAllContents(el) {
  if (!el) return false;
  focusInput(el);
  const sel = window.getSelection();
  if (!sel) return false;
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    try { document.execCommand('selectAll', false); } catch { /* ignore */ }

    if (!readInputText(el)) return true; // 空盒，折叠也没关系
    if (sel.isCollapsed) return false;
    if (sel.rangeCount < 1) return false;
    const r = sel.getRangeAt(0);
    // 选区应覆盖有内容的范围
    return !r.collapsed && String(r.toString() || '').length > 0;
  } catch {
    return false;
  }
}

function clearComposer(el) {
  if (!el) return true;
  focusInput(el);

  for (let i = 0; i < 3; i += 1) {
    if (!readInputText(el)) return true;
    if (!selectAllContents(el) && readInputText(el)) {
      // 选不中就别瞎 delete
      break;
    }
    document.execCommand('delete', false);
    document.execCommand('insertText', false, '');
  }

  if (!readInputText(el)) return true;

  try {
    while (el.firstChild) el.removeChild(el.firstChild);
    const p = document.createElement('p');
    p.appendChild(document.createElement('br'));
    el.appendChild(p);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  } catch {
    // ignore
  }

  return !readInputText(el);
}

/**
 * 仅在「已空」或「选区覆盖全文」时插入一次。否则拒绝写入（防止追加叠字）。
 */
function insertOnceSafe(el, text) {
  if (!el) return false;
  if (!text) {
    return clearComposer(el);
  }

  focusInput(el);
  const before = readInputText(el);

  if (!before) {
    // 空：折叠光标 insert 一次
    const sel = window.getSelection();
    if (sel) {
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch {
        // ignore
      }
    }
    const ok = document.execCommand('insertText', false, text);
    return !!ok;
  }

  // 有内容：必须先全选，选不中就拒绝（绝不能 insert → 追加）
  if (!selectAllContents(el)) {
    console.warn('[composer] insertOnceSafe: selectAll failed, refuse insert to avoid append');
    return false;
  }
  return !!document.execCommand('insertText', false, text);
}

/**
 * 若已是 want 或 want+want，做收尾：匹配则成功；叠字则尝试修一次。
 * @returns {{ done: boolean, ok: boolean, after: string, reason: string }}
 */
function settleAfterWrite(el, want, after, reasonPrefix) {
  if (textsMatch(after, want)) {
    return { done: true, ok: true, after, reason: reasonPrefix + '-ok' };
  }
  if (isExactDouble(after, want)) {
    console.warn('[composer] detected doubled text, recovering once');
    // 只允许一次修复：全选后写入单份
    if (el && selectAllContents(el)) {
      document.execCommand('insertText', false, want);
      const fixed = readInputText(el);
      if (textsMatch(fixed, want)) {
        return { done: true, ok: true, after: fixed, reason: reasonPrefix + '-dedupe-ok' };
      }
    }
    return { done: true, ok: false, after, reason: reasonPrefix + '-doubled' };
  }
  return { done: false, ok: false, after, reason: reasonPrefix + '-mismatch' };
}

async function fillViaWpp(text) {
  const WPP = globalThis.window?.WPP;
  const actions = WPP?.whatsapp?.ComposeBoxActions;
  if (!actions || typeof actions.setTextContent !== 'function') {
    return { ok: false, reason: 'no-ComposeBoxActions' };
  }

  let chat = null;
  try {
    if (typeof WPP.chat?.getActiveChat === 'function') {
      chat = await WPP.chat.getActiveChat();
    }
  } catch (e) {
    return { ok: false, reason: 'getActiveChat-error:' + (e?.message || e) };
  }

  if (!chat) {
    chat = WPP.whatsapp?.ChatStore?.getActive?.()
      || WPP.whatsapp?.ChatCollection?.getActive?.()
      || null;
  }
  if (!chat) return { ok: false, reason: 'no-active-chat' };

  const want = normalizeComposerText(text);

  try {
    try { actions.focus?.(chat); } catch { /* ignore */ }
    // 只 set 一次目标文案。不要先 set('') 再 set(text)：
    // 部分 WA 版本两次 set 会竞态，读回时像「空/半残」导致后续 DOM 路径再写一遍 → 叠字。
    actions.setTextContent(chat, text == null ? '' : text);
  } catch (e) {
    return { ok: false, reason: 'setTextContent-throw:' + (e?.message || e) };
  }

  // Lexical 落盘可能偏慢：轮询等待，避免「WPP 已写但读早了 → DOM 再写一遍 → 叠字」
  let after = '';
  let settled = { done: false, ok: false, after: '', reason: 'wpp-pending' };
  for (let i = 0; i < 6; i += 1) {
    await new Promise((r) => setTimeout(r, i === 0 ? 80 : 60));
    after = readInputText();
    settled = settleAfterWrite(getSendInput(), want, after, i === 0 ? 'wpp' : 'wpp-poll');
    if (settled.done) {
      console.log('[composer] WPP setTextContent', settled);
      return { ok: settled.ok, reason: settled.reason, after: settled.after };
    }
    // 已出现目标前缀但尚未完全匹配时继续等，别急着 DOM 追加
    if (want && after && after.length > 0) {
      continue;
    }
  }
  console.log('[composer] WPP setTextContent give up', {
    wantChars: want.length,
    afterChars: after.length,
    preview: after.slice(0, 60),
  });
  return { ok: false, reason: 'wpp-mismatch', after };
}

function fillViaSelectReplace(el, text) {
  if (!el) return { ok: false, reason: 'no-el' };
  const want = normalizeComposerText(text);

  // 已经对了
  let after = readInputText(el);
  if (textsMatch(after, want)) {
    return { ok: true, reason: 'already-ok', after };
  }
  // 已经叠了：只修一次
  const doubled = settleAfterWrite(el, want, after, 'pre');
  if (doubled.done) return { ok: doubled.ok, reason: doubled.reason, after: doubled.after };

  // 关键：只 insert 一次；选不中就失败，绝不无选区 insert
  const inserted = insertOnceSafe(el, text);
  after = readInputText(el);
  console.log('[composer] select-replace once', {
    inserted,
    wantChars: want.length,
    afterChars: after.length,
    preview: after.slice(0, 80),
  });

  const settled = settleAfterWrite(el, want, after, 'select-replace');
  if (settled.done) return { ok: settled.ok, reason: settled.reason, after: settled.after };

  // 唯一补救：先清空，再空盒 insert 一次（仍只一次）
  if (!clearComposer(el)) {
    // 清空失败且当前不是 want：放弃，别再 insert
    return { ok: false, reason: 'select-replace-clear-failed', after: readInputText(el) };
  }
  if (want) {
    const ok2 = insertOnceSafe(el, text);
    after = readInputText(el);
    if (!ok2 && !textsMatch(after, want)) {
      return { ok: false, reason: 'select-replace-reinsert-failed', after };
    }
  }
  after = readInputText(el);
  return {
    ok: textsMatch(after, want),
    reason: textsMatch(after, want) ? 'select-replace-clear-ok' : 'select-replace-mismatch',
    after,
  };
}

function fillViaLexical(el, text) {
  if (!el) return { ok: false, reason: 'no-el' };
  const want = normalizeComposerText(text);
  let after = readInputText(el);
  if (textsMatch(after, want)) return { ok: true, reason: 'already-ok', after };

  const settled0 = settleAfterWrite(el, want, after, 'lex-pre');
  if (settled0.done) return { ok: settled0.ok, reason: settled0.reason, after: settled0.after };

  const cleared = clearComposer(el);
  if (!cleared && readInputText(el)) {
    // 有残留时改走 select-replace（内部仍只写一次）
    return fillViaSelectReplace(el, text);
  }
  if (want) {
    const ok = insertOnceSafe(el, text);
    if (!ok) return { ok: false, reason: 'lexical-insert-failed', after: readInputText(el) };
  }
  after = readInputText(el);
  const settled = settleAfterWrite(el, want, after, 'lexical');
  if (settled.done) return { ok: settled.ok, reason: settled.reason, after: settled.after };
  return { ok: textsMatch(after, want), reason: 'lexical-mismatch', after };
}

function appendText(el, text) {
  if (!el || !text) return !text;
  focusInput(el);
  const sel = window.getSelection();
  if (!sel) return false;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  return document.execCommand('insertText', false, text);
}

/**
 * 同步填入
 */
export function fillSendInput(text, isNeedClearInput = false) {
  const richText = formatRichText(text);
  const want = normalizeComposerText(richText);
  const el = getSendInput();

  if (!el && !globalThis.window?.WPP?.whatsapp?.ComposeBoxActions) {
    console.error('[composer] 输入框未找到');
    return false;
  }

  const cur = readInputText(el);
  console.log('[composer] fill start (sync)', {
    replace: !!isNeedClearInput,
    wantChars: want.length,
    curChars: cur.length,
    same: textsMatch(cur, want),
    doubled: isExactDouble(cur, want),
  });

  if (!isNeedClearInput) {
    if (!el) return false;
    return appendText(el, richText);
  }

  if (textsMatch(cur, want) && want) {
    console.log('[composer] skip, already same');
    return true;
  }
  if (isExactDouble(cur, want)) {
    const fixed = settleAfterWrite(el, want, cur, 'sync-pre');
    return fixed.ok;
  }

  if (!el) return false;

  // 同步路径：只走 select-replace（单次写入语义）
  const result = fillViaSelectReplace(el, richText);
  if (result.ok) return true;
  const lex = fillViaLexical(el, richText);
  return lex.ok;
}

/**
 * 异步填入（推荐）
 * 关键约束：任一路径写入后若已是 want 或已检测到叠字并处理，必须 return，禁止再跑下一条路径。
 */
export async function fillSendInputAsync(text, replace = true) {
  const richText = formatRichText(text);
  const want = normalizeComposerText(richText);
  const el = getSendInput();

  let cur = readInputText(el);
  console.log('[composer] fill start (async)', {
    replace: !!replace,
    wantChars: want.length,
    curChars: cur.length,
    same: textsMatch(cur, want),
    doubled: isExactDouble(cur, want),
  });

  if (!replace) {
    if (!el) return false;
    return appendText(el, richText);
  }

  if (textsMatch(cur, want) && want) {
    console.log('[composer] skip, already same');
    return true;
  }
  if (isExactDouble(cur, want)) {
    const fixed = settleAfterWrite(el, want, cur, 'async-pre');
    return fixed.ok;
  }

  // 1) WPP
  const wpp = await fillViaWpp(richText);
  cur = readInputText(el);
  // WPP 声称失败但 DOM 已是 want / 已叠字 → 停
  if (textsMatch(cur, want)) {
    console.log('[composer] stop after WPP: DOM already matches');
    return true;
  }
  if (isExactDouble(cur, want)) {
    return settleAfterWrite(el, want, cur, 'after-wpp').ok;
  }
  if (wpp.ok) return true;
  console.warn('[composer] WPP path failed:', wpp.reason);

  if (!el) {
    await new Promise((r) => setTimeout(r, 50));
    const wpp2 = await fillViaWpp(richText);
    return wpp2.ok || textsMatch(readInputText(), want);
  }

  // 2) 全选单次覆盖
  const selectReplace = fillViaSelectReplace(el, richText);
  cur = readInputText(el);
  if (textsMatch(cur, want) || selectReplace.ok) return true;
  if (isExactDouble(cur, want)) {
    return settleAfterWrite(el, want, cur, 'after-select').ok;
  }
  console.warn('[composer] select-replace failed:', selectReplace.reason);

  // 3) lexical / clear+insert（内部仍单次）
  const lex = fillViaLexical(el, richText);
  cur = readInputText(el);
  if (textsMatch(cur, want) || lex.ok) return true;
  if (isExactDouble(cur, want)) {
    return settleAfterWrite(el, want, cur, 'after-lex').ok;
  }

  console.error('[composer] all paths failed', {
    wantChars: want.length,
    afterChars: cur.length,
    afterPreview: cur.slice(0, 100),
  });
  return false;
}

function findSendButton() {
  for (const sel of SEND_BUTTON_SELECTORS) {
    try {
      const el = document.querySelector(sel);
      if (!el) continue;
      const btn = el.closest?.('button, [role="button"]') || el.parentElement?.parentElement || el;
      if (btn) return btn;
    } catch {
      // continue
    }
  }
  const sendInput = getSendInput();
  const alt = sendInput?.parentElement?.parentElement?.nextElementSibling;
  if (alt) return alt;
  return null;
}

export function clickSendButton() {
  const btn = findSendButton();
  if (btn) {
    btn.click();
    return true;
  }
  console.error('[composer] 发送按钮未找到');
  return false;
}

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

export async function sendReply(text) {
  const ok = await fillSendInputAsync(text, true);
  if (!ok) return false;
  const ready = await waitForSendButton(1500);
  if (!ready) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return clickSendButton();
}
