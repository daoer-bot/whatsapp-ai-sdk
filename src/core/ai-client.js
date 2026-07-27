/**
 * core/ai-client.js — 极简 AI 客户端
 *
 * 支持 provider：
 * - mock：本地拼一个演示回复
 * - dify：调用 Dify Chat Messages API
 * - openai：调用 OpenAI 兼容 Chat Completions API（含多数中转/网关）
 *
 * 支持 mode：
 * - ask：根据聊天历史生成回复
 * - polish：优化用户已输入的草稿措辞
 *
 * 模型返回可为纯文本，或结构化 JSON：
 * {
 *   "话术建议": "...",
 *   "解释": "...",
 *   "总结": "...",
 *   "原文翻译": "..."
 * }
 */

import { buildChatContext, buildPromptText, buildPolishPromptText } from './prompt-builder.js';
import { debugLog } from './logger.js';

/** openai provider 未配置 model 时的默认值 */
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

function lastCustomerMessage(messages = []) {
  const reversed = [...messages].reverse();
  const item = reversed.find((msg) => msg?.send_type === 2 && (typeof msg?.body === 'string' || msg?.body?.caption));
  if (!item) return '';
  return typeof item.body === 'string' ? item.body : (item.body?.caption || '');
}

/**
 * 统一结构化结果
 * @returns {{ suggestion: string, explanation: string, summary: string, translation: string, raw: string }}
 */
function makeResult({ suggestion = '', explanation = '', summary = '', translation = '', raw = '' } = {}) {
  return {
    suggestion: String(suggestion || '').trim(),
    explanation: String(explanation || '').trim(),
    summary: String(summary || '').trim(),
    translation: String(translation || '').trim(),
    raw: String(raw || '').trim(),
  };
}

function buildMockReply({ chat, messages }) {
  const latest = lastCustomerMessage(messages).trim();
  const suggestion = !latest
    ? 'Thanks for your message. I will review it and get back to you shortly.'
    : ('Thanks for your message. Regarding "' + latest.slice(0, 80) + (latest.length > 80 ? '...' : '') + '", I will check the details and reply to you shortly.');

  return makeResult({
    suggestion,
    summary: '基于最近客户消息生成跟进回复。',
    explanation: '保持礼貌、简洁，先确认收到并给出下一步动作。',
    translation: '感谢您的消息。关于您提到的内容，我会尽快核实并回复。',
    raw: suggestion,
  });
}

function buildMockPolish({ draft }) {
  const text = (draft || '').trim();
  const suggestion = !text
    ? 'Thanks for your message. I will get back to you shortly.'
    : text
      .replace(/\s+/g, ' ')
      .replace(/^(.)/, (m) => m.toUpperCase())
      .replace(/([^.!?])$/, '$1.');

  return makeResult({
    suggestion,
    summary: '对你当前草稿做了措辞润色。',
    explanation: '保留原意，让表达更清晰、更专业。',
    translation: '',
    raw: suggestion,
  });
}

/**
 * 从 HTTPS 页面发起 HTTP 请求会被 Chrome 拦截（Mixed Content），统一升级为 HTTPS。
 * @param {string} baseUrl
 * @returns {string}
 */
export function upgradeToHttps(baseUrl) {
  return String(baseUrl || '').trim().replace(/^http:\/\//i, 'https://');
}

/**
 * 规范化 Dify Chat Messages 接口地址。
 * 已带 /chat-messages 的保持不变；否则自动补全。
 * @param {string} baseUrl
 * @returns {string}
 */
export function resolveDifyBaseUrl(baseUrl) {
  let value = upgradeToHttps(baseUrl);
  if (!value) {
    throw new Error('Dify baseUrl is required');
  }
  if (/\/chat-messages\/?$/i.test(value)) {
    return value.replace(/\/+$/, '');
  }
  return value.replace(/\/+$/, '') + '/chat-messages';
}

/**
 * 规范化 OpenAI 兼容 Chat Completions 接口地址。
 * 已带 /chat/completions 的保持不变；否则自动补全。
 * 支持填到 /v1 或完整路径。
 * @param {string} baseUrl
 * @returns {string}
 */
export function resolveOpenAIBaseUrl(baseUrl) {
  let value = upgradeToHttps(baseUrl);
  if (!value) {
    throw new Error('OpenAI baseUrl is required');
  }
  if (/\/chat\/completions\/?$/i.test(value)) {
    return value.replace(/\/+$/, '');
  }
  return value.replace(/\/+$/, '') + '/chat/completions';
}

function extractDifyText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return payload.answer
    || payload.data?.answer
    || payload.output?.text
    || payload.output
    || payload.delta
    || payload.text
    || '';
}

/**
 * 从任意文本中尽量提取 JSON 对象
 */
