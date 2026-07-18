/**
 * content/content.js — Content Script（isolated world）
 *
 * 采用页面注入与隔离上下文通信架构：
 *   - 通过 rollup 打成 IIFE bundle（classic script），避免 MV3 content_scripts 不支持 import
 *   - 向页面注入 inject.js（page world，ESM，可访问 window.WPP / __reactProps$）
 *   - content ↔ inject 之间只靠 postMessage RPC 通信
 *   - SDK 暴露在 isolated world 的 window.WhatsappAI（供 content script 自身的 UI 使用）
 *
 * 交互：
 *   - 输入框为空：按钮显示「帮我回复」，点击后根据聊天历史生成回复
 *   - 输入框已有内容：按钮显示「帮我优化」，点击后润色草稿并回填
 */

import { createRpc } from '../core/rpc.js';
import { startMessageMonitor } from '../core/message-monitor.js';
import { generateReply, streamReply } from '../core/ai-client.js';
import { loadAiConfig } from '../core/ai-config.js';
import { debugLog, setDebugEnabled } from '../core/logger.js';
import { readComposerText } from '../core/selectors.js';
import { createAiButton } from './ai-button.js';
import { showAiExplainPanel, hideAiExplainPanel, reanchorAiExplainPanel, getAiExplainPanelChatId } from './ai-panel.js';
import { showErrorToast, showToast, hideToast } from './toast.js';

// ---- 1) 注入 page 上下文脚本 ----
function injectScript(src, type = 'module') {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.type = type;
    s.onload = () => {
      s.remove();
      resolve();
    };
    s.onerror = () => {
      s.remove();
      reject(new Error(`Failed to inject script: ${src}`));
    };
    (document.head || document.documentElement).appendChild(s);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 扩展被重载/禁用后，旧 content script 里 chrome.runtime 会失效。
 * 此时 getURL 会报：Cannot read properties of undefined (reading 'getURL')
 */
function isExtensionContextValid() {
  try {
    return !!(globalThis.chrome?.runtime?.id && typeof chrome.runtime.getURL === 'function');
  } catch {
    return false;
  }
}

function extensionAssetUrl(path) {
  if (!isExtensionContextValid()) {
    throw new Error(
      'Extension context invalidated. 请刷新 WhatsApp 页面（F5）后重试。' +
      '（常见原因：在 chrome://extensions 重载了扩展，但页面还是旧 content script）',
    );
  }
  return chrome.runtime.getURL(path);
}

/**
 * WA-JS 必须等 WhatsApp 自己的 webpack 模块就绪后再注入。
 * document_start 立刻注入会导致大量 Module not found / isAuthenticated 报错。
 */
async function waitForWhatsAppShell(timeout = 60000) {
  const startAt = Date.now();
  while (Date.now() - startAt < timeout) {
    // 等待过程中扩展也可能被重载
    if (!isExtensionContextValid()) {
      throw new Error(
        'Extension context invalidated while waiting for WhatsApp shell. 请刷新页面。',
      );
    }
    if (
      document.querySelector('#app') &&
      (
        document.querySelector('#pane-side') ||
        document.querySelector('#side') ||
        document.querySelector('#main') ||
        document.querySelector('div[data-testid="chat-list"]') ||
        document.querySelector('canvas[aria-label]')
      )
    ) {
      // 再给 webpack chunk 一点时间完成导出
      await sleep(1500);
      return true;
    }
    await sleep(300);
  }
  return false;
}

// WA-JS 必须作为 classic script 单独注入，且在 inject.js 之前。
// 不要把 WPP bundle 进 ESM inject.js，否则会破坏它的 webpack 模块劫持。
(async () => {
  try {
    if (!isExtensionContextValid()) {
      console.warn(
        '[WhatsApp AI SDK] 扩展上下文已失效（多半刚重载过扩展）。请刷新 WhatsApp 页面后重试。',
      );
      return;
    }

    const shellReady = await waitForWhatsAppShell();
    if (!shellReady) {
      console.warn('[WhatsApp AI SDK] WhatsApp shell not ready in time; inject WPP anyway');
    } else {
      debugLog('[WhatsApp AI SDK] WhatsApp shell ready, injecting WPP...');
    }

    try {
      await injectScript(extensionAssetUrl('dist/wpp.js'), 'text/javascript');
      debugLog('[WhatsApp AI SDK] classic WPP injected');
    } catch (e) {
      console.warn('[WhatsApp AI SDK] classic WPP inject failed:', e?.message || e);
    }

    // 给 WA-JS 一点时间去 hook webpack modules
    await sleep(800);

    try {
      await injectScript(extensionAssetUrl('dist/inject.js'), 'module');
    } catch (e) {
      console.error('[WhatsApp AI SDK] inject.js inject failed:', e?.message || e);
    }

    try {
      await injectScript(extensionAssetUrl('dist/bridge.js'), 'text/javascript');
    } catch (e) {
      console.warn('[WhatsApp AI SDK] bridge.js inject failed:', e?.message || e);
    }
  } catch (e) {
    console.warn('[WhatsApp AI SDK] bootstrap aborted:', e?.message || e);
  }
})();

// ---- debounce 工具：合并频繁的 DOM 变化触发 ----
function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, wait);
  };
}

