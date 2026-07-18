/**
 * core/react-fallback.js — React __reactProps$ 兜底（第二路径）
 *
 * React fiber 降级实现：当 WPP API 不可用时读取页面内部数据。
 * 当 WPP 不可用时，通过读取 DOM 节点上的 React fiber 内部属性（键名以 `__reactProps$`
 * 开头）来获取 WhatsApp Web 的内部 store 对象，拿到 chat.msgs._models 和
 * chat.groupMetadata.participants 等。
 *
 * 这绕过了 CSP 限制，但前提是 inject 脚本运行在 page 上下文（与 WhatsApp Web 同源）。
 */

/**
 * 在 DOM 节点上查找键名以 __reactProps$ 开头的属性，返回其值数组
 * @param {HTMLElement} obj
 * @returns {any[]}
 */
export function getReactPropsValues(obj) {
  const propValues = [];
  for (const prop in obj) {
    if (prop.startsWith('__reactProps$')) propValues.push(obj[prop]);
  }
  return propValues;
}

/**
 * 在 DOM 节点上查找键名包含 reactEventHandlers / reactProps 的属性
 * @param {HTMLElement} dom
 * @returns {object|null}
 */
export function getReactEventHandler(dom) {
  if (!dom) return null;
  const key = Object.keys(dom).find(
    (k) => k.includes('reactEventHandlers') || k.includes('reactProps'),
  );
  return key ? dom[key] : null;
}

/**
 * 递归从 children 树中提取 msg / msgs props
 * @param {Array} childrenList
 * @returns {Array}
 */
function getMsgPropsList(childrenList) {
  return childrenList.reduce((list, item) => {
    const { msg, msgs, children } = item?.props || {};
    if (children && children.length) {
      list.push(...getMsgPropsList(children));
    } else if (Array.isArray(item)) {
      list.push(...getMsgPropsList(item));
    } else if (msg) {
      list.push(item.props.msg);
    } else if (msgs && msgs.length) {
      list.push(...msgs.reverse());
    }
    return list;
  }, []);
}

/**
 * 从 React fiber 获取当前会话消息列表
 *
 * 优先从 chat.msgs._models 拿数据（完整的已加载消息模型，不受虚拟化影响），
 * 只有 _models 拿不到时才退到 .copyable-area 的渲染树解析。
 *
 * 注意：WhatsApp Web 使用虚拟列表渲染，.copyable-area 的 React children 只包含
 * 当前可视区域附近的消息节点，不是全部已加载的消息。直接解析渲染树会漏消息。
 * _models 才是完整的数据源。
 *
 * @param {{ includeMedia?: boolean }} [options]
 * @returns {Promise<Array>}
 */
export async function getMessagesByReact(options = {}) {
  const includeMedia = options.includeMedia === true;
  let msgPropsList = [];

  // 1) 优先：从 #main 的 React fiber 找 chat.msgs._models（完整数据模型）
  const mainDom = document.querySelector('div#main');
  const mainKey = mainDom ? Object.keys(mainDom).find((k) => k.startsWith('__reactProps$')) : '';
  const models = mainDom?.[mainKey]?.children
    ?.find((item) => item?.props?.chat)?.props?.chat?.msgs?._models || [];
  if (models.length > 0) {
    msgPropsList = models;
  }

  // 2) 兜底：从 .copyable-area 的渲染树解析（虚拟化，可能不完整）
  if (msgPropsList.length === 0) {
    const $list = document.querySelector('.copyable-area');
    const reactPropsKey = $list ? Object.keys($list).find((k) => k.startsWith('__reactProps$')) : '';
    const childrenList = $list?.[reactPropsKey]?.children || [];
    if (childrenList && childrenList.length) {
      msgPropsList = getMsgPropsList(childrenList);
    }
  }

  if (msgPropsList.length === 0) {
    console.log('[React fallback] 获取不到聊天记录');
    return [];
  }

  // msgPropsList 是 WPP 内部的 msg model，结构和 WPP.chat.getActiveChat().msgs._models 一致
  // 延迟 import 避免循环依赖
  const { getMsgItem } = await import('./message-types.js');
  const items = [];
  for (const m of msgPropsList) {
    try {
      const it = await getMsgItem(m, { includeMedia });
      if (it) items.push(it);
    } catch (e) {
      console.error('[React fallback] parse msg error:', e);
    }
  }
  return items.reverse();
}

/**
 * 从 React fiber 获取当前会话联系人 / 群信息
 * @returns {object|null}
 */
