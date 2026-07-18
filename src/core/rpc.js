/**
 * core/rpc.js — 基于 window.postMessage 的轻量双向 RPC
 *
 * 用于 content script ↔ inject (page) 上下文之间的通信。
 * content script 运行在扩展隔离环境，无法直接访问页面的 window.WPP 和 __reactProps$，
 * 因此必须通过 inject 脚本（page 上下文）来读取数据，再用 postMessage 传回来。
 *
 * 错误约定：
 * - 默认 send()：失败/超时 resolve(null)（保持旧调用方兼容）
 * - sendOrThrow()：失败/超时 reject(Error)，适合需要展示错误的路径
 */

/**
 * 生成唯一请求 ID
 */
function genUid() {
  return Math.random().toString().slice(2);
}

const TYPE_SEND = 'send';
const TYPE_RECEIVE_SEND = 'receive send';
const TYPE_EVENT = 'event';

/**
 * 创建 RPC 实例
 * @param {{ origin: string, post: (data: object) => void, timeout?: number }} options
 */
export function createRpc({ origin, post, timeout = 10000 }) {
  const handlers = {}; // key -> Set<fn>
  const eventListeners = {}; // event -> Set<fn>
  /** @type {Record<string, { resolve: Function, reject: Function, timer: any, throwOnError: boolean }>} */
  const pendingCallbacks = {};

  /**
   * 处理收到的消息
   */
  function receive(data) {
    // 消息必须是 { uid, origin, key, value, type }
    if (!data || typeof data.uid !== 'string' || !data.uid.startsWith('0.')) return;

    if (data.type === TYPE_RECEIVE_SEND) {
      const pending = pendingCallbacks[data.uid];
      if (!pending) return;
      clearTimeout(pending.timer);
      delete pendingCallbacks[data.uid];
      const [res, err] = data.value || [null, 'empty'];
      if (err) {
        if (pending.throwOnError) {
          pending.reject(new Error(String(err)));
        } else {
          pending.resolve(null);
        }
        return;
      }
      pending.resolve(res);
      return;
    }

    if (data.type === TYPE_EVENT) {
      const fns = eventListeners[data.key];
      if (fns) fns.forEach((fn) => fn(data.value));
      return;
    }

    if (data.type === TYPE_SEND) {
      const fns = handlers[data.key];
      if (fns && fns.size > 0) {
        const fn = fns.values().next().value;
        Promise.resolve()
          .then(() => fn(data.value, { origin: data.origin }))
          .then(
            (res) => post({ uid: data.uid, origin, key: data.key, value: [res, null], type: TYPE_RECEIVE_SEND }),
            (err) => post({
              uid: data.uid,
              origin,
              key: data.key,
              value: [null, String(err?.message || err)],
              type: TYPE_RECEIVE_SEND,
            }),
          );
      }
    }
  }

  /**
   * 发起远程调用（兼容模式：失败/超时返回 null）
   * @param {string} key
   * @param {*} value
   * @returns {Promise<*>}
   */
  function send(key, value) {
    return sendInternal(key, value, false);
  }

  /**
   * 发起远程调用（严格模式：失败/超时抛错）
   * @param {string} key
   * @param {*} value
   * @returns {Promise<*>}
   */
  function sendOrThrow(key, value) {
    return sendInternal(key, value, true);
  }

  function sendInternal(key, value, throwOnError) {
    const uid = '0.' + genUid();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        delete pendingCallbacks[uid];
        const msg = `[RPC] ${key} timeout after ${timeout}ms`;
        console.warn(msg);
        if (throwOnError) reject(new Error(msg));
        else resolve(null);
      }, timeout);

      pendingCallbacks[uid] = { resolve, reject, timer, throwOnError };
      post({ uid, origin, key, value, type: TYPE_SEND });
    });
  }

  function on(key, fn) {
    if (!handlers[key]) handlers[key] = new Set();
    handlers[key].add(fn);
  }

  function off(key, fn) {
    if (handlers[key]) {
      if (fn) handlers[key].delete(fn);
      else delete handlers[key];
    }
  }

  function emit(event, value) {
    const uid = '0.' + genUid();
    post({ uid, origin, key: event, value, type: TYPE_EVENT });
  }

  function onEvent(event, fn) {
    if (!eventListeners[event]) eventListeners[event] = new Set();
    eventListeners[event].add(fn);
  }

  function offEvent(event, fn) {
    if (eventListeners[event]) {
      if (fn) eventListeners[event].delete(fn);
      else delete eventListeners[event];
    }
  }

  return { send, sendOrThrow, on, off, emit, onEvent, offEvent, receive };
}

/**
 * 便捷工厂：自动绑定 window message 事件
 * @param {{ origin: string, timeout?: number }} options
 */
export function createWindowRpc({ origin, timeout }) {
  const rpc = createRpc({
    origin,
    post: (data) => window.postMessage(data, '*'),
    timeout,
  });
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    rpc.receive(event.data);
  });
  return rpc;
}
