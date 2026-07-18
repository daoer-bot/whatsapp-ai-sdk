/**
 * core/prompt-builder.js — 把 WhatsApp 消息整理成适合 AI 的上下文
 */

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

/**
 * 生成回复模式的 prompt（输入框为空时使用）
 */
export function buildPromptText({ chat, messages, systemPrompt, meId }) {
  const ctx = buildChatContext({ chat, messages, meId });
  const lines = ctx.messages.map((item) => `${item.role === 'customer' ? 'Customer' : 'Me'}: ${item.content}`);
  return [
    systemPrompt || 'You are a professional sales assistant. Generate a concise, natural reply based on the chat history.',
    '',
    `Chat ID: ${ctx.chatId || 'unknown'}`,
    `Group Chat: ${ctx.isGroup ? 'yes' : 'no'}`,
    ctx.snsNickname ? `Nickname: ${ctx.snsNickname}` : '',
    ctx.sender_phone ? `Sender Phone: ${ctx.sender_phone}` : '',
    ctx.receiver_phone ? `Receiver Phone: ${ctx.receiver_phone}` : '',
    '',
    'Recent messages:',
    ...lines,
    '',
    'Return only the suggested reply text.',
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
 */
export function buildPolishPromptText({ draft, chat, messages, systemPrompt, meId }) {
  const ctx = buildChatContext({ chat, messages, meId });
  const lines = ctx.messages.map((item) => `${item.role === 'customer' ? 'Customer' : 'Me'}: ${item.content}`);
  return [
    systemPrompt
      || 'You are a professional writing assistant. Polish the user draft so it is clearer, more natural, and more professional, while keeping the original intent and language.',
    '',
    `Chat ID: ${ctx.chatId || 'unknown'}`,
    `Group Chat: ${ctx.isGroup ? 'yes' : 'no'}`,
    ctx.snsNickname ? `Nickname: ${ctx.snsNickname}` : '',
    '',
    'Recent messages (for tone/context only):',
    ...lines,
    '',
    'User draft to polish:',
    draft || '',
    '',
    'Return only the polished text. Do not add explanations, quotes, or extra notes.',
  ].filter(Boolean).join('\n');
}