// ---- 2) 建立 RPC（CONTENT 侧）----
const rpc = createRpc({
  origin: 'CONTENT',
  post: (data) => window.postMessage(data, '*'),
  timeout: 15000,
});
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  rpc.receive(event.data);
});

// ---- 3) 等待 inject 就绪 ----
const injectReady = new Promise((resolve) => {
  rpc.onEvent('INJECT_READY', (data) => resolve(data));
  setTimeout(() => resolve({ wppReady: false }), 20000);
});

// ---- 4) AI 配置 ----
async function getAiConfig() {
  return loadAiConfig();
}

function hasComposerDraft() {
  return !!readComposerText();
}

// ---- 5) AI 按钮注入 ----
let aiButton = null;
let currentChatId = '';
let isGenerating = false;
/** 生成中的请求序号，用于丢弃过期结果（切会话防串台） */
let generateSeq = 0;

function ensureAiButton() {
  if (aiButton) return aiButton;
  aiButton = createAiButton({
    onTrigger: async (mode) => {
      debugLog('[AI] onTrigger called, mode=', mode, 'isGenerating=', isGenerating);
      if (isGenerating) {
        debugLog('[AI] already generating, skip');
        return;
      }
      isGenerating = true;
      aiButton?.setLoading(true);
      debugLog('[AI] isGenerating set to true, calling generateAndFill');
      try {
        await generateAndFill(mode);
      } finally {
        debugLog('[AI] generateAndFill done, resetting isGenerating');
        isGenerating = false;
        aiButton?.setLoading(false);
        // 回填后刷新一次按钮模式（可能仍有内容）
        syncButtonModeFromInput();
      }
    },
  });
  return aiButton;
}

/**
 * 根据输入框内容同步按钮文案：
 * - 有内容 → 帮我优化
 * - 无内容 → 帮我回复
 */
function syncButtonModeFromInput() {
  if (!aiButton) return;
  const mode = hasComposerDraft() ? 'polish' : 'ask';
  aiButton.setMode(mode);
}

function friendlyAiError(error) {
  const msg = String(error?.message || error || '');
  if (!msg) return 'AI 生成失败，请稍后重试';
  if (/apiKey|api key|required/i.test(msg)) return 'AI 配置无效：请检查 API Key';
  if (/baseUrl|Dify baseUrl/i.test(msg)) return 'AI 配置无效：请检查 Dify URL';
  if (/timeout|RPC/i.test(msg)) return '读取聊天数据超时，请稍后重试';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return '网络请求失败，请检查 Dify 服务';
  if (/Dify request failed:\s*(\d+)/i.test(msg)) {
    const code = msg.match(/Dify request failed:\s*(\d+)/i)[1];
    return `Dify 请求失败（${code}）`;
  }
  if (/Unsupported AI provider/i.test(msg)) return '不支持的 AI Provider';
  // 截断过长原始错误
  return msg.length > 120 ? `AI 生成失败：${msg.slice(0, 120)}…` : `AI 生成失败：${msg}`;
}

