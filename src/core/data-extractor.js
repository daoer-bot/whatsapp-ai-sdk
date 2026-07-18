/**
 * core/data-extractor.js — WPP API 数据读取层（主路径）
 *
 * 全部基于 `window.WPP.chat/contact/conn/group/util`。
 * 当 WPP 不可用/出错时，调用方应当降级到 react-fallback.js 或 dom-fallback.js。
 */

import { debugLog } from './logger.js';

import { getMsgItem, formatSendTime } from './message-types.js';
import { readComposerText } from './selectors.js';

/**
 * 获取当前活动会话信息（联系人 / 群）
 * @returns {Promise<object|null>} { snsId, snsNickname, snsAvatar, isGroup, groupId, contact?, meId? }
 */
function resolvePhoneFromLidEntry(entry) {
  return (
    entry?.phoneNumber?.user ||
    entry?.phoneNumber?.id ||
    entry?.phoneNumber?._serialized?.replace?.(/@.*/, '') ||
    entry?.pnUser ||
    entry?.user ||
    ''
  );
}

function isGroupChat(activeChat) {
  if (!activeChat) return false;
  if (activeChat.isGroup === true || activeChat.groupMetadata) return true;
  if (activeChat.isUser === true) return false;
  const server = activeChat?.id?.server || '';
  const serialized = activeChat?.id?._serialized || '';
  return server === 'g.us' || serialized.includes('@g.us');
}

function isUserChat(activeChat) {
  if (!activeChat) return false;
  if (activeChat.isUser === true) return true;
  if (isGroupChat(activeChat)) return false;
  const server = activeChat?.id?.server || '';
  const serialized = activeChat?.id?._serialized || '';
  return server === 'c.us' || server === 'lid' || serialized.includes('@c.us') || serialized.includes('@lid');
}

export async function getSnsInfo() {
  try {
    const activeChat = await window.WPP.chat.getActiveChat();
    if (!activeChat) return null;

    // 1-on-1 / LID 会话：不要只依赖 isUser，LID 私聊有时 isUser 为假
    if (isUserChat(activeChat) && !isGroupChat(activeChat)) {
      const snsNickname = activeChat?.formattedTitle || activeChat?.name || '';
      const server = activeChat?.id?.server || '';
      const serialized = activeChat?.id?._serialized || '';
      const isLid = server === 'lid' || serialized.includes('@lid');

      if (!isLid && server === 'c.us') {
        return {
          snsId: activeChat.id?.user,
          snsAvatar: '',
          snsNickname,
          isGroup: false,
          isLid: false,
        };
      }

      // lid 会话需要转成真实手机号
      try {
        const entry = await window.WPP.contact.getPnLidEntry(serialized || activeChat.id?._serialized);
        const snsId = resolvePhoneFromLidEntry(entry) || activeChat.id?.user || '';
        return {
          snsId,
          snsAvatar: '',
          snsNickname,
          isGroup: false,
          isLid: true,
        };
      } catch (e) {
        console.warn('WPP getPnLidEntry failed:', e);
        return {
          snsId: activeChat.id?.user || '',
          snsAvatar: '',
          snsNickname,
          isGroup: false,
          isLid: true,
        };
      }
    }

    // 群聊
    if (!isGroupChat(activeChat)) {
      // 既不是明确用户会话，也不是群：返回最小可用信息，避免误调 group API
      return {
        snsId: activeChat?.id?.user || '',
        snsAvatar: '',
        snsNickname: activeChat?.formattedTitle || activeChat?.name || '',
        isGroup: false,
      };
    }

    const meId = getMeId();
    const groupData = {
      name: activeChat?.formattedTitle || activeChat?.name || '',
      groupId: activeChat?.id?.user,
      isGroup: true,
      contact: [],
      meId,
    };
    const participants = await window.WPP.group.getParticipants(activeChat.id._serialized);
    groupData.contact = (await Promise.all(
      participants.map(async (p) => {
        try {
          const c = await window.WPP.contact.get(p.id._serialized);
          const snsId = c?.phoneNumber?.user || c?.id?.user;
          const snsNickname = c?.pushname !== '0' ? c?.pushname : c?.name || snsId;
          const isMe = window.WPP.whatsapp.functions.getIsMe(c);
          return { snsId, snsNickname: snsNickname || snsId, isAdmin: p.isAdmin, isSuperAdmin: p.isSuperAdmin, isMe };
        } catch (e) {
          console.warn('获取群成员信息失败:', e);
          return null;
        }
      }),
    )).filter(Boolean);
    return groupData;
  } catch (e) {
    console.error('WPP getSnsInfo error:', e);
    return null;
  }
}