function tryParseJsonObject(text) {
  if (!text || typeof text !== 'string') return null;
  const raw = text.trim();
  if (!raw) return null;

  // 1) 直接 parse
  try {
    const direct = JSON.parse(raw);
    if (direct && typeof direct === 'object') return direct;
  } catch (_) {
    // continue
  }

  // 2) ```json ... ``` 代码块
  const fenceRe = new RegExp('```(?:json)?\\s*([\\s\\S]*?)```', 'i');
  const fence = raw.match(fenceRe);
  if (fence && fence[1]) {
    try {
      const fenced = JSON.parse(fence[1].trim());
      if (fenced && typeof fenced === 'object') return fenced;
    } catch (_) {
      // continue
    }
  }

  // 3) 截取第一个 { ... } 段
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const slice = raw.slice(start, end + 1);
    try {
      const nested = JSON.parse(slice);
      if (nested && typeof nested === 'object') return nested;
    } catch (_) {
      // continue
    }
  }

  return null;
}

function pickField(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return '';
}

/**
 * 解析 Dify 返回（可能是纯文本，也可能是 JSON 字段）
 * @param {string|object} answer
 */
export function parseAiAnswer(answer) {
  if (answer && typeof answer === 'object' && !Array.isArray(answer)) {
    const suggestion = pickField(answer, ['话术建议', 'suggestion', 'reply', 'text', 'answer']);
    const explanation = pickField(answer, ['解释', 'explanation', 'reason', 'why']);
    const summary = pickField(answer, ['总结', 'summary', 'overview']);
    const translation = pickField(answer, ['原文翻译', '翻译', 'translation', 'translate']);
    return makeResult({
      suggestion: suggestion || '',
      explanation,
      summary,
      translation,
      raw: suggestion || JSON.stringify(answer),
    });
  }

  const text = String(answer || '').trim();
  if (!text) return makeResult();

  const obj = tryParseJsonObject(text);
  if (!obj) {
    // 纯文本：整段当话术建议
    return makeResult({ suggestion: text, raw: text });
  }

  const suggestion = pickField(obj, ['话术建议', 'suggestion', 'reply', 'text', 'answer']);
  const explanation = pickField(obj, ['解释', 'explanation', 'reason', 'why']);
  const summary = pickField(obj, ['总结', 'summary', 'overview']);
  const translation = pickField(obj, ['原文翻译', '翻译', 'translation', 'translate']);

  return makeResult({
    suggestion: suggestion || text,
    explanation,
    summary,
    translation,
    raw: text,
  });
}

function buildRequestPrompt({ chat, messages, config, meId, mode, draft }) {
  if (mode === 'polish') {
    return buildPolishPromptText({
      draft,
      chat,
      messages,
      systemPrompt: config?.polishPrompt || config?.prompt,
      meId,
    });
  }
  return buildPromptText({
    chat,
    messages,
    systemPrompt: config?.prompt,
    meId,
  });
}

