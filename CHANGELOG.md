# Changelog

## 0.1.2 - 2026-07-28

### 展示与文档

- 明确产品定位：Chromium MV3 **浏览器扩展**（页面 API 为 `window.WhatsappAI`，非 npm runtime SDK）
- 新增英文 README：`README.en.md`
- 新增 [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) 威胁模型摘要
- 新增 [docs/SELECTOR_CHECKLIST.md](docs/SELECTOR_CHECKLIST.md) 选择器 / 注入人工回归清单
- 新增 [docs/assets/](docs/assets/README.md)：Hero / 架构 / UI 示意 SVG，以及演示视频与真机截图
- README（中/英）优先展示矢量图，真机录屏作辅证
- 新增 [docs/RELEASE_v0.1.2.md](docs/RELEASE_v0.1.2.md) 发布说明模板
- README（中/英）增加演示区与「30 秒看懂」表、架构示意、文档索引；SECURITY 链到威胁模型
- `package.json` 补充 `private`、`author`、扩展向 keywords 与描述


### 功能与修复（相对 0.1.1 工作区累计）

- 升级 `@wppconnect/wa-js` 至 `4.4.2`，缓解 WhatsApp Web 模块变更导致的 `getUserhash` / `WAWebContactGetters` 报错
- 修复 README 扩展加载路径：应加载仓库根目录，而不是 `dist/`
- 补全 `openai` provider（OpenAI 兼容 Chat Completions，含 blocking / 可选 stream）
- 选项页支持 model 字段，并默认突出 `mock` provider
- AI 入口：紧凑色点 pill（✦ AI / ✦ 润色）；首次会话轻 nudge；右键/长按开设置抽屉
- 配置错误 toast 可直达设置抽屉
- 修复输入框 AI 回填叠字：优先 WPP setTextContent、单次写入；默认不做流式预填
- 修复润色模式「浮窗更新、输入框不换」：全选覆盖写入 + polish 强制回填校验
- 修复输入框 text+text 叠字：单次写入、WPP 校验轮询、禁止 async 失败后再无脑 sync 追加

### 测试

- 增加 URL 规范化与 mock provider 离线测试
- 新增 RPC、prompt-builder、message-types 纯逻辑单测
- smoke 覆盖多 provider、加载路径说明与 composer 防叠字标记

## 0.1.1 - 2026-07-18

- 发布首个公开的 Chromium Manifest V3 扩展源码版本
- 增加 WPP、React fiber 和 DOM 降级读取路径
- 增加 mock 与 Dify AI provider
- 增加基础构建、smoke 和敏感信息检查
