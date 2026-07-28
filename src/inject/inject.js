/**
 * inject/inject.js — Page 上下文入口
 *
 * 当前模式：本地注入的 WPP-first，React / DOM 兜底。
 * - WPP（@wppconnect/wa-js）由 content script 以 classic script 单独注入
 * - 本文件不再 bundle WPP，避免破坏 WA-JS 的 webpack 模块劫持
 * - WPP 不可用时回退到 React fiber
 * - React 再失败时回退到 DOM V1
 * - content ↔ inject 仍仅通过 postMessage RPC 通信
 *
 * 说明：
 * - composer（回复填入/发送）仍保留 DOM/Lexical 方案
 * - 历史加载仍使用滚动触发懒加载
 */

import { createRpc } from '../core/rpc.js';
import { debugLog } from '../core/logger.js';
import {
  getMessagesByReact,
  getSnsInfoByReact,
  getMeIdByReact,
} from '../core/react-fallback.js';
import {
  getMessagesByDom,
  getSnsInfoByDom,
} from '../core/dom-fallback.js';
import {
  getAudioBlobUrl,
  getMeId,
  revokeAudioBlobUrl,
  getMessages,
  getSendTimestamp,
  getSnsInfo,
} from '../core/data-extractor.js';
import { sendReply, fillSendInput, fillSendInputAsync, clickSendButton, normalizeComposerText } from '../core/composer.js';
import {
  SCROLLER_SELECTORS,
  COMPOSE_BOX_SELECTORS,
  queryFirst,
  readComposerText,
} from '../core/selectors.js';

let wppState = {
  ready: false,
  error: '',
};

/**
 * 等待条件，带超时
 * @param {() => boolean} cond
 * @param {number} timeout
 * @param {number} interval
 * @returns {Promise<boolean>}
 */
function waitFor(cond, timeout = 15000, interval = 150) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      try {
        if (cond()) return resolve(true);
      } catch {
        // ignore transient probe errors
      }
      if (Date.now() - start > timeout) return resolve(false);
      setTimeout(check, interval);
    };
    check();
  });
}

/**
 * WA-JS 暴露的是布尔 isReady / isFullReady，以及 onReady 回调。
 * 但在某些注入时序下，布尔标志可能长期为 false，而 chat/conn 已可用。
 * 因此以“核心 API 可探测”为主，布尔/事件为辅。
 */
function probeWppCoreReady() {
  const wpp = window.WPP;
  if (!wpp?.chat || !wpp?.conn) return false;
  if (typeof wpp.chat.getActiveChat !== 'function') return false;
  if (typeof wpp.conn.getMyUserId !== 'function') return false;

  // 只靠函数存在不够；store 未挂上时 getActiveChat 会抛 findFirst
  // 这里只做同步探测：isReady/isFullReady 优先
  if (wpp.isReady === true || wpp.isFullReady === true) return true;
  return false;
}