export function getSnsInfoByReact() {
  const messageHeader = document.querySelector('#main header');
  if (!messageHeader) return null;

  const meId = getMeIdByReact();
  const reactPropsValues = messageHeader.children[1]?.children[0]?.children[0];
  let chat = getReactPropsValues(reactPropsValues)[0]?.children?.props?.chat
    || getReactPropsValues(reactPropsValues)?.[0]?.children?.props?.children?.[0]?.props?.chat;
  if (!chat) {
    chat = getReactPropsValues(messageHeader.children[1])?.[0]?.children?.props?.children
      ?.find((item) => item?.props?.chat)?.props?.chat;
  }
  if (!chat) return null;

  const groupChat = chat?.groupMetadata?.participants?._models;
  const name = chat?.$ProxyState$state?.__x_formattedTitle || chat?.name || chat?.contact?.__x_displayName || '';

  // 1-on-1
  if (!groupChat || groupChat.length === 0) {
    const chatIdSerialized = chat?.id?._serialized || '';
    const isLid = chatIdSerialized.includes('@lid');
    const contact = chat?.contact || {};

    // 优先从 contact 对象拿真实手机号
    // LID 会话时 chat.id.user 是设备 ID（非手机号），必须从 phoneNumber 取
    // 非 LID（@c.us）时 chat.id.user 本身就是手机号，但 phoneNumber 更可靠
    const snsId =
      contact?.phoneNumber?.user ||
      contact?.__x_phoneNumber?.user ||
      contact?.__x_phoneNumber?.__x_user ||
      (!isLid ? chat?.id?.user : '') ||
      chat?.id?.user ||
      '';

    return { snsId, snsAvatar: '', snsNickname: name, isGroup: false, isLid };
  }

  // 群
  const groupData = {
    name,
    groupId: chat?.id?.user,
    isGroup: true,
    contact: [],
    meId,
  };
  groupData.contact = groupChat.map((item) => {
    const isMe = item.contact.isMe || item.contact?.__x_isMe;
    if (isMe) groupData.meId = item?.phoneNumber?.user || item?.id?.user;
    return {
      snsId: item?.phoneNumber?.user || item?.id?.user || '',
      snsNickname: item?.contact?.name || item?.contact?.pushname || '',
      isAdmin: item?.isAdmin,
      isSuperAdmin: item?.isSuperAdmin,
      isMe,
    };
  });
  return groupData;
}

/**
 * 从 React fiber 获取当前登录用户 ID
 * @returns {string}
 */
export function getMeIdByReact() {
  const sideElement = document.getElementById('side');
  const imgDom = document.querySelector([
    '#app header div[data-js-navbar] button[aria-label] img',
    'header img.x1n2onr6',
  ].join(','));
  let dom = imgDom?.parentNode?.parentNode;
  if (!dom) {
    dom = (
      sideElement?.previousElementSibling?.querySelector('[data-icon="default-user"]') ||
      sideElement?.parentElement?.previousElementSibling?.querySelector('[data-icon="default-user"]')
    )?.parentNode?.parentNode;
  }
  if (!dom) return getMeIdByStorage();
  const eventHandlersKey = Object.keys(dom).find((k) => k.includes('reactEventHandlers') || k.includes('reactProps'));
  if (!eventHandlersKey) return getMeIdByStorage();
  const chat = dom?.[eventHandlersKey]?.children?.props?.chat;

  // 优先从 contact.phoneNumber 拿真实手机号，chat.id.user 可能是 LID（设备 ID）
  const contact = chat?.contact || {};
  const phoneUser =
    contact?.phoneNumber?.user ||
    contact?.__x_phoneNumber?.user ||
    contact?.__x_phoneNumber?.__x_user ||
    '';
  if (phoneUser) return phoneUser;

  // chat.id.user 不是 LID 时直接用
  const chatIdSerialized = chat?.id?._serialized || '';
  if (!chatIdSerialized.includes('@lid') && chat?.id?.user) {
    return chat?.id?.user;
  }

  // LID 或拿不到时，退到 storage 兜底
  return getMeIdByStorage();
}

/**
 * 从 localStorage / sessionStorage 取 last-wid（兜底的兜底）
 * @returns {string}
 */
function getMeIdByStorage() {
  const wid = localStorage.getItem('last-wid')
    || sessionStorage.getItem('last-wid')
    || localStorage.getItem('last-wid-md')
    || sessionStorage.getItem('last-wid-md');
  if (!wid) return '';
  try {
    return JSON.parse(wid).replace(/@c.us/, '').replace(/:.*/, '');
  } catch {
    return '';
  }
}