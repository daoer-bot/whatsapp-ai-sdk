/**
 * core/message-monitor.js — MutationObserver 实时新消息监听
 *
 * WhatsApp Web 在收到新消息时会在 #main 下插入新的 role="row" 节点，其中含 `.message-in`
 * 类的就是入站消息。我们通过 MutationObserver 监听这一变化。
 *
 * 注意：debounce 期间会累积节点，flush 时统一回调并按 message_id 去重，避免连发丢消息。
 */

/**
 * 从 mutation 中提取入站消息 row 节点
 * @param {MutationRecord} mutation
 * @returns {HTMLElement[]}
 */
function collectIncomingNodes(mutation) {
  const nodes = [];
  for (const node of mutation.addedNodes) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.getAttribute?.('role') === 'row' && node.querySelector?.('.message-in')) {
      nodes.push(node);
      continue;
    }
    // 有时 addedNodes 是容器，消息在子树里
    if (node.querySelectorAll) {
      node.querySelectorAll('[role="row"]').forEach((row) => {
        if (row.querySelector?.('.message-in')) nodes.push(row);
      });
    }
  }
  return nodes;
}

/**
 * 节点去重 key
 * @param {HTMLElement} node
 */
function nodeKey(node) {
  return node?.dataset?.id || node?.getAttribute?.('data-id') || '';
}

/**
 * 启动新消息监听
 * @param {(info: { node: HTMLElement }) => void} callback — 检测到新消息时回调
 * @param {{ root?: HTMLElement, debounceMs?: number }} options
 * @returns {{ destroy: () => void }}
 */
export function startMessageMonitor(callback, options = {}) {
  const root = options.root || document.documentElement;
  const debounceMs = options.debounceMs || 500;
  let debounceTimer = null;
  /** @type {Map<string, HTMLElement>} */
  const pending = new Map();
  let anonSeq = 0;

  const flush = () => {
    debounceTimer = null;
    const batch = [...pending.values()];
    pending.clear();
    for (const node of batch) {
      try {
        callback({ node });
      } catch (e) {
        console.error('[message-monitor] callback error:', e);
      }
    }
  };

  const enqueue = (nodes) => {
    for (const node of nodes) {
      const key = nodeKey(node) || `__anon_${++anonSeq}`;
      pending.set(key, node);
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, debounceMs);
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;
      const nodes = collectIncomingNodes(mutation);
      if (nodes.length) enqueue(nodes);
    }
  });

  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false,
  });

  return {
    observer,
    destroy: () => {
      observer.disconnect();
      if (debounceTimer) clearTimeout(debounceTimer);
      pending.clear();
    },
  };
}

/**
 * 通用 DOM 变更观察器
 * 监听特定 id / 标签被插入或条件满足时触发回调
 * @param {() => void} cb
 * @param {string} id — 节点 id 或 tag name
 * @param {(mutation: MutationRecord) => boolean} condition
 */
export function observeHtml(cb, id = 'main', condition) {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;
      if (condition) {
        if (condition(mutation)) nextTick(cb);
      } else {
        const matched = [...(mutation.addedNodes || [])].some(
          (item) => item.id === id || item.tagName?.toLowerCase() === id,
        );
        if (matched) nextTick(cb);
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false,
  });
  return {
    observer,
    destroy: () => observer.disconnect(),
  };
}

function nextTick(fn) {
  Promise.resolve().then(fn);
}
