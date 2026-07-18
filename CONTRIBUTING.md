# Contributing

感谢贡献！请先创建 issue 说明问题或方案，再提交小而清晰的 pull request。

## 开发流程

```bash
npm ci
npm run verify
```

提交前请确认：

- 没有提交 API key、cookie、聊天记录或公司内部信息
- 没有把 `dist/`、`node_modules/` 等本地产物加入提交
- 变更说明包含测试结果和已知兼容性影响
- 代码保持现有 ESM 与 Rollup 构建约定