async function ensureWppReady(timeout = 30000) {
  if (wppState.ready && globalThis.window?.WPP) {
    // 二次校验，防止半残 WPP 被缓存成 ready
    if (window.WPP.isReady === true || window.WPP.isFullReady === true) {
      return window.WPP;
    }
    // 之前可能误标 ready，重置后继续等
    wppState = { ready: false, error: 'WPP flags not ready' };
  }

  try {
    const appeared = await waitFor(() => !!window.WPP, Math.min(timeout, 10000));
    if (!appeared || !window.WPP) {
      throw new Error('window.WPP is unavailable');
    }

    let eventResolved = false;
    if (typeof window.WPP.onReady === 'function') {
      try {
        window.WPP.onReady(() => {
          eventResolved = true;
        });
      } catch {
        // ignore
      }
    }
    if (typeof window.WPP.onFullReady === 'function') {
      try {
        window.WPP.onFullReady(() => {
          eventResolved = true;
        });
      } catch {
        // ignore
      }
    }

    const usable = await waitFor(() => {
      if (window.WPP?.isReady === true || window.WPP?.isFullReady === true) return true;
      if (eventResolved && window.WPP?.chat && window.WPP?.conn) return true;
      return probeWppCoreReady();
    }, timeout);

    if (!usable) {
      throw new Error(
        `WPP not usable after ${timeout}ms (isReady=${window.WPP?.isReady}, isFullReady=${window.WPP?.isFullReady}, hasChat=${!!window.WPP?.chat}, hasConn=${!!window.WPP?.conn})`,
      );
    }

    // 真正验证 getActiveChat 是否可调用（store 已挂上）
    try {
      await window.WPP.chat.getActiveChat();
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes('findFirst') || msg.includes('undefined')) {
        throw new Error(`WPP chat store not ready: ${msg}`);
      }
      // 没有 active chat 也算 store 可用
    }

    // 再验证 meId API
    try {
      window.WPP.conn.getMyUserId();
    } catch (e) {
      throw new Error(`WPP conn store not ready: ${e?.message || e}`);
    }

    wppState = { ready: true, error: '' };
    debugLog('[inject] WPP usable:', {
      isReady: window.WPP.isReady,
      isFullReady: window.WPP.isFullReady,
      eventResolved,
      hasChat: !!window.WPP.chat,
      hasConn: !!window.WPP.conn,
    });
    return window.WPP;
  } catch (error) {
    wppState = {
      ready: false,
      error: String(error?.message || error),
    };
    throw error;
  }
}

function getRuntimeMode() {
  return wppState.ready ? 'wpp-first' : 'react-first';
}

/**
 * 查找 WhatsApp Web 聊天消息的可滚动容器
 */
function getScroller() {
  for (const sel of SCROLLER_SELECTORS) {
    try {
      const el = document.querySelector(sel);
      if (el && (el.scrollHeight > el.clientHeight || el.scrollTop > 0)) return el;
    } catch {
      // continue
    }
  }
  // 兜底：#main 下第一个能滚动的 div
  const main = document.querySelector('#main');
  if (main) {
    let node = main;
    while (node) {
      if (node.scrollHeight > node.clientHeight) return node;
      node = node.firstElementChild;
    }
  }
  return null;
}

/**
 * 统计当前已加载的消息数
 * 优先从 chat.msgs._models 计数（完整数据模型），不受虚拟化影响
 */
function countLoadedMessages() {
  try {
    // 1) 优先：chat.msgs._models（完整数据模型）
    const mainDom = document.querySelector('div#main');
    const mainKey = mainDom
      ? Object.keys(mainDom).find((k) => k.startsWith('__reactProps$'))
      : '';
    const models = mainDom?.[mainKey]?.children
      ?.find((item) => item?.props?.chat)?.props?.chat?.msgs?._models || [];
    if (models.length > 0) return models.length;

    // 2) 兜底：从 .copyable-area 渲染树计数（虚拟化，可能不完整）
    const $list = document.querySelector('.copyable-area');
    const reactPropsKey = $list
      ? Object.keys($list).find((k) => k.startsWith('__reactProps$'))
      : '';
    const childrenList = $list?.[reactPropsKey]?.children || [];

    function countMsgProps(childrenList) {
      return childrenList.reduce((n, item) => {
        const { msg, msgs, children } = item?.props || {};
        if (children && children.length) return n + countMsgProps(children);
        if (Array.isArray(item)) return n + countMsgProps(item);
        if (msg) return n + 1;
        if (msgs && msgs.length) return n + msgs.length;
        return n;
      }, 0);
    }

    return childrenList.length ? countMsgProps(childrenList) : 0;
  } catch (e) {
    return 0;
  }
}

/**
 * 快速判断最新消息是否已渲染到 DOM（轻量版，只看底部有没有 message 节点）
 * 用于滚动回底部后确认渲染完成
 */
function getMessagesByReactQuick() {
  const nodes = document.querySelectorAll('#main [data-id]');
  return nodes.length;
}