/**
 * 带超时的 fetch；超时后 abort，避免按钮一直转圈
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} timeoutMs
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 60000, label = 'AI') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${label} request timeout after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function createDifyResponse({ chat, messages, config, responseMode, meId, mode, draft, timeoutMs }) {
  const prompt = buildRequestPrompt({ chat, messages, config, meId, mode, draft });

  const baseUrl = resolveDifyBaseUrl(config?.baseUrl || '');
  const apiKey = (config?.apiKey || '').trim();

  if (!apiKey) {
    throw new Error('Dify apiKey is required');
  }

  const context = buildChatContext({ chat, messages, meId });
  const senderPhone = context.sender_phone;
  const receiverPhone = context.receiver_phone;
  // blocking 默认 90s；streaming 读流可能更久，给 120s
  const timeout = timeoutMs
    || (responseMode === 'streaming' ? 120000 : 90000);

  debugLog('[AI] Dify request start:', {
    baseUrl,
    responseMode,
    mode: mode || 'ask',
    timeoutMs: timeout,
    messageCount: context.messages?.length || 0,
    promptChars: prompt.length,
  });
  const startedAt = Date.now();

  const response = await fetchWithTimeout(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      query: prompt,
      inputs: {
        chat: context,
        sender_phone: senderPhone,
        receiver_phone: receiverPhone,
        mode: mode || 'ask',
        draft: draft || '',
      },
      response_mode: responseMode,
      user: senderPhone || chat?.snsId || chat?.groupId || 'whatsapp-user',
    }),
  }, timeout, 'Dify');

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 200);
    } catch {
      // ignore
    }
    throw new Error(
      'Dify request failed: ' + response.status + (detail ? ` ${detail}` : ''),
    );
  }

  debugLog('[AI] Dify response headers ok in', Date.now() - startedAt, 'ms');
  return response;
}

function parseSseEventBlock(block) {
  const lines = block.split(/\r?\n/);
  let event = '';
  const dataLines = [];

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  const data = dataLines.join('\n');
  return { event, data };
}

function extractStreamDelta(payload, fallbackEvent = '') {
  if (!payload || typeof payload !== 'object') return '';

  if (fallbackEvent === 'message_end' || payload.event === 'message_end') {
    return '';
  }

  return payload.answer
    || payload.data?.answer
    || payload.output?.text
    || payload.output
    || payload.delta
    || payload.text
    || payload.message
    || '';
}

async function requestDify({ chat, messages, config, meId, mode, draft }) {
  const startedAt = Date.now();
  const response = await createDifyResponse({
    chat,
    messages,
    config,
    responseMode: 'blocking',
    meId,
    mode,
    draft,
  });

  const data = await response.json();
  const text = extractDifyText(data);
  debugLog('[AI] Dify blocking done in', Date.now() - startedAt, 'ms, answerChars=', String(text || '').length);
  return parseAiAnswer(text);
}

async function requestDifyStream({ chat, messages, config, onChunk, meId, mode, draft }) {
  const startedAt = Date.now();
  const response = await createDifyResponse({
    chat,
    messages,
    config,
    responseMode: 'streaming',
    meId,
    mode,
    draft,
  });

  if (!response.body) {
    const data = await response.json();
    const text = extractDifyText(data);
    const parsed = parseAiAnswer(text);
    if (parsed.suggestion) onChunk?.(parsed.suggestion, parsed.suggestion);
    return parsed;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullText = '';
  let chunkCount = 0;

  const flushBlock = (block) => {
    const { event, data } = parseSseEventBlock(block);
    if (!data || data === '[DONE]') return;

    let payload = null;
    try {
      payload = JSON.parse(data);
    } catch (error) {
      const rawText = data.trim();
      if (!rawText) return;
      fullText += rawText;
      chunkCount += 1;
      onChunk?.(rawText, fullText);
      return;
    }

    const delta = extractStreamDelta(payload, event);
    if (!delta) return;
    fullText += delta;
    chunkCount += 1;
    onChunk?.(delta, fullText);
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex >= 0) {
      const block = buffer.slice(0, separatorIndex).trim();
      buffer = buffer.slice(separatorIndex + 2);
      if (block) flushBlock(block);
      separatorIndex = buffer.indexOf('\n\n');
    }

    if (done) {
      const tail = buffer.trim();
      if (tail) flushBlock(tail);
      break;
    }
  }

  debugLog(
    '[AI] Dify stream done in',
    Date.now() - startedAt,
    'ms, chunks=',
    chunkCount,
    'answerChars=',
    fullText.length,
  );
  return parseAiAnswer(fullText);
}

function extractOpenAIText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const choice = payload.choices?.[0];
  if (!choice) {
    return payload.answer
      || payload.output?.text
      || payload.output
      || payload.text
      || '';
  }

  const messageContent = choice.message?.content;
  if (typeof messageContent === 'string') return messageContent;
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('');
  }

  if (typeof choice.text === 'string') return choice.text;
  if (typeof choice.delta?.content === 'string') return choice.delta.content;
  return '';
}

function extractOpenAIStreamDelta(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const choice = payload.choices?.[0];
  if (!choice) return '';

  const delta = choice.delta?.content;
  if (typeof delta === 'string') return delta;

  const messageContent = choice.message?.content;
  if (typeof messageContent === 'string') return messageContent;
  if (typeof choice.text === 'string') return choice.text;
  return '';
}

async function createOpenAIResponse({ chat, messages, config, stream, meId, mode, draft, timeoutMs }) {
  const prompt = buildRequestPrompt({ chat, messages, config, meId, mode, draft });
  const baseUrl = resolveOpenAIBaseUrl(config?.baseUrl || '');
  const apiKey = (config?.apiKey || '').trim();
  const model = String(config?.model || '').trim() || DEFAULT_OPENAI_MODEL;

  if (!apiKey) {
    throw new Error('OpenAI apiKey is required');
  }

  const timeout = timeoutMs || (stream ? 120000 : 90000);

  // 与 Dify 保持一致：prompt-builder 已把 system + 上下文拼成完整任务文本。
  // 这里只发一条 user message，避免 system 被塞两遍；也兼容只认 messages[] 的中转网关。
  const chatMessages = [{ role: 'user', content: prompt }];

  debugLog('[AI] OpenAI request start:', {
    baseUrl,
    model,
    stream: !!stream,
    mode: mode || 'ask',
    timeoutMs: timeout,
    promptChars: prompt.length,
  });

  const response = await fetchWithTimeout(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model,
      messages: chatMessages,
      temperature: 0.7,
      stream: !!stream,
    }),
  }, timeout, 'OpenAI');

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 200);
    } catch {
      // ignore
    }
    throw new Error(
      'OpenAI request failed: ' + response.status + (detail ? ` ${detail}` : ''),
    );
  }

  return response;
}

async function requestOpenAI({ chat, messages, config, meId, mode, draft }) {
  const startedAt = Date.now();
  const response = await createOpenAIResponse({
    chat,
    messages,
    config,
    stream: false,
    meId,
    mode,
    draft,
  });

  const data = await response.json();
  const text = extractOpenAIText(data);
  debugLog('[AI] OpenAI blocking done in', Date.now() - startedAt, 'ms, answerChars=', String(text || '').length);
  return parseAiAnswer(text);
}

async function requestOpenAIStream({ chat, messages, config, onChunk, meId, mode, draft }) {
  const startedAt = Date.now();
  const response = await createOpenAIResponse({
    chat,
    messages,
    config,
    stream: true,
    meId,
    mode,
    draft,
  });

  // 某些网关忽略 stream=true，仍返回普通 JSON
  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
  if (!response.body || contentType.includes('application/json')) {
    const data = await response.json();
    const text = extractOpenAIText(data);
    const parsed = parseAiAnswer(text);
    if (parsed.suggestion) onChunk?.(parsed.suggestion, parsed.suggestion);
    return parsed;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullText = '';
  let chunkCount = 0;

  const flushBlock = (block) => {
    const lines = block.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      let payload = null;
      try {
        payload = JSON.parse(data);
      } catch {
        fullText += data;
        chunkCount += 1;
        onChunk?.(data, fullText);
        continue;
      }

      const delta = extractOpenAIStreamDelta(payload);
      if (!delta) continue;
      fullText += delta;
      chunkCount += 1;
      onChunk?.(delta, fullText);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex >= 0) {
      const block = buffer.slice(0, separatorIndex).trim();
      buffer = buffer.slice(separatorIndex + 2);
      if (block) flushBlock(block);
      separatorIndex = buffer.indexOf('\n\n');
    }

    if (done) {
      const tail = buffer.trim();
      if (tail) flushBlock(tail);
      break;
    }
  }

  debugLog(
    '[AI] OpenAI stream done in',
    Date.now() - startedAt,
    'ms, chunks=',
    chunkCount,
    'answerChars=',
    fullText.length,
  );
  return parseAiAnswer(fullText);
}

/**
 * @param {object} args
 * @param {object} args.chat
 * @param {Array}  args.messages
 * @param {object} [args.config]
 * @param {string} [args.meId]
 * @param {'ask'|'polish'} [args.mode]
 * @param {string} [args.draft]
 * @returns {Promise<{ suggestion: string, explanation: string, summary: string, translation: string, raw: string }>}
 */
