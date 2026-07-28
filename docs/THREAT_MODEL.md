# Threat Model（摘要）

本文是面向二次开发与安全审阅的**简版威胁模型**，不是完整审计报告。目标：说清信任边界、默认安全姿态，以及本项目**明确不做**的事。

## 资产

| 资产 | 说明 |
| --- | --- |
| WhatsApp Web 会话数据 | 当前聊天、消息正文、可选媒体元数据 |
| 用户草稿 | 输入框中的待发文本 |
| AI 配置 | `chrome.storage.local` 中的 provider / baseUrl / apiKey / model |
| 页面全局 API | `window.WhatsappAI`（page world 可见） |

## 信任边界

```text
┌─ 不可信 ─────────────────────────────────────────────┐
│  WhatsApp Web 页面脚本、其它扩展、恶意网页内容       │
│  page world：inject.js / wpp.js / window.WhatsappAI  │
└──────────────────────────▲───────────────────────────┘
                           │ postMessage RPC（无鉴权）
┌─ 相对可信（扩展 isolated world）─────────────────────┐
│  content.js UI、AI 请求、chrome.storage 读写         │
└──────────────────────────────────────────────────────┘
         │ 用户配置的 HTTPS endpoint
         ▼
┌─ 第三方 ─────────────────────────────────────────────┐
│  用户自建 Dify / OpenAI 兼容网关（本项目不托管）       │
└──────────────────────────────────────────────────────┘
```

要点：

1. **page world 不可信**。任何能在 `web.whatsapp.com` 跑 JS 的代码，理论上都能调用 `window.WhatsappAI` 或伪造 `postMessage`。
2. **RPC 不做鉴权**。这是浏览器扩展与 page 注入的常见取舍：隔离的是能力边界，不是密码学边界。
3. **AI 请求发往用户配置的地址**。本项目默认 `mock`，不内置第三方 endpoint 或 key。

## 设计选择（与安全相关）

| 选择 | 原因 |
| --- | --- |
| 默认 `provider=mock` | 未配置时不把聊天内容打到外网 |
| composer 走 DOM/Lexical，不走 WPP 发送 API | 缩小“静默群发/误发”的能力面；发送仍依赖可见 UI 动作 |
| 权限仅 `storage` + `https://web.whatsapp.com/*` | 最小权限；不申请宽泛 `<all_urls>` |
| API key 存 `chrome.storage.local` 明文 | 扩展端“加密存储”若无独立密钥管理，只是混淆；不假装已保护 |
| AI HTTP 在 content script 发起 | 实现简单，但受页面 CORS 约束；见路线图 Service Worker 代理 |
| 调试日志默认关闭 | 避免消息摘要默认刷进控制台 |

## 主要风险与缓解

| 风险 | 影响 | 缓解 / 现状 |
| --- | --- | --- |
| 页面脚本调用 `WhatsappAI` | 读当前会话、填输入框、触发发送 | 文档明示非私有 API；不在不可信页面加载扩展；发送需用户场景确认 |
| 恶意/被篡改 AI 网关 | 聊天上下文外泄或投毒回复 | 用户自控 endpoint；默认 mock；HTTPS 强制升级 |
| API key 被本机其它扩展/恶意软件读取 | key 泄露 | 仅适合个人本机；共享浏览器勿用；泄露后立即轮换 |
| CORS 配置过宽的自建代理 | 任意站点打到用户 AI 服务 | 代理应校验 Origin / 鉴权；不在本仓库提供“敞开代理” |
| WhatsApp Web / wa-js 变更 | 功能失效或异常行为 | 三级降级；兼容性文档；不承诺长期稳定 |
| 扩展重载后旧 content script | `chrome.runtime` 失效 | 检测 invalidation 并提示刷新页面 |

## 明确不做

- 不绕过 WhatsApp 服务条款或反自动化限制
- 不提供批量骚扰、爬取通讯录、隐藏已读等能力
- 不在默认配置中收集遥测或回传聊天记录
- 不把客户端存储包装成“端到端加密密钥保管”

## 报告问题

请遵循 [SECURITY.md](../SECURITY.md)：私密报告，不要在公开 issue 贴可利用细节、聊天记录或真实 key。