/**
 * 程序化滚动触发 WhatsApp 原生懒加载，直到加载够 count 条消息或无更多历史。
 *
 * 原理：WhatsApp Web 的消息容器检测到 scrollTop 接近 0 时会自动请求更早的历史，
 * 追加到 chat.msgs._models 并插入 DOM。我们主动滚到顶 → 等消息数增长 → 重复。
 *
 * @param {number} count — 期望加载到的消息条数
 * @param {{ maxScrolls?: number, settleMs?: number }} options
 * @returns {Promise<{ loaded: number, scrolled: boolean }>}
 */
export async function loadMoreMessages(count, options = {}) {
  const maxScrolls = options.maxScrolls ?? 15;   // 防止无限滚动
  const settleMs = options.settleMs ?? 1200;      // 每次滚动后等待加载的最大时间
  const forceScroll = options.force === true;

  const already = countLoadedMessages();
  // 已够条数时：WPP 读的是 _models，不依赖可视区渲染，直接跳过滚顶/滚底
  // 这能省掉 2~5s 的无意义等待（AI 路径默认走这里）
  if (!forceScroll && already >= count) {
    debugLog(`[inject] loadMoreMessages: skip scroll, already ${already} >= ${count}`);
    return { loaded: already, scrolled: false, skipped: true };
  }

  const scroller = getScroller();
  if (!scroller) {
    console.warn('[inject] loadMoreMessages: 滚动容器未找到');
    return { loaded: countLoadedMessages(), scrolled: false };
  }

  let prevCount = already;
  let scrollTimes = 0;
  let stalled = 0;   // 连续无增长的次数

  while (prevCount < count && scrollTimes < maxScrolls && stalled < 2) {
    scroller.scrollTop = 0;   // 滚到顶触发懒加载
    scrollTimes++;

    await waitFor(
      () => countLoadedMessages() > prevCount,
      settleMs,
    );

    const newCount = countLoadedMessages();
    if (newCount > prevCount) {
      stalled = 0;
    } else {
      stalled++;   // 这轮没新增，可能到底了
    }
    prevCount = newCount;
  }

  // 只有真正滚过顶才需要滚回底部；否则别动用户视口
  if (scrollTimes > 0) {
    scroller.scrollTop = scroller.scrollHeight;
    await waitFor(
      () => {
        const latest = getMessagesByReactQuick();
        return latest > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 5;
      },
      1500,
      100,
    );
    await new Promise((r) => setTimeout(r, 80));
  }

  debugLog(
    `[inject] loadMoreMessages: 已加载 ${countLoadedMessages()} 条（滚动 ${scrollTimes} 次）`,
  );
  return { loaded: countLoadedMessages(), scrolled: scrollTimes > 0 };
}

/**
 * WPP-first 获取消息列表
 * value.includeMedia 默认 false（AI 路径不需要下载图/视频）
 */
async function handleGetMessages(value) {
  const limit = value?.limit || 20;
  const includeMedia = value?.includeMedia === true;
  const msgOptions = { includeMedia };

  try {
    await ensureWppReady();
    const msgs = await getMessages(limit > 0 ? limit : 0, msgOptions);
    if (msgs.length) {
      debugLog('[inject] getMessages via WPP:', msgs.length, 'includeMedia=', includeMedia);
      return limit > 0 ? msgs.slice(0, limit) : msgs;
    }
  } catch (e) {
    console.warn('[inject] WPP getMessages failed, fallback to React/DOM:', e?.message || e);
  }

  try {
    const msgs = await getMessagesByReact(msgOptions);
    if (msgs.length) return limit > 0 ? msgs.slice(0, limit) : msgs;
  } catch (e) {
    console.error('[inject] React getMessages failed:', e);
  }

  const isGroup = getSnsInfoByReact()?.isGroup || getSnsInfoByDom()?.isGroup || false;
  return getMessagesByDom(isGroup);
}

