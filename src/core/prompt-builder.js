/**
 * core/prompt-builder.js — 把 WhatsApp 消息整理成适合 AI 的上下文
 *
 * 分层：
 * 1) systemPrompt / polishPrompt — 用户可改的人设与业务口吻
 * 2) outputMode — text | structured；序列化契约由代码追加，避免用户改 prompt 时踩碎面板
 */

import { normalizeOutputMode, OUTPUT_MODE_STRUCTURED } from './ai-config.js';

function normalizeRole(item) {
  return item?.send_type === 2 ? 'customer' : 'assistant';
}

function normalizeContent(item) {
  if (!item) return '';
  if (typeof item.body === 'string') return item.body.trim();
  if (item.body && typeof item.body === 'object') {
    const caption = typeof item.body.caption === 'string' ? item.body.caption.trim() : '';
    if (caption) return caption;
    // 无 caption 的媒体：给 AI 一个占位，避免整段上下文丢失
    const type = item.type || 'media';
    if (type === 'image') return '[image]';
    if (type === 'video') return '[video]';
    if (type === 'audio') {
      const duration = item.body.duration ? ` ${item.body.duration}` : '';
      return `[audio${duration}]`;
    }
    if (type === 'sticker') return '[sticker]';
    if (type === 'document') {
      const name = item.body.fileName || 'file';
      return `[document: ${name}]`;
    }
    if (type === 'location') return '[location]';
    if (type === 'contact') return '[contact]';
  }
  return '';
}

/**
 * 只保留适合 AI 的有效消息
 * @param {object} args
 * @param {object} args.chat — 当前会话信息（含 snsId/groupId/isGroup 等）
 * @param {Array}  args.messages — 消息列表
 * @param {number} args.limit — 最多条数
 * @param {string} [args.meId] — 当前登录用户（发送者）手机号
 */
export function buildChatContext({ chat, messages, limit = 50, meId }) {
  const filtered = (messages || [])
    .map((item) => ({
      role: normalizeRole(item),
      content: normalizeContent(item),
      type: item?.type || 'text',
      send_time: item?.send_time || '',
      message_id: item?.message_id || '',
    }))
    .filter((item) => item.content)
    .slice(0, limit)
    .reverse();

  const senderPhone = meId || chat?.meId || '';
  const receiverPhone = chat?.snsId || '';

  return {
    chatId: chat?.snsId || chat?.groupId || '',
    isGroup: !!chat?.isGroup,
    snsNickname: chat?.snsNickname || '',
    sender_phone: senderPhone, // 发送者（当前登录用户）手机号
    receiver_phone: receiverPhone, // 接收者（对方）手机号
    messages: filtered,
  };
}

function buildContextHeader(ctx, { includePhones = true } = {}) {
  return [
    `Chat ID: ${ctx.chatId || 'unknown'}`,
    `Group Chat: ${ctx.isGroup ? 'yes' : 'no'}`,
    ctx.snsNickname ? `Nickname: ${ctx.snsNickname}` : '',
    includePhones && ctx.sender_phone ? `Sender Phone: ${ctx.sender_phone}` : '',
    includePhones && ctx.receiver_phone ? `Receiver Phone: ${ctx.receiver_phone}` : '',
  ].filter(Boolean);
}

/**
 * 输出契约后缀（用户 prompt 之外由代码追加）
 * @param {'ask'|'polish'} mode
 * @param {string} outputMode
 */
export function buildOutputContract({ mode = 'ask', outputMode } = {}) {
  const resolved = normalizeOutputMode(outputMode);
  const isPolish = mode === 'polish';

  if (resolved === OUTPUT_MODE_STRUCTURED) {
    return [
      'Output contract (do not ignore):',
      'Return a single JSON object only. No markdown fences, no extra commentary.',
      'Required keys (Chinese keys preferred; English aliases also accepted by the client):',
      '{',
      '  "话术建议": "the reply or polished text to put into the chat input",',
      '  "解释": "brief reason for the wording",',
      '  "总结": "one-line context summary",',
      '  "原文翻译": "optional translation; empty string if not needed"',
      '}',
      'English aliases: suggestion / reply, explanation / reason, summary, translation.',
      isPolish
        ? '话术建议 must be the polished draft only (same language as the user draft).'
        : '话术建议 must be the outbound reply only (same language as the customer when possible).',
    ].join('\n');
  }

  // text mode
  if (isPolish) {
    return [
      'Output contract (do not ignore):',
      'Return only the polished message text.',
      'Do not add explanations, labels, quotes, markdown, or JSON.',
      'Keep the original language and intent.',
    ].join('\n');
  }

  return [
    'Output contract (do not ignore):',
    'Return only the suggested reply text to send in the chat input.',
    'Do not add explanations, labels, quotes, markdown, or JSON.',
  ].join('\n');
}

/**
 * 生成回复模式的 prompt（输入框为空时使用）
 * @param {object} args
 * @param {object} args.chat
 * @param {Array} args.messages
 * @param {string} [args.systemPrompt]
 * @param {string} [args.meId]
 * @param {string} [args.outputMode]
 */
export function buildPromptText({ chat, messages, systemPrompt, meId, outputMode }) {
  const ctx = buildChatContext({ chat, messages, meId });
  const lines = ctx.messages.map((item) => `${item.role === 'customer' ? 'Customer' : 'Me'}: ${item.content}`);
  return [
    systemPrompt || 'You are a professional sales assistant. Generate a concise, natural reply based on the chat history.',
    '',
    ...buildContextHeader(ctx, { includePhones: true }),
    '',
    'Recent messages:',
    ...lines,
    '',
    buildOutputContract({ mode: 'ask', outputMode }),
  ].filter(Boolean).join('\n');
}

/**
 * 优化措辞模式的 prompt（输入框已有内容时使用）
 * @param {object} args
 * @param {string} args.draft — 用户当前输入框中的草稿
 * @param {object} args.chat
 * @param {Array}  args.messages
 * @param {string} [args.systemPrompt]
 * @param {string} [args.meId]
 * @param {string} [args.outputMode]
 */
export function buildPolishPromptText({ draft, chat, messages, systemPrompt, meId, outputMode }) {
  const ctx = buildChatContext({ chat, messages, meId });
  const lines = ctx.messages.map((item) => `${item.role === 'customer' ? 'Customer' : 'Me'}: ${item.content}`);
  return [
    systemPrompt
      || 'You are a professional writing assistant. Polish the user draft so it is clearer, more natural, and more professional, while keeping the original intent and language.',
    '',
    ...buildContextHeader(ctx, { includePhones: false }),
    '',
    'Recent messages (for tone/context only):',
    ...lines,
    '',
    'User draft to polish:',
    draft || '',
    '',
    buildOutputContract({ mode: 'polish', outputMode }),
  ].filter(Boolean).join('\n');
}
