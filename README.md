# WhatsApp AI Extension

[English README](./README.en.md)

面向 Chromium **Manifest V3** 的**非官方** WhatsApp Web **浏览器扩展**源码：读取当前会话与消息、监听更新、写入输入框，并可选接入 AI 辅助回复。

> **定位说明**：这是**扩展工程**，不是开箱即用的 npm runtime 包。构建后在浏览器中加载**仓库根目录**（含 `manifest.json`）。页面侧调试/二次开发 API 为 `window.WhatsappAI`（名称沿用历史，实为扩展注入的页面 API）。

> 免责声明：本项目不是 WhatsApp、Meta 或 WPPConnect 官方项目。请自行确认使用方式符合 WhatsApp 服务条款、当地法律和所在组织的合规要求。

[![CI](https://github.com/daoer-bot/whatsapp-ai-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/daoer-bot/whatsapp-ai-sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)

## 30 秒看懂

| 难点 | 本项目做法 |
| --- | --- |
| MV3 content script 看不到页面 `window` | 向 **page world** 注入 `inject.js`，`postMessage` RPC 通信 |
| WhatsApp Web 无稳定公共 API | **WPP → React fiber → DOM** 三级降级 |
| Lexical 输入框易叠字 | 单次写入、可用时走 WPP `setTextContent`、回填校验 |
| AI 默认不外泄聊天 | 默认 **`mock`**，不内置 key / 远程地址 |

```text
┌──────────────────────────── WhatsApp Web 页面 ────────────────────────────┐
│  isolated world (content.js)          page world (inject.js + wpp.js)     │
│  ┌─────────────────────┐   postMessage RPC   ┌─────────────────────────┐  │
│  │ ✦ 入口 / 页内设置抽屉 │ ◄────────────────► │ window.WhatsappAI 数据面 │  │
│  │ mock/dify/openai      │                     │ WPP → React → DOM 降级  │  │
│  └─────────────────────┘                     └─────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

**截图 / 演示 GIF**：请放到 [`docs/assets/`](docs/assets/README.md)（勿提交真实聊天或 API key）。补图后可在本段下方引用，例如：

```markdown
![AI 入口](docs/assets/hero-ai-button.png)
```

## 能力概览

- 通过 `@wppconnect/wa-js` 读取当前会话及消息；失败时 React / DOM 降级
- 监听当前会话消息变化
- 将文本写入 WhatsApp Web 编辑器，并支持发送操作
- 隔离上下文桥接扩展 UI 与页面能力
- 可选 AI：
  - `mock`：本地演示，不发网络请求（**默认**）
  - `dify`：Dify Chat Messages API
  - `openai`：OpenAI 兼容 Chat Completions（含多数中转/网关）
- 类型声明：[types/whatsapp-ai-sdk.d.ts](types/whatsapp-ai-sdk.d.ts)
- 文档：[API](docs/API.md) · [架构](docs/ARCHITECTURE.md) · [兼容性](docs/COMPATIBILITY.md) · [威胁模型](docs/THREAT_MODEL.md) · [选择器回归清单](docs/SELECTOR_CHECKLIST.md)

## 快速开始

### 环境

- 支持 Manifest V3 的 Chromium（Chrome / Edge 等）
- Node.js `>=18`
- 已登录的 WhatsApp Web

### 安装依赖并构建

```bash
npm ci
npm run verify
```

`dist/` 默认不进 Git，加载扩展前请本地构建。

### 在 Chrome / Edge 中加载

> **重要**：请加载**仓库根目录**（包含 `manifest.json` 和 `options.html` 的目录），**不要**只选择 `dist/`。  
> 加载的是仓库根目录，**不是 `dist/`**。`manifest.json` 会引用 `dist/content.js`、`dist/inject.js` 等构建产物。

1. 根目录执行 `npm run build`（或 `npm run verify`）。
2. 打开 `chrome://extensions/` → 开发者模式 →「加载已解压的扩展程序」→ 选择本项目的**根目录**（不是 `dist/`）。
3. 打开 [WhatsApp Web](https://web.whatsapp.com) 并完成登录。
4. 保持默认 `mock`，在输入框旁点 **✦**（空输入=回复，有草稿=润色）。
5. **右键**（或长按）✦ 打开页内设置抽屉（与 `options.html` 共用 `chrome.storage.local`）。

更细的环境限制见 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)；改版后人工回归见 [docs/SELECTOR_CHECKLIST.md](docs/SELECTOR_CHECKLIST.md)。

### 控制台最小示例

```js
await window.WhatsappAI.ready();
const chat = await window.WhatsappAI.getActiveChat();
const messages = await window.WhatsappAI.getMessages(10);
await window.WhatsappAI.fillInput('Hello from WhatsappAI', true);
```

完整方法见 [docs/API.md](docs/API.md)。

## AI 配置与跨域

| Provider | Base URL 示例 | 自动补全 | 额外字段 |
| --- | --- | --- | --- |
| `mock` | 无需填写 | — | — |
| `dify` | `https://your-host/v1` | `/chat-messages` | API Key |
| `openai` | `https://api.openai.com/v1` 或中转 `/v1` | `/chat/completions` | API Key、Model（默认 `gpt-4o-mini`） |

- AI 请求目前由 **content script** 发出，endpoint 须允许来自 `https://web.whatsapp.com` 的 CORS；不支持跨域时需自建代理，或等待路线图中的 **Service Worker 代理**。
- API key 存于 `chrome.storage.local`，**不加密**；勿写入源码或提交到 Git。安全边界见 [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)。
- 默认关闭调试日志；开启后部分日志可能含消息摘要。

## 项目结构

```text
src/
├─ content/   扩展 UI、桥接与交互（isolated world）
├─ core/      消息提取、监听、编辑器、AI、RPC
└─ inject/    页面上下文注入（page world）
scripts/      smoke、敏感信息扫描
test/         Node.js 纯逻辑单测（ai-client / rpc / prompt / message-types）
types/        页面 API 的 TypeScript 声明
docs/         API、架构、兼容性、威胁模型、回归清单、展示资源
manifest.json 扩展清单（加载根目录）
options.html  扩展选项页（完整表单备用）
```

## 开发与验证

```bash
npm ci
npm run verify          # build + check:secrets + test + smoke
npm audit --omit=dev
```

CI 在 push / PR 时跑构建、测试、敏感信息扫描与依赖审计。

## 隐私与安全

- 默认配置不携带远程地址或 API key
- 使用 dify / openai 时，当前会话上下文可能发往你配置的第三方服务
- `window.WhatsappAI` 为页面可见 API，**不是**带鉴权的私有接口
- 漏洞请按 [SECURITY.md](SECURITY.md) 私密报告；模型摘要见 [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)

## 已知限制

- WhatsApp Web DOM、React 内部结构、WPP API 均非本项目可控的稳定公共接口
- 页面更新后选择器 / 注入逻辑可能需要调整（见回归清单）
- 不承诺绕过 WhatsApp 限制，不保证长期兼容
- AI 受页面 CORS 约束

## 路线图

- [x] mock / dify / openai 三 provider
- [x] 页内设置抽屉 + 威胁模型 / 选择器回归文档
- [x] 纯逻辑单测扩展（RPC、prompt、message-types）
- [ ] Service Worker 代理 AI 请求，降低 CORS 摩擦
- [ ] 选项页暴露 stream 开关（storage 已可写）
- [ ] GitHub Release 附带构建说明 / 可选产物说明

## 贡献

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。提交前执行 `npm run verify`。

## 许可证

MIT，见 [LICENSE](LICENSE)。第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

**仓库 GitHub Topics 建议**（在仓库 Settings → Topics 填写，需你在网页操作）：  
`chrome-extension` · `manifest-v3` · `whatsapp-web` · `browser-extension` · `ai-assistant` · `wppconnect`
