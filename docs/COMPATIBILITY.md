# Compatibility

## 当前支持范围

- Chromium 浏览器，Manifest V3
- Chrome、Edge 等支持 MV3 的 Chromium 浏览器
- Node.js `>=18`，用于本地安装依赖和构建
- WhatsApp Web 页面：`https://web.whatsapp.com/*`
- `@wppconnect/wa-js`: `4.3.1`

## 不保证的部分

WhatsApp Web DOM、React fiber 和 WPP 内部接口都不是本项目可以控制的稳定公共 API。WhatsApp Web 更新后，以下能力可能失效：

- 当前会话识别
- 消息读取
- 输入框选择器
- 发送按钮定位
- React / DOM 降级路径

出现兼容性问题时，请提供浏览器版本、WhatsApp Web 页面版本、扩展版本和控制台错误；不要上传聊天记录、cookie 或 API key。