/**
 * 获取当前登录用户的 WhatsApp ID（手机号）
 * @returns {string}
 */
export function getMeId() {
  try {
    return window.WPP.conn.getMyUserId()?.user || '';
  } catch (e) {
    debugLog('WPP getMeId error:', e);
    return '';
  }
}

/**
 * 解析消息数组为统一格式
 * @param {Array} rawList
 * @param {{ includeMedia?: boolean }} options
 */
async function parseMsgList(rawList, options) {
  const includeMedia = options?.includeMedia === true;
  const msgList = [];
  for (const wppMsg of rawList || []) {
    try {
      const item = await getMsgItem(wppMsg, { includeMedia });
      if (item) msgList.push(item);
    } catch (e) {
      console.error('WPP getMessages item error:', e);
    }
  }
  return msgList;
}

/**
 * 获取当前会话的消息列表（WPP API，无需 DOM 滚动）
 *
 * 优先：WPP.chat.getMessages(chatId, { count }) — 可从 store/IndexedDB 拉历史
 * 兜底：activeChat.msgs._models — 仅内存里已加载的
 *
 * @param {number} limit — 最多条数（最近 N 条）
 * @param {{ includeMedia?: boolean }} [options]
 *   includeMedia 默认 false：不下载图片/视频（AI 路径用）；需要媒体时显式传 true
 * @returns {Promise<Array>} 最近在前
 */
export async function getMessages(limit = 20, options = {}) {
  const includeMedia = options.includeMedia === true;
  try {
    const activeChat = await window.WPP.chat.getActiveChat();
    if (!activeChat) return [];

    const chatId = activeChat.id?._serialized || activeChat.id;
    const count = limit > 0 ? limit : 20;

    // 1) 官方 API：可主动拉历史，不依赖页面滚动
    if (chatId && typeof window.WPP.chat.getMessages === 'function') {
      try {
        const raw = await window.WPP.chat.getMessages(chatId, { count });
        if (Array.isArray(raw) && raw.length) {
          // WPP 通常返回旧→新；统一成「最近在前」
          const parsed = await parseMsgList(raw, { includeMedia });
          parsed.reverse();
          debugLog('[WPP] getMessages via API:', parsed.length, 'chatId=', chatId);
          return limit > 0 ? parsed.slice(0, limit) : parsed;
        }
      } catch (e) {
        console.warn('[WPP] chat.getMessages API failed, fallback to _models:', e?.message || e);
      }
    }

    // 2) 兜底：内存模型（可能少于 limit，取决于 WA 是否已加载）
    const all = activeChat.msgs?._models || [];
    let msgList = await parseMsgList(all, { includeMedia });
    msgList.reverse(); // 最近在前
    if (limit > 0) msgList = msgList.slice(0, limit);
    debugLog('[WPP] getMessages via _models:', msgList.length);
    return msgList;
  } catch (e) {
    console.error('WPP getMessages error:', e);
    return [];
  }
}

/**
 * 获取单条语音消息的 Blob URL（AI 转写前置）
 * @param {string} dataId — message id
 * @returns {Promise<string|null>}
 */
export async function getAudioBlobUrl(dataId) {
  try {
    const msg = await window.WPP.chat.getMessageById(dataId);
    if (!msg || msg.type !== 'ptt') return null;
    const mediaData = await window.WPP.chat.downloadMedia(msg.id._serialized);
    if (!mediaData) return null;
    const blob = new Blob([mediaData], { type: 'audio/ogg' });
    return URL.createObjectURL(blob);
  } catch (e) {
    console.error('WPP getAudioBlobUrl error:', e);
    return null;
  }
}

/**
 * 释放由 getAudioBlobUrl 创建的对象 URL。
 * @param {string} url
 */
export function revokeAudioBlobUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('blob:')) return false;
  URL.revokeObjectURL(url);
  return true;
}

/**
 * 获取消息发送时间戳
 * @param {string} dataId
 * @returns {Promise<string>} YYYY-MM-DD HH:mm:ss
 */
export async function getSendTimestamp(dataId) {
  try {
    const msg = await window.WPP.chat.getMessageById(dataId);
    if (!msg) return '';
    const ts = msg.t || msg.timestamp;
    if (!ts) return '';
    return formatSendTime(ts);
  } catch (e) {
    console.error('WPP getSendTimestamp error:', e);
    return '';
  }
}

/**
 * 获取当前输入框内容
 * @returns {Promise<string>}
 */
export async function getInputContent() {
  try {
    await window.WPP.chat.getActiveChat(); // 仅用于检查 WPP 可用
  } catch (e) {
    console.error('WPP getInputContent error:', e);
  }
  return readComposerText();
}
