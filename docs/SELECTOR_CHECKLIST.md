# Selector & Injection Regression Checklist

WhatsApp Web 改版后，优先用本清单做**人工回归**（不依赖不稳定的线上 E2E）。

每次升级 `@wppconnect/wa-js`、调整 `selectors.js` / `composer.js` / `inject.js`、或用户反馈“读不到消息 / 填不进输入框”时走一遍。

## 环境

- [ ] Chromium（Chrome 或 Edge），开发者模式已加载**仓库根目录**
- [ ] 已执行 `npm run build` 且扩展已点「重新加载」
- [ ] WhatsApp Web 已登录；硬刷新（Ctrl+Shift+R）一次
- [ ] 默认 `provider=mock`，调试日志可按需打开

## 注入与就绪

- [ ] 控制台无持续刷屏的扩展报错（`getUserhash` 单条可忽略，见 [COMPATIBILITY.md](./COMPATIBILITY.md)）
- [ ] `await window.WhatsappAI.ready()` 返回，且最终能读到会话或明确降级
- [ ] 扩展重载后**不刷新页面**：应提示 context invalidated；刷新后恢复

## 数据读取

- [ ] 打开单聊：`getActiveChat()` 有 `snsId` / 昵称类字段
- [ ] `getMessages(10)` 返回非空数组，`send_type` 出入方向合理
- [ ] 打开群聊：能区分群（若字段可用），消息 `send_id` 不总是空
- [ ] 切换会话后再次 `getMessages`，内容随会话变化
- [ ] 含图片/文件的会话：默认 `includeMedia: false` 不至于卡死或拉全量媒体

## Composer（高风险）

- [ ] `fillInput('hello-from-checklist', true)` 输入框为**单份**文本，无叠字
- [ ] 再 `fillInput('second', true)` 应为替换而非追加成 `hellosecond` / 双份
- [ ] 润色路径（输入框先有草稿再点 ✦）：浮窗与输入框一致更新
- [ ] 空输入点 ✦（ask）：mock 回填一段英文跟进话术
- [ ] 发送按钮点击路径（若测试 `sendReply`）：只发一次，需人工确认会话

## UI

- [ ] 输入框旁出现 ✦ 入口（空=回复，有草稿=润色文案/状态可区分）
- [ ] 右键 / 长按 ✦ 打开页内设置抽屉
- [ ] 抽屉改 provider 为 mock 并保存后，再次生成仍走本地
- [ ] 配置错误时 toast 可点到设置（若适用）

## AI providers（可选）

- [ ] `mock`：无网络请求（DevTools Network 无外发 AI）
- [ ] `openai`：仅在自有可 CORS 的网关下验证；失败有可读错误
- [ ] `dify`：同上
- [ ] `http://` baseUrl 被升级为 `https://`（或明确报错）

## 记录模板（开 issue 时）

```text
Browser:
WhatsApp Web version (if visible):
Extension version / commit:
wa-js version:
Failed step:
Console errors (redact chat content & keys):
WPP.isReady / ready() result:
```

不要上传聊天记录、cookie、API key 或手机号明文。
