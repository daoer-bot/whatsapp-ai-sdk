/**
 * content/bridge.js — 最小 page-world 调试桥
 *
 * 只做一件事：在 page world 暴露 window.WhatsappAI，
 * 通过 postMessage 与 content script 中真实的 SDK 通信。
 *
 * 这不改变核心架构，只是让 devtools console 可以直接调试：
 *   await window.WhatsappAI.ready()
 *   await window.WhatsappAI.getMessages(3)
 */

(function () {
  if (window.WhatsappAI) return;

  var seq = 0;
  var pending = Object.create(null);
  var listeners = { newMessage: [] };

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.__waai_bridge__ !== 'wa-sdk:response') return;

    if (data.type === 'resolve') {
      var task = pending[data.id];
      if (!task) return;
      clearTimeout(task.timer);
      delete pending[data.id];
      task.resolve(data.value);
    } else if (data.type === 'reject') {
      var task2 = pending[data.id];
      if (!task2) return;
      clearTimeout(task2.timer);
      delete pending[data.id];
      task2.reject(data.error || 'Unknown error');
    } else if (data.type === 'event' && data.event === 'newMessage') {
      listeners.newMessage.forEach(function (fn) {
        try { fn(data.value); } catch (e) {}
      });
    }
  });

  function call(method, args) {
    return new Promise(function (resolve, reject) {
      var id = 'page-' + (++seq);
      var timer = setTimeout(function () {
        delete pending[id];
        reject(new Error('Bridge timeout: ' + method));
      }, 15000);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      window.postMessage({
        __waai_bridge__: 'wa-sdk:request',
        id: id,
        method: method,
        args: args || null,
      }, '*');
    });
  }

  window.WhatsappAI = {
    ready: function () { return call('ready'); },
    getActiveChat: function () { return call('getActiveChat'); },
    /**
     * @param {number} [limit]
     * @param {{ includeMedia?: boolean }} [options]
     *   兼容旧调用：getMessages(20) / getMessages(20, { includeMedia: true })
     */
    getMessages: function (limit, options) {
      var includeMedia = false;
      if (options && typeof options === 'object') {
        includeMedia = options.includeMedia === true;
      }
      return call('getMessages', {
        limit: limit || 20,
        includeMedia: includeMedia,
      });
    },
    getMeId: function () { return call('getMeId'); },
    getInputContent: function () { return call('getInputContent'); },
    getAudioBlobUrl: function (dataId) { return call('getAudioBlobUrl', { dataId: dataId }); },
    revokeAudioBlobUrl: function (url) { return call('revokeAudioBlobUrl', { url: url }); },
    fillInput: function (text, replace) { return call('fillInput', { text: text, replace: !!replace }); },
    sendReply: function (text) { return call('sendReply', { text: text }); },
    loadMoreHistory: function (count) { return call('loadMoreHistory', { count: count || 50 }); },
    onNewMessage: function (callback) {
      listeners.newMessage.push(callback);
      return function () {
        var i = listeners.newMessage.indexOf(callback);
        if (i >= 0) listeners.newMessage.splice(i, 1);
      };
    },
  };

  console.log('[WhatsApp AI SDK] page bridge ready');
})();