export async function generateReply({ chat, messages, config = {}, meId, mode = 'ask', draft = '' }) {
  const provider = config.provider || 'mock';
  const resolvedMode = mode === 'polish' ? 'polish' : 'ask';

  if (provider === 'mock') {
    if (resolvedMode === 'polish') {
      return buildMockPolish({ draft });
    }
    return buildMockReply({ chat, messages });
  }

  if (provider === 'dify') {
    return requestDify({ chat, messages, config, meId, mode: resolvedMode, draft });
  }

  if (provider === 'openai') {
    return requestOpenAI({ chat, messages, config, meId, mode: resolvedMode, draft });
  }

  throw new Error('Unsupported AI provider: ' + provider);
}

/**
 * 默认走 blocking：结构化 JSON 通常要等整段结束才能解析；
 * 用户体感更像“干等”。仅当 config.stream === true 时使用 SSE 流式。
 */
export async function streamReply({ chat, messages, config = {}, onChunk, meId, mode = 'ask', draft = '' }) {
  const provider = config.provider || 'mock';
  const resolvedMode = mode === 'polish' ? 'polish' : 'ask';

  if (provider === 'mock') {
    const result = resolvedMode === 'polish'
      ? buildMockPolish({ draft })
      : buildMockReply({ chat, messages });
    if (result.suggestion) onChunk?.(result.suggestion, result.suggestion);
    return result;
  }

  if (provider === 'dify') {
    if (config.stream === true) {
      return requestDifyStream({ chat, messages, config, onChunk, meId, mode: resolvedMode, draft });
    }
    const result = await requestDify({ chat, messages, config, meId, mode: resolvedMode, draft });
    if (result?.suggestion) onChunk?.(result.suggestion, result.suggestion);
    return result;
  }

  if (provider === 'openai') {
    if (config.stream === true) {
      return requestOpenAIStream({ chat, messages, config, onChunk, meId, mode: resolvedMode, draft });
    }
    const result = await requestOpenAI({ chat, messages, config, meId, mode: resolvedMode, draft });
    if (result?.suggestion) onChunk?.(result.suggestion, result.suggestion);
    return result;
  }

  throw new Error('Unsupported AI provider: ' + provider);
}
