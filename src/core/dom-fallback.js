/**
 * core/dom-fallback.js — 纯 CSS 选择器 V1 兜底（第三路径）
 *
 * DOM 降级实现：当 WPP API 与 React 数据不可用时读取可见消息。
 * 当 WPP 和 React fiber 都不可用时，直接用querySelectorAll 扫描 DOM 里的
 * 消息气泡节点，从 HTML 里解析文本/时间/方向。
 *
 * 能力有限：只能得到文本、时间、方向，无法拿到媒体 Blob / 群成员 / lid 转换。
 */

/**
 * 解析日期
 */
function parseDate(dateStr, timeStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr} ${timeStr || ''}`);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * 从消息 DOM 节点解析时间
 * @param {HTMLElement} itemDom
 * @returns {string}
 */
function getMessageTime(itemDom) {
  const textTimeItem = itemDom.querySelector('.copyable-text');
  if (textTimeItem && textTimeItem.dataset.prePlainText) {
    const infoArr = textTimeItem.dataset.prePlainText.match(/(?<=\[).+?(?=\])/g);
    if (infoArr) {
      const [time, date] = infoArr[0].split(', ');
      return parseDate(date, time);
    }
  }
  const timeText = [...itemDom.querySelectorAll('div > span[dir]')].reverse().reduce((date, item) => {
    if (!date) {
      const text = item.innerText;
      if (/\d+\s*:\s*\d+/.test(text)) date = text;
    }
    return date;
  }, '');
  return parseDate(getDate(itemDom), timeText);
}

function getDate(itemDom) {
  // 尝试从前一个 date divider 芘
  let prev = itemDom.previousElementSibling;
  while (prev) {
    const t = prev.querySelector('[data-testid="conversation-info-panel-date-divider"]')?.innerText;
    if (t) return t;
    prev = prev.previousElementSibling;
  }
  return new Date().toISOString().slice(0, 10);
}

/**
 * 从 DOM V1 扫描当前会话的消息列表
 * @param {boolean} isGroup
 * @returns {Promise<Array>}
 */
export async function getMessagesByDom(isGroup = false) {
  const allContactList = [...document.querySelectorAll('#main [data-id]')].filter(
    (item) =>
      !item.dataset.id.includes('grouped-sticker-') &&
      (item.classList.contains('message-out') ||
        item.classList.contains('message-in') ||
        item.querySelector('.message-out') ||
        item.querySelector('.message-in')),
  );

  const messages = [];
  for (const item of allContactList) {
    try {
      const idArr = item.dataset.id.split('@c.us_');
      let message_id = idArr.length > 1 ? idArr[1] : item.dataset.id;
      let send_id = '';
      if (isGroup) {
        send_id = message_id?.split('_')?.[3]?.replace?.('@c.us', '') || '';
        message_id = item.dataset.id?.split('_')?.[2] || '';
      }
      if (message_id.indexOf('-true_') !== -1) {
        message_id = message_id.split('-true_')[1] || message_id;
      }

      const textDom = item.querySelector('div.copyable-text .copyable-text');
      const body = textDom ? textDom.innerText : '';
      const isOut = item.classList.contains('message-out') || !!item.querySelector('.message-out');
      const send_type = isOut ? 1 : 2;
      const send_time = getMessageTime(item);

      messages.push({
        type: 'text',
        body,
        hash: body.length,
        message_id,
        send_id,
        send_type,
        send_time,
      });
    } catch (e) {
      console.error('[DOM V1] parse msg error:', e);
    }
  }
  return messages.reverse();
}

/**
 * 从 DOM 获取当前会话联系人信息（V1 简版）
 * @returns {object|null}
 */
export function getSnsInfoByDom() {
  const snsItem = document.querySelector('div[aria-selected="true"]');
  const snsNickname = snsItem?.querySelector('span[title]')?.innerText || '';
  const isGroup = !!document.querySelector('#main [data-id*="@g.us"]');

  // 尝试从会话列表项的 data-id 属性提取真实手机号 / LID
  // data-id 格式如 "8619068473626@c.us" 或 "29769123000403@lid"
  const dataId = snsItem?.dataset?.id || '';
  let snsId = '';
  if (dataId) {
    // 非 LID 会话直接取 @ 前的部分（即手机号）
    if (!dataId.includes('@lid')) {
      snsId = dataId.split('@')[0] || '';
    }
    // LID 会话无法从 DOM 解析真实手机号，保持空，由上层降级处理
  }

  // 兜底：从 header 取（可能是昵称，不一定可靠）
  if (!snsId) {
    const header = document.querySelector('#main header');
    snsId = header?.querySelector('span[title]')?.innerText || '';
  }

  return { snsId, snsNickname, snsAvatar: '', isGroup };
}