/** 会话信息短缓存：轮询场景避免反复打 WPP + 刷屏日志 */
let snsInfoCache = {
  value: null,
  at: 0,
  key: '',
};
const SNS_INFO_CACHE_MS = 800;
let lastLoggedSnsKey = '';

function snsCacheKey(info) {
  if (!info) return '';
  return `${info.snsId || ''}|${info.groupId || ''}|${info.isGroup ? 1 : 0}`;
}

function logSnsInfoOnce(source, info) {
  const key = `${source}:${snsCacheKey(info)}`;
  if (key === lastLoggedSnsKey) return;
  lastLoggedSnsKey = key;
  if (source === 'WPP') {
    debugLog('[inject] getSnsInfo via WPP:', {
      snsId: info?.snsId,
      groupId: info?.groupId,
      isGroup: info?.isGroup,
      hasMeId: !!info?.meId,
    });
  } else if (source === 'React') {
    debugLog('[inject] getSnsInfo via React:', {
      snsId: info?.snsId,
      isGroup: info?.isGroup,
      isLid: info?.isLid,
      hasMeId: !!info?.meId,
    });
  } else {
    debugLog('[inject] getSnsInfo (DOM fallback):', {
      snsId: info?.snsId,
      isGroup: info?.isGroup,
    });
  }
}

/**
 * WPP-first 获取当前会话信息
 * value?.force === true 时跳过缓存
 */
async function handleGetSnsInfo(value) {
  const force = value?.force === true;
  const now = Date.now();
  if (!force && snsInfoCache.value && (now - snsInfoCache.at) < SNS_INFO_CACHE_MS) {
    return snsInfoCache.value;
  }

  try {
    await ensureWppReady();
    const info = await getSnsInfo();
    if (info && (info.snsId || info.groupId)) {
      snsInfoCache = { value: info, at: now, key: snsCacheKey(info) };
      logSnsInfoOnce('WPP', info);
      return info;
    }
  } catch (e) {
    console.warn('[inject] WPP getSnsInfo failed, fallback to React/DOM:', e?.message || e);
  }

  try {
    const info = getSnsInfoByReact();
    if (info && (info.snsId || info.groupId)) {
      snsInfoCache = { value: info, at: now, key: snsCacheKey(info) };
      logSnsInfoOnce('React', info);
      return info;
    }
  } catch (e) {
    console.error('[inject] React getSnsInfo failed:', e);
  }

  const domInfo = getSnsInfoByDom();
  snsInfoCache = { value: domInfo, at: now, key: snsCacheKey(domInfo) };
  logSnsInfoOnce('DOM', domInfo);
  return domInfo;
}

/**
 * WPP-first 获取当前登录用户 ID
 */
async function handleGetMeId() {
  try {
    await ensureWppReady();
    const meId = getMeId() || '';
    if (meId) {
      debugLog('[inject] getMeId via WPP:', meId);
      return meId;
    }
  } catch (e) {
    console.warn('[inject] WPP getMeId failed, fallback to React/storage:', e?.message || e);
  }

  try {
    return getMeIdByReact() || '';
  } catch (e) {
    console.error('[inject] React getMeId failed:', e);
    return '';
  }
}

/**
 * WPP-first 获取音频 Blob URL
 */
async function handleGetAudioBlobUrl(value) {
  try {
    await ensureWppReady();
    return await getAudioBlobUrl(value?.dataId);
  } catch (e) {
    console.warn('[inject] WPP getAudioBlobUrl failed:', e?.message || e);
    return null;
  }
}

function handleRevokeAudioBlobUrl(value) {
  return revokeAudioBlobUrl(value?.url);
}

/**
 * WPP-first 获取精确发送时间戳
 */
async function handleGetSendTimestamp(value) {
  try {
    await ensureWppReady();
    return await getSendTimestamp(value?.dataId);
  } catch (e) {
    console.warn('[inject] WPP getSendTimestamp failed:', e?.message || e);
    return '';
  }
}

/**
 * 获取输入框当前内容（DOM 直读）
 */