async function generateAndFill(mode = 'ask') {
  const resolvedMode = mode === 'polish' ? 'polish' : 'ask';
  const seq = ++generateSeq;
  const totalStartedAt = Date.now();
  const timing = {};
  debugLog('[AI] generateAndFill START, mode=', resolvedMode, 'seq=', seq);
  // 常驻到生成结束再关，避免固定 10s 挂太久
  showToast('AI 生成中…', { durationMs: 0 });

  // polish 模式优先用点击瞬间的输入框草稿
  let draft = '';
  if (resolvedMode === 'polish') {
    draft = readComposerText();
    if (!draft) {
      debugLog('[AI] polish mode but draft empty, fallback to ask');
    }
  }

  // 配置 / 会话 / meId 尽量并行
  const tPrep = Date.now();
  const aiConfigPromise = getAiConfig();
  const activeChatPromise = SDK.getActiveChat().catch((e) => {
    console.warn('[AI] getActiveChat failed:', e);
    return null;
  });
  const meIdPromise = SDK.getMeId().catch((e) => {
    console.warn('[AI] getMeId failed:', e);
    return '';
  });

  const [activeChat, meIdFromRpc, aiConfig] = await Promise.all([
    activeChatPromise,
    meIdPromise,
    aiConfigPromise,
  ]);
  timing.prepMs = Date.now() - tPrep;

  debugLog('[AI] activeChat:', activeChat?.snsId || activeChat?.groupId);
  const requestChatId = activeChat?.snsId || activeChat?.groupId || currentChatId || '';
  if (requestChatId && requestChatId !== currentChatId) {
    currentChatId = requestChatId;
  }

  const meId = activeChat?.meId || meIdFromRpc || '';
  debugLog('[AI] meId:', meId || '(unavailable)');
  setDebugEnabled(aiConfig?.debug === true);
  debugLog('[AI] config provider:', aiConfig?.provider);

  // 默认 20 条足够做话术上下文
  // WPP.chat.getMessages 可直接从 store 拉历史，一般不需要 DOM 滚动
  const HISTORY_LIMIT = 20;

  const tMsg = Date.now();
  let messages = [];
  try {
    messages = await SDK.getMessages(HISTORY_LIMIT, { includeMedia: false });
  } catch (e) {
    console.warn('[AI] getMessages failed:', e);
    messages = [];
  }
  timing.getMessagesMs = Date.now() - tMsg;
  debugLog('[AI] messages count:', messages.length, 'ms=', timing.getMessagesMs);

  // 仅当 WPP/内存几乎没消息时，才用 DOM 滚动兜底（极少发生）
  if (messages.length < 3) {
    debugLog('[AI] too few messages, fallback loadMoreHistory via scroll');
    const tHist = Date.now();
    try {
      await SDK.loadMoreHistory(HISTORY_LIMIT);
    } catch (e) {
      console.warn('[AI] loadMoreHistory failed:', e);
    }
    timing.loadMoreMs = Date.now() - tHist;

    if (seq !== generateSeq) {
      debugLog('[AI] aborted after history (seq mismatch)');
      hideToast();
      return;
    }
    if (requestChatId && currentChatId && requestChatId !== currentChatId) {
      debugLog('[AI] aborted after history (chat switched)');
      hideToast();
      return;
    }

    try {
      messages = await SDK.getMessages(HISTORY_LIMIT, { includeMedia: false });
    } catch (e) {
      console.warn('[AI] getMessages(after load) failed:', e);
    }
    debugLog('[AI] messages count(after scroll fallback):', messages.length, 'loadMoreMs=', timing.loadMoreMs);
  } else {
    timing.loadMoreMs = 0;
  }

  if (seq !== generateSeq) { hideToast(); return; }
  if (requestChatId && currentChatId && requestChatId !== currentChatId) { hideToast(); return; }

  const effectiveMode = (resolvedMode === 'polish' && draft) ? 'polish' : 'ask';
  if (effectiveMode === 'polish') {
    debugLog('[AI] draft to polish:', draft.slice(0, 80));
  }

  try {
    debugLog('[AI] calling streamReply...');
    const genStartedAt = Date.now();

    // 默认 blocking：等完整 JSON 一次返回；stream=true 时才尝试边到边填
    let streamedSuggestion = '';
    let filledOnce = false;

    const result = await streamReply({
      chat: activeChat,
      messages,
      config: aiConfig,
      meId,
      mode: effectiveMode,
      draft,
      onChunk: async (_delta, fullText) => {
        if (seq !== generateSeq) return;
        if (requestChatId && currentChatId && requestChatId !== currentChatId) return;

        // 流式阶段 fullText 可能是未完成 JSON；只在「看起来像纯文本话术」时提前回填
        const peek = String(fullText || '').trim();
        if (!peek) return;
        if (peek.startsWith('{') || peek.startsWith('```')) return;
        if (peek.length < 8) return;
        if (peek === streamedSuggestion) return;
        streamedSuggestion = peek;
        try {
          await SDK.fillInput(peek, true);
          filledOnce = true;
        } catch {
          // ignore partial fill errors
        }
      },
    });
    timing.difyMs = Date.now() - genStartedAt;

    if (seq !== generateSeq) {
      debugLog('[AI] aborted after stream (seq mismatch)');
      hideToast();
      return;
    }
    if (requestChatId && currentChatId && requestChatId !== currentChatId) {
      debugLog('[AI] aborted after stream (chat switched)');
      hideToast();
      return;
    }

    // 兼容：如果将来又返回纯字符串，统一成结构体
    const parsed = (result && typeof result === 'object')
      ? result
      : { suggestion: String(result || ''), explanation: '', summary: '', translation: '', raw: String(result || '') };

    const suggestion = (parsed.suggestion || '').trim();
    debugLog('[AI] suggestion:', suggestion.slice(0, 80));
    debugLog('[AI] meta:', {
      summary: (parsed.summary || '').slice(0, 40),
      explanation: (parsed.explanation || '').slice(0, 40),
      translation: (parsed.translation || '').slice(0, 40),
    });

    // 最终回填
    const tFill = Date.now();
    if (suggestion && suggestion !== streamedSuggestion) {
      await SDK.fillInput(suggestion, true);
    } else if (suggestion && !filledOnce) {
      await SDK.fillInput(suggestion, true);
    }
    timing.fillMs = Date.now() - tFill;

    // 有解释信息时，在输入框上方展示简洁浮窗
    if (parsed.summary || parsed.explanation || parsed.translation) {
      const chatId = requestChatId || activeChat?.snsId || activeChat?.groupId || currentChatId || '';
      if (chatId && chatId !== currentChatId) currentChatId = chatId;
      showAiExplainPanel({
        summary: parsed.summary,
        explanation: parsed.explanation,
        translation: parsed.translation,
        mode: effectiveMode,
        chatId,
      });
    } else {
      hideAiExplainPanel();
    }

    timing.totalMs = Date.now() - totalStartedAt;
    debugLog('[AI] timing breakdown ms:', timing);

    hideToast();
    if (!suggestion) {
      showToast('AI 未返回可用话术，请重试');
    }

    debugLog('[AI] fillInput + panel done');
  } catch (error) {
    console.error('[AI] generate reply failed:', error);
    debugLog('[AI] timing breakdown ms (failed):', {
      ...timing,
      totalMs: Date.now() - totalStartedAt,
    });
    hideToast();
    showErrorToast(friendlyAiError(error));
    hideAiExplainPanel();
  }
}

