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

| Provider | 说明 | Base URL | 其他 |
| --- | --- | --- | --- |
| `mock` | 本地演示，不发网络请求（默认） | 无需填写 | — |
| `dify` | Dify Chat Messages API | 填到 `/v1` 或完整 `/chat-messages` | API Key |
| `openai` | OpenAI 兼容 Chat Completions | 填到 `/v1` 或完整 `/chat/completions` | API Key、Model（默认 `gpt-4o-mini`） |
| `debug` | 调试日志开关 | — | 默认关闭；开启后可能输出消息摘要 |

URL 规则：

- 以 `http://` 填写的地址会自动升级为 `https://`（避免 Mixed Content）
- `dify`：未以 `/chat-messages` 结尾时自动补全
- `openai`：未以 `/chat/completions` 结尾时自动补全

模式：

- 输入框为空：`ask`（根据聊天历史生成回复）
- 输入框已有内容：`polish`（润色草稿）

可选：在配置中设置 `stream: true`（当前仅能通过 storage 写入，选项页未暴露）以启用 SSE 流式；默认 blocking。

API key 保存在 `chrome.storage.local`，不会加密。不要在共享浏览器配置或高敏感生产环境中直接复用。

AI 请求由 content script 发起，endpoint 必须允许来自 `https://web.whatsapp.com` 的 CORS。
