# WhatsApp AI SDK

一个面向 Chromium Manifest V3 的非官方 WhatsApp Web 浏览器扩展项目，提供消息读取、会话监听、消息类型归一化、输入框写入与可选 AI 辅助回复能力。

> 免责声明：本项目不是 WhatsApp、Meta 或 WPPConnect 官方项目。请自行确认使用方式符合 WhatsApp 的服务条款、当地法律和所在组织的合规要求。

## 这是什么项目

这是一个**浏览器扩展源码项目**，不是开箱即用的 npm runtime SDK。项目构建后会生成 `dist/`，再以“加载已解压的扩展程序”的方式安装到 Chromium 浏览器中。

运行时 API 通过页面中的 `window.WhatsappAI` 暴露，具体方法和返回结构见 [docs/API.md](docs/API.md)。TypeScript 使用者可以参考 [types/whatsapp-ai-sdk.d.ts](types/whatsapp-ai-sdk.d.ts)。

## 能力概览

- 通过 `@wppconnect/wa-js` 读取当前会话及消息数据
- WPP API 不可用时，提供 React fiber 与 DOM 降级读取路径
- 监听当前会话消息变化
- 将文本写入 WhatsApp Web 编辑器，并支持发送操作
- 将页面上下文能力通过隔离上下文桥接给扩展 UI
- 可选接入兼容 Dify Chat Messages API 的 AI 服务
- 默认使用本地 mock 配置，不内置任何第三方地址、账号或 API key

## 快速开始

### 环境

- Chromium 浏览器，支持 Manifest V3
- Node.js `>=18`
- 已登录的 WhatsApp Web

### 安装依赖并构建

```bash
npm ci
npm run verify
```

构建产物会生成到 `dist/`。该目录默认被 Git 忽略，发布前请在本地重新构建。

### 在 Chrome / Edge 中加载

1. 执行 `npm run build`。
2. 打开 `chrome://extensions/` 或对应浏览器的扩展管理页。
3. 开启“开发者模式”。
4. 选择“加载已解压的扩展程序”，选择本项目的 `dist/` 目录。
5. 打开 WhatsApp Web 并确认页面已完成登录。

更详细的环境限制见 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)。

## AI 配置与跨域说明

扩展选项页支持：

- `mock`：本地开发与演示，不发送网络请求
- `dify`：调用用户自行配置的 Dify Chat Messages API

Dify 请求当前由 content script 发出，因此你配置的 endpoint 必须允许来自 `https://web.whatsapp.com` 的 CORS 请求；如果网关不允许跨域，请使用允许该来源的代理或自行改造为 Service Worker 请求架构。

API key 保存在 `chrome.storage.local`，不会加密。不要把真实凭据写入源码、提交到 Git，或在共享浏览器配置和高敏感生产环境中直接复用。

默认调试日志关闭。只有在扩展选项页显式开启“调试日志”后，才会输出调试信息；部分调试信息可能包含消息摘要。

## 项目结构

```text
src/
├─ content/   扩展页面侧 UI、桥接与交互
├─ core/      消息提取、监听、编辑器控制、AI 客户端
└─ inject/    页面上下文注入逻辑
scripts/
└─ smoke.mjs  基础运行校验
test/          Node.js 纯逻辑测试
types/         运行时 API 的 TypeScript 声明
docs/          API 与兼容性文档
```

## 开发与验证

```bash
npm ci
npm run verify
npm audit --omit=dev
```

CI 会在 push 和 pull request 时自动执行构建、测试、敏感信息扫描和依赖审计。

## 隐私与安全

- 本项目不会在默认配置中携带远程服务地址或 API key。
- 使用 Dify 时，当前会话上下文可能发送到你配置的第三方服务。
- `window.WhatsappAI` 是页面可见 API，页面内其他脚本理论上也可以调用它；不要把它视为带鉴权的私有接口。
- 浏览器扩展权限和 WhatsApp Web 页面结构都可能发生变化，请在生产环境中进行充分测试。
- 发现潜在安全问题，请参考 [SECURITY.md](SECURITY.md)，不要直接公开发布可利用细节。

## 已知限制

- WhatsApp Web DOM、React 内部结构和 WPP API 都不是本项目可控的稳定公共接口。
- WhatsApp Web 更新后，消息选择器、编辑器行为或注入逻辑可能需要调整。
- 本项目不承诺绕过 WhatsApp 的限制，也不保证长期兼容性。

## 贡献

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。提交代码前执行：

```bash
npm run verify
```

## 第三方声明与许可证

本项目使用 MIT 许可证，详见 [LICENSE](LICENSE)。依赖项的许可证与版权信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