// ---- 6) 工具栏监听：WhatsApp 重建 toolbar 时重新注入按钮 ----
async function tryInjectButton() {
  await injectReady;
  const btn = ensureAiButton();
  if (!btn.isInjected()) {
    btn.inject();
  }
  // 每次尝试注入后同步一次文案（toolbar 重建后文案可能丢失）
  syncButtonModeFromInput();
}

/**
 * 统一 DOM 观察 + 低频轮询
 * 注意：MutationObserver 只做按钮/输入同步，不要每次 DOM 变化都 RPC 查会话，
 * 否则会刷屏 getSnsInfo 日志。
 */
function startUiWatchers() {
  // 按钮/输入同步：DOM 变化后 debounce
  const debouncedUiTick = debounce(() => {
    tryInjectButton();
    syncButtonModeFromInput();
  }, 250);

  // 主轮询：覆盖 observer 漏网（会话检测单独低频）
  setInterval(() => {
    tryInjectButton();
    syncButtonModeFromInput();
  }, 3000);

  // 会话切换低频兜底（主要靠侧边栏点击 + header observer）
  setInterval(() => {
    checkChatSwitch();
  }, 4000);

  // 说明条低频 reanchor
  setInterval(() => {
    try { reanchorAiExplainPanel(currentChatId); } catch (_) {}
  }, 5000);

  // 优先观察 footer / #main；不存在时退到 documentElement
  // 只监听 childList，不听 characterData（打字不该触发注入）
  let observedRoot = null;
  const bindObserver = () => {
    const root =
      document.querySelector('#main footer') ||
      document.querySelector('#main') ||
      document.documentElement;
    if (observedRoot === root) return;
    if (bindObserver._obs) {
      try { bindObserver._obs.disconnect(); } catch (_) {}
    }
    observedRoot = root;
    const observer = new MutationObserver(() => debouncedUiTick());
    observer.observe(root, { childList: true, subtree: true, characterData: false });
    bindObserver._obs = observer;
  };
  bindObserver();
  setInterval(bindObserver, 5000);

  // 输入事件（用户打字）
  const debouncedSync = debounce(() => syncButtonModeFromInput(), 120);
  document.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('#main footer')) return;
    debouncedSync();
  }, true);

  document.addEventListener('keyup', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('#main footer')) return;
    debouncedSync();
  }, true);
}

