# Changelog

## 0.1.2 - 2026-07-27

- 修复 README 扩展加载路径：应加载仓库根目录，而不是 `dist/`
- 补全 `openai` provider（OpenAI 兼容 Chat Completions，含 blocking / 可选 stream）
- 选项页支持 model 字段，并默认突出 `mock` provider
- 增加 URL 规范化单测与 mock provider 离线测试
- 新增 `docs/ARCHITECTURE.md`，补充 API / README 中的多 provider 说明

## 0.1.1 - 2026-07-18

- 发布首个公开的 Chromium Manifest V3 扩展源码版本
- 增加 WPP、React fiber 和 DOM 降级读取路径
- 增加 mock 与 Dify AI provider
- 增加基础构建、smoke 和敏感信息检查
