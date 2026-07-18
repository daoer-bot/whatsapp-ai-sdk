/**
 * core/message-types.js — WhatsApp 消息类型解析
 *
 * 输入是 WPP 的原始 message 对象（wppMessage），输出统一格式：
 *
 *   { type, body, hash, send_type, send_time, message_id, send_id }
 *
 *   type:       'text' | 'location' | 'audio' | 'image' | 'video' | 'sticker' | 'document' | 'contact' | 'unsupported'
 *   body:       string | object
 *   hash:       string | number (用于去重)
 *   send_type:  1 (出) | 2 (入)
 *   send_time:  string ('YYYY-MM-DD HH:mm:ss')
 *   message_id: string
 *   send_id:    string (发送者手机号或群成员 id)
 */

/**
 * 统一时间戳为 'YYYY-MM-DD HH:mm:ss'
 * @param {number|string|Date|undefined|null} raw
 * @returns {string}
 */
export function formatSendTime(raw) {
  if (raw == null || raw === '') return '';

  let date = null;
  if (raw instanceof Date) {
    date = raw;
  } else if (typeof raw === 'number') {
    // 秒级 / 毫秒级
    const ms = raw < 1e12 ? raw * 1000 : raw;
    date = new Date(ms);
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    // 已经是目标格式
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed;
    // 纯数字字符串
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      const ms = n < 1e12 ? n * 1000 : n;
      date = new Date(ms);
    } else {
      date = new Date(trimmed);
    }
  }

  if (!date || isNaN(date.getTime())) return '';
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

// ---- 输出辅助 ----
function formatSeconds(duration) {
  const s = Math.floor(duration % 60);
  const m = Math.floor(duration / 60 % 60);
  const h = Math.floor(duration / 3600);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fileSize(bytes, dp = 0) {
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(dp)) + ' ' + ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'][i];
}

/**
 * 是否应下载媒体
 * AI 路径默认关闭，避免点一次按钮就拉 50 张图/视频
 * @param {{ includeMedia?: boolean }} options
 */
function shouldDownloadMedia(options) {
  return options?.includeMedia === true;
}

// ---- 各类型解析器（第二参 options）----
const messageTypes = {
  chat: async (msg) => {
    const body = msg.body || '';
    return { type: 'text', body, hash: body.length };
  },

  location: async (msg) => ({
    type: 'location',
    body: msg.body,
  }),

  ptt: async (msg) => {
    const duration = msg.duration || 0;
    return { type: 'audio', body: { duration: formatSeconds(duration) }, hash: duration };
  },
  audio: async (msg) => {
    const duration = msg.duration || 0;
    return { type: 'audio', body: { duration: formatSeconds(duration) }, hash: duration };
  },

  image: async (msg, options) => {
    let link = '';
    if (shouldDownloadMedia(options)) {
      try {
        link = await window.WPP.chat.downloadMedia(msg.id._serialized).then(window.WPP.util.blobToBase64);
      } catch (e) {
        console.error('WPP downloadMedia image error:', e);
      }
    }
    return {
      type: 'image',
      body: {
        link,
        width: 125,
        caption: msg.caption || '',
        hasMedia: true,
      },
      hash: link?.length || msg.caption?.length || msg.id?.id || '',
    };
  },

  video: async (msg, options) => {
    if (!shouldDownloadMedia(options)) {
      return {
        type: 'video',
        body: { link: '', caption: msg.caption || '', hasMedia: true },
        hash: msg.caption?.length || msg.id?.id || '',
      };
    }
    try {
      const cover = msg.mediaObject?.contentInfo?.preview?._url;
      if (cover) {
        return {
          type: 'image',
          body: { link: cover, caption: msg.caption || '', extra: 'videoCover', hasMedia: true },
          hash: cover.length || '',
        };
      }
    } catch (e) {
      console.error('Video cover fetched failed:', e);
    }
    let link = '';
    try {
      link = await window.WPP.chat.downloadMedia(msg.id._serialized).then(window.WPP.util.blobToBase64);
    } catch (e) {
      console.error('WPP downloadMedia video error:', e);
    }
    return { type: 'video', body: { link, caption: msg.caption || '', hasMedia: true }, hash: link?.length || '' };
  },

  sticker: async (msg, options) => {
    let link = '';
    let type = 'sticker';
    if (shouldDownloadMedia(options)) {
      try {
        link = await window.WPP.chat.downloadMedia(msg.id._serialized).then(window.WPP.util.blobToBase64);
        if (msg.isAnimated) type = 'video';
      } catch (e) {
        console.error('WPP downloadMedia sticker error:', e);
      }
    } else if (msg.isAnimated) {
      type = 'video';
    }
    return { type, body: { link, hasMedia: true }, hash: link?.length || msg.id?.id || '' };
  },

  document: async (msg) => {
    const size = fileSize(msg.size);
    return {
      type: 'document',
      body: { fileName: msg.filename, fileSize: size, caption: msg.caption || '' },
      hash: `${msg.filename}-${size}`,
    };
  },

  vcard: async (msg) => ({
    type: 'contact',
    body: { caption: msg.body || '' },
    hash: msg.body?.length || '',
  }),

  revoked: async (msg) => ({
    type: 'unsupported',
    body: { caption: `revoked__${msg.id?._serialized}__${msg.body || ''}` },
    hash: (msg.body || '').length,
  }),

  poll_creation: async (msg) => ({
    type: 'unsupported',
    body: { caption: `poll_creation__${msg.id?._serialized}__${msg.pollName}` },
  }),

  default: async (msg) => ({
    type: 'unsupported',
    body: { caption: `${msg.type}__unsupported_${msg.id?._serialized}` },
  }),
};

/**
 * 解析单条 WPP message 为统一格式
 * @param {object} wppMessage — WPP 返回的原始消息对象
 * @param {{ includeMedia?: boolean }} [options]
 *   includeMedia: true 时下载图片/视频/贴纸（默认 false，AI 路径不需要）
 * @returns {Promise<object|null>}
 */
export async function getMsgItem(wppMessage, options = {}) {
  if (!wppMessage) return null;
  const handler = messageTypes[wppMessage.type] || messageTypes.default;
  if (!handler) return null;
  const parsed = await handler(wppMessage, options);
  const rawTime = wppMessage?.t || wppMessage?.timestamp || wppMessage?.id?.timestamp;
  return {
    ...parsed,
    message_id: wppMessage?.id?.id || '',
    send_id:
      wppMessage?.senderObj?.phoneNumber?.user ||
      wppMessage?.senderObj?.id?.user ||
      wppMessage?.from?.user ||
      wppMessage?.author?.user ||
      '',
    send_type: wppMessage?.id?.fromMe ? 1 : 2, // 1=出 2=入
    send_time: formatSendTime(rawTime),
  };
}

export { messageTypes };
