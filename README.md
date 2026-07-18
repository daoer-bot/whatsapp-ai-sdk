# WhatsApp AI SDK

一个面向浏览器扩展的非官方 WhatsApp Web SDK，提供消息读取、会话监听、消息类型归一化、输入框写入与可选 AI 辅助回复能力。

> 免责声明：本项目不是 WhatsApp、Meta 或 WPPConnect 官方项目。请自行确认使用方式符合 WhatsApp 的服务条款、当地法律和所在组织的合规要求。

## 能力概览

- 通过 `@wppconnect/wa-js` 读取当前会话及消息数据
- WPP API 不可用时，提供 React fiber 与 DOM 降级读取路径
- 监听当前会话消息变化
- 将文本写入 WhatsApp Web 编辑器，并支持发送操作
- 将页面上下文能力通过隔离上下文桥接给扩展 UI
- 可选接入兼容 Dify Chat Messages API 的 AI 服务
- 默认使用本地 mock 配置，不内置任何第三方地址、账号或 API key

## 快速开始

### 安装依赖

```bash
npm ci
```

### 构建扩展

```bash
npm run build
```

构建产物会生成到 `dist/`。该目录默认被 Git 忽略，发布前请在本地重新构建。

### 运行校验

```bash
npm run verify
```

校验包含构建、敏感信息扫描和基础 smoke test。

### 在 Chrome 中加载

1. 执行 `npm run build`。
2. 打开 `chrome://extensions/`。
3. 开启右上角的“开发者模式”。
4. 选择“加载已解压的扩展程序”，选择本项目的 `dist/` 目录。
5. 打开 WhatsApp Web 并确认页面已完成登录。

## AI 配置

开源版本默认配置位于 `src/core/ai-config.js`，默认 provider 为 `mock`，不会向外部服务发送消息。

如果你要接入自己的服务，请在扩展选项页或运行时配置中填写自己的 provider、endpoint 和 API key。不要把真实凭据写入源码、提交到 Git，或放入浏览器扩展的公开构建产物中。

当前 AI 客户端支持：

- `mock`：本地开发与演示，不需要网络请求
- `dify`：调用用户自行配置的 Dify Chat Messages API

## 项目结构

```text
src/
├─ content/   扩展页面侧 UI、桥接与交互
├─ core/      消息提取、监听、编辑器控制、AI 客户端
└─ inject/    页面上下文注入逻辑
scripts/
└─ smoke.mjs  基础运行校验
```

## 隐私与安全

- 本项目不会在默认配置中携带远程服务地址或 API key。
- 使用 AI 服务时，消息内容可能会发送到你配置的第三方服务；请在启用前评估隐私、数据驻留和合规要求。
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
