# Security Policy

## Reporting a vulnerability

请不要在公开 issue 中发布可利用的安全细节。请使用 GitHub 仓库的 **Security → Advisories → Report a vulnerability** 提交私密报告。

报告中请提供：

- 受影响的提交、版本或文件
- 可复现步骤或最小化示例
- 潜在影响评估
- 你建议的修复方向（如有）

## 凭据与隐私

不要提交 API key、cookie、session、个人 WhatsApp 数据或任何生产配置。若凭据曾经进入 Git 历史，应立即在对应服务商处撤销并重新生成；仅删除文件不足以让凭据失效。

本扩展会读取当前 WhatsApp Web 会话数据，并在启用 dify / openai 等外部 provider 时将相关上下文发送到用户自行配置的 AI endpoint。默认 mock provider 不发送网络请求。使用前请完成隐私和合规评估。