// ---- 6.3) 发送后关闭说明条（发送按钮 / Enter 的即时路径）----
function isWhatsAppSendButton(el) {
  if (!(el instanceof Element)) return false;
  const btn = el.closest('button, [role="button"]');
  if (!btn || !btn.closest('#main footer')) return false;
  const label = (
    btn.getAttribute('aria-label') ||
    btn.getAttribute('title') ||
    ''
  ).toLowerCase();
  // 中英文发送按钮
  if (label.includes('发送') || label.includes('send')) return true;
  // 常见 data-testid / data-icon
  if (btn.getAttribute('data-testid') === 'send' || btn.querySelector('[data-icon="send"]')) return true;
  return false;
}

function startSendDismissWatcher() {
  document.addEventListener('click', (event) => {
    const t = event.target;
    if (!(t instanceof Element)) return;
    if (isWhatsAppSendButton(t)) {
      hideAiExplainPanel();
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    const t = event.target;
    if (!(t instanceof Element)) return;
    if (!t.closest('#main footer [contenteditable="true"]')) return;
    hideAiExplainPanel();
  }, true);
}

// ---- 7) 会话切换检测（说明条绑定会话，切走即关）----
function resetForChatSwitch() {
  // 切换会话：作废进行中的生成结果 + 关说明条
  generateSeq += 1;
  hideAiExplainPanel();
  syncButtonModeFromInput();
}

/** 防止并发 checkChatSwitch 叠 RPC */
let chatSwitchChecking = false;
let lastChatSwitchAt = 0;

async function checkChatSwitch(force = false) {
  const now = Date.now();
  // 非强制时做节流，避免 header observer + interval 叠打
  if (!force && now - lastChatSwitchAt < 600) return;
  if (chatSwitchChecking) return;
  chatSwitchChecking = true;
  lastChatSwitchAt = now;
  try {
    const chat = await SDK.getActiveChat();
    const newId = chat?.snsId || chat?.groupId || '';
    if (!newId) return;

    if (!currentChatId) {
      currentChatId = newId;
      const panelChatId = getAiExplainPanelChatId();
      if (panelChatId && panelChatId !== currentChatId) hideAiExplainPanel();
      return;
    }

    if (newId !== currentChatId) {
      currentChatId = newId;
      resetForChatSwitch();
      tryInjectButton();
      return;
    }

    const panelChatId = getAiExplainPanelChatId();
    if (panelChatId && panelChatId !== currentChatId) {
      hideAiExplainPanel();
    }
  } catch (e) {
    // ignore
  } finally {
    chatSwitchChecking = false;
  }
}

function startChatSwitchWatcher() {
  // 点击左侧会话列表时立刻检查（强制，跳过节流）
  document.addEventListener('click', (event) => {
    const t = event.target;
    if (!(t instanceof Element)) return;
    if (!t.closest('#pane-side, #side, [data-testid="chat-list"]')) return;
    hideAiExplainPanel();
    setTimeout(() => checkChatSwitch(true), 80);
    setTimeout(() => checkChatSwitch(true), 350);
  }, true);

  // 监听主区域标题变化
  const debouncedHeaderCheck = debounce(() => {
    checkChatSwitch(true);
    tryInjectButton();
  }, 200);

  const bindHeaderObserver = () => {
    const mainHeader = document.querySelector('#main header');
    if (!mainHeader || mainHeader.dataset.xmChatWatch === '1') return;
    mainHeader.dataset.xmChatWatch = '1';
    const observer = new MutationObserver(() => debouncedHeaderCheck());
    observer.observe(mainHeader, { childList: true, subtree: true, characterData: true });
  };

  bindHeaderObserver();
  setInterval(bindHeaderObserver, 4000);
}

// ---- 8) 新消息监听（保留 SDK 事件，但不再自动触发 AI）----
const newMessageCallbacks = [];

function parseIncomingDomMessage(node) {
  const textDom = node.querySelector('.copyable-text .copyable-text') || node.querySelector('.copyable-text');
  const body = textDom ? textDom.innerText : '';
  const isOut = node.classList.contains('message-out') || !!node.querySelector('.message-out');
  return {
    type: 'text',
    body,
    hash: body.length,
    send_type: isOut ? 1 : 2,
    send_time: new Date().toISOString().replace('T', ' ').slice(0, 19),
    message_id: node.dataset?.id || '',
  };
}

async function startMonitor() {
  await injectReady;
  startMessageMonitor(({ node }) => {
    const quickInfo = parseIncomingDomMessage(node);

    // 自己发出消息后，关闭 AI 说明条
    if (quickInfo?.send_type === 1) {
      hideAiExplainPanel();
    }

    newMessageCallbacks.forEach((cb) => {
      try { cb(quickInfo); } catch (e) { console.error('[SDK] onNewMessage callback error:', e); }
    });
    window.postMessage({
      __waai_bridge__: 'wa-sdk:response',
      type: 'event',
      event: 'newMessage',
      value: quickInfo,
    }, '*');
  });
}

startMonitor();
startUiWatchers();
startSendDismissWatcher();
startChatSwitchWatcher();

// ---- 9) page-world 调试桥通信 ----
window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.__waai_bridge__ !== 'wa-sdk:request') return;

  const reply = (payload) => window.postMessage({ __waai_bridge__: 'wa-sdk:response', id: data.id, ...payload }, '*');

  try {
    let value = null;
    switch (data.method) {
      case 'ready':
        value = await SDK.ready();
        break;
      case 'getActiveChat':
        value = await SDK.getActiveChat();
        break;
      case 'getMessages':
        value = await SDK.getMessages(data.args?.limit ?? 20, {
          includeMedia: data.args?.includeMedia === true,
        });
        break;
      case 'getMeId':
        value = await SDK.getMeId();
        break;
      case 'getInputContent':
        value = await SDK.getInputContent();
        break;
      case 'getAudioBlobUrl':
        value = await SDK.getAudioBlobUrl(data.args?.dataId);
        break;
      case 'revokeAudioBlobUrl':
        value = await SDK.revokeAudioBlobUrl(data.args?.url);
        break;
      case 'fillInput':
        value = await SDK.fillInput(data.args?.text || '', !!data.args?.replace);
        break;
      case 'sendReply':
        value = await SDK.sendReply(data.args?.text || '');
        break;
      case 'loadMoreHistory':
        value = await SDK.loadMoreHistory(data.args?.count ?? 50);
        break;
      default:
        throw new Error('Unknown bridge method: ' + data.method);
    }
    reply({ type: 'resolve', value });
  } catch (error) {
    reply({ type: 'reject', error: String(error?.message || error) });
  }
});