async function handleGetInputContent() {
  return readComposerText() || queryFirst(COMPOSE_BOX_SELECTORS)?.innerText || '';
}

async function handleSendReply(value) {
  return sendReply(value?.text || '');
}

async function handleFillInput(value) {
  const text = value?.text || '';
  const replace = value?.replace ?? false;
  // 优先 async（WPP ComposeBoxActions.setTextContent）
  // 失败时禁止无脑再跑同步 fill：async 可能已写入成功但校验误判，
  // 第二次 fill 会变成追加 → 典型 text+text 叠字。
  try {
    const ok = await fillSendInputAsync(text, replace);
    if (ok) return true;
  } catch (e) {
    console.warn('[inject] fillSendInputAsync failed:', e?.message || e);
  }

  // 给 Lexical 一点时间落盘后再读
  await new Promise((r) => setTimeout(r, 50));
  let cur = '';
  try {
    cur = normalizeComposerText(readComposerText() || '');
  } catch {
    cur = '';
  }
  const want = normalizeComposerText(text || '');

  if (replace && want && cur === want) {
    console.log('[inject] skip sync fallback, composer already matches after async');
    return true;
  }
  if (replace && want && cur === want + want) {
    // 已叠字：只让 sync 路径做一次去重（composer 内会识别 doubled）
    console.warn('[inject] doubled after async, sync dedupe once');
    return fillSendInput(text, true);
  }

  // async 完全没动到内容时，才允许同步兜底一次
  if (replace && want && cur && cur !== want && !cur.startsWith(want)) {
    return fillSendInput(text, replace);
  }
  if (replace && want && !cur) {
    return fillSendInput(text, replace);
  }
  if (!replace) {
    return fillSendInput(text, replace);
  }

  console.warn('[inject] skip sync fallback to avoid double insert', {
    wantChars: want.length,
    curChars: cur.length,
    curPreview: cur.slice(0, 60),
  });
  return cur === want;
}

function handleClickSend() {
  return clickSendButton();
}

/**
 * 滚动加载更多历史消息
 */
async function handleLoadMoreMessages(value) {
  const count = value?.count || 50;
  return loadMoreMessages(count, value?.options || {});
}

/**
 * 主入口
 */
async function main() {
  debugLog('[WhatsApp AI SDK] inject.js loaded (WPP-first mode, external classic WPP)');

  try {
    await ensureWppReady();
    debugLog('[WhatsApp AI SDK] WPP ready');
  } catch (e) {
    console.warn('[WhatsApp AI SDK] WPP init failed, fallback to React/DOM:', e?.message || e);
  }

  const rpc = createRpc({
    origin: 'INJECT',
    post: (data) => window.postMessage(data, '*'),
    timeout: 15000,
  });
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    rpc.receive(event.data);
  });

  // 注册 RPC handler
  rpc.on('GET_MESSAGES', handleGetMessages);
  rpc.on('GET_SNS_INFO', handleGetSnsInfo);
  rpc.on('GET_ME_ID', handleGetMeId);
  rpc.on('GET_AUDIO_BLOB_URL', handleGetAudioBlobUrl);
  rpc.on('REVOKE_AUDIO_BLOB_URL', handleRevokeAudioBlobUrl);
  rpc.on('GET_SEND_TIMESTAMP', handleGetSendTimestamp);
  rpc.on('GET_INPUT_CONTENT', handleGetInputContent);
  rpc.on('SEND_REPLY', handleSendReply);
  rpc.on('FILL_INPUT', handleFillInput);
  rpc.on('CLICK_SEND', handleClickSend);
  rpc.on('LOAD_MORE_MESSAGES', handleLoadMoreMessages);

  rpc.emit('INJECT_READY', {
    mode: getRuntimeMode(),
    wppReady: wppState.ready,
    wppError: wppState.error,
  });
  debugLog(`[WhatsApp AI SDK] inject.js ready, mode=${getRuntimeMode()}, wppReady=${wppState.ready}`);
}

main();
