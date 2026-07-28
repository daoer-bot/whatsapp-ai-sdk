# Contributing

感谢贡献！请先创建 issue 说明问题或方案，再提交小而清晰的 pull request。

## 开发流程

```bash
npm ci
npm run verify
```

`verify` = 构建 + 敏感信息扫描 + 单测 + smoke。

提交前请确认：

- 没有提交 API key、cookie、聊天记录或公司内部信息
- 没有把 `dist/`、`node_modules/`、含真实会话的截图加入提交
- 变更说明包含测试结果和已知兼容性影响
- 代码保持现有 ESM 与 Rollup 构建约定
- 若改动选择器 / composer / 注入时序，尽量按 [docs/SELECTOR_CHECKLIST.md](docs/SELECTOR_CHECKLIST.md) 做一次人工回归并在 PR 里勾选结果

## 文档

- 架构：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 威胁模型：[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)
- 安全报告：[SECURITY.md](SECURITY.md)

## 范围提醒

本项目是**非官方** WhatsApp Web 扩展。请勿提交用于绕过平台限制、批量骚扰或隐藏用户操作的功能。
