# Runtime API

本项目是 Chromium Manifest V3 浏览器扩展。构建并加载扩展后，SDK 会在 WhatsApp Web 页面中提供 `window.WhatsappAI`。

> `window.WhatsappAI` 是页面可见的运行时 API。页面内其他脚本理论上也可以调用它，因此不要把它当作带鉴权的私有接口。

## 初始化

```js
await window.WhatsappAI.ready();
```

返回值包含当前注入模式和 WPP 是否可用：

```js
{
  mode: 'wpp',
  wppReady: true,
  wppError: ''
}
```

## 读取数据

```js
const chat = await window.WhatsappAI.getActiveChat();
const messages = await window.WhatsappAI.getMessages(20, {
  includeMedia: false,
});
const meId = await window.WhatsappAI.getMeId();
```

`includeMedia: true` 可能触发媒体读取，开销更大；AI 回复场景建议保持默认值 `false`。

## 编辑器与发送

```js
await window.WhatsappAI.fillInput('Hello', true);
await window.WhatsappAI.sendReply('Hello');
const draft = await window.WhatsappAI.getInputContent();
```

`sendReply()` 会直接触发 WhatsApp Web 的发送动作，请调用方自行确认内容和当前会话。

## 新消息监听

```js
const unsubscribe = window.WhatsappAI.onNewMessage((message) => {
  console.log(message);
});

unsubscribe();
```

页面切换或扩展重载后，旧页面上下文中的监听器需要重新注册。

## 音频 Blob URL

```js
const url = await window.WhatsappAI.getAudioBlobUrl(messageId);
try {
  // 使用 url 播放音频
} finally {
  if (url) await window.WhatsappAI.revokeAudioBlobUrl(url);
}
```

每次 `getAudioBlobUrl()` 成功调用都会创建一个对象 URL，使用完成后必须释放。

## 错误与超时

RPC 默认会在约 15 秒后超时；WPP 初始化可能需要更久。WhatsApp Web 页面结构变化、页面未登录、扩展重载或当前会话不存在时，方法可能返回 `null` 或抛出错误。

## 配置

扩展选项页支持：

- `mock`：本地演示，不发送网络请求
- `dify`：调用用户自行配置的 Dify Chat Messages API
- `debug`：默认关闭；开启后会输出调试日志，部分日志可能包含消息摘要

API key 保存在 `chrome.storage.local`，不会加密。不要在共享浏览器配置或高敏感生产环境中直接复用。
