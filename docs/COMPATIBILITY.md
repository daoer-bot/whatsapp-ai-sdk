# Compatibility

## 当前支持范围

- Chromium 浏览器，Manifest V3
- Chrome、Edge 等支持 MV3 的 Chromium 浏览器
- Node.js `>=18`，用于本地安装依赖和构建
- WhatsApp Web 页面：`https://web.whatsapp.com/*`
- `@wppconnect/wa-js`: `4.4.2`

## 不保证的部分

WhatsApp Web DOM、React fiber 和 WPP 内部接口都不是本项目可以控制的稳定公共 API。WhatsApp Web 更新后，以下能力可能失效：

- 当前会话识别
- 消息读取
- 输入框选择器
- 发送按钮定位
- React / DOM 降级路径

## 常见报错

### `Property getUserhash was not found ... WAWebContactGetters`

这是 **WhatsApp Web 内部 webpack 模块** 与 `@wppconnect/wa-js` 的绑定日志，**不是本扩展业务代码写错**。

当前结论（`wa-js@4.4.2` + 近期 WhatsApp Web 2.3000.x）：

- `getUserhash` 已从 `WAWebContactGetters` 消失或改名
- wa-js 仍尝试导出它 → `console.error` 一条
- 库内部会给该属性挂一个空 getter，**通常不影响** `isReady`、读会话、填输入框
- 上游修复 loader 的 PR 也明确写过：补丁之后 **还剩一条无害的 getUserhash miss**  
  参考：https://github.com/wppconnect-team/wa-js/pull/3499

**怎么判断要不要管：**

| 现象 | 处理 |
|------|------|
| 只有这一条红字，AI 按钮 / 读消息 / 回填正常 | **忽略**，等上游再升版本 |
| 同时大量 `Module X was not found`，且 `WPP.isReady === false` | 硬刷新页面；仍不行再升 wa-js / 看上游 #3481 相关 PR |
| 功能半残 | 本扩展会降级 React / DOM 读消息；composer 仍走 DOM |

本地已 pin：`@wppconnect/wa-js@^4.4.2`。升级后务必：

1. `npm run build`
2. 扩展管理页 **重新加载**
3. WhatsApp Web **硬刷新**（Ctrl+Shift+R）

本扩展**不会**调用 `getUserhash`；`src/` 里也没有这个符号。

出现其它兼容性问题时，请提供浏览器版本、WhatsApp Web 页面版本、扩展版本和控制台错误；不要上传聊天记录、cookie 或 API key。