// ---- 10) SDK API（isolated world）----
const SDK = {
  async ready() { return injectReady; },
  async getActiveChat() { await injectReady; return rpc.send('GET_SNS_INFO'); },
  /**
   * @param {number} limit
   * @param {{ includeMedia?: boolean }} [options]
   */
  async getMessages(limit = 20, options = {}) {
    await injectReady;
    return rpc.send('GET_MESSAGES', {
      limit,
      includeMedia: options.includeMedia === true,
    });
  },
  async getMeId() { await injectReady; return rpc.send('GET_ME_ID'); },
  async getInputContent() { await injectReady; return rpc.send('GET_INPUT_CONTENT'); },
  async getAudioBlobUrl(dataId) { await injectReady; return rpc.send('GET_AUDIO_BLOB_URL', { dataId }); },
  async revokeAudioBlobUrl(url) { await injectReady; return rpc.send('REVOKE_AUDIO_BLOB_URL', { url }); },
  onNewMessage(callback) {
    newMessageCallbacks.push(callback);
    return () => {
      const idx = newMessageCallbacks.indexOf(callback);
      if (idx >= 0) newMessageCallbacks.splice(idx, 1);
    };
  },
  async fillInput(text, replace = false) { await injectReady; return rpc.send('FILL_INPUT', { text, replace }); },
  async sendReply(text) { await injectReady; return rpc.send('SEND_REPLY', { text }); },
  async loadMoreHistory(count = 50) { await injectReady; return rpc.send('LOAD_MORE_MESSAGES', { count }); },
};

window.WhatsappAI = SDK;
debugLog('[WhatsApp AI SDK] content.js loaded, waiting for inject...');
