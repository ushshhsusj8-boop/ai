# plaude chat

一个可自行部署的多模型 AI 聊天工作空间，使用 Node.js 和浏览器原生 JavaScript。

[English](README.md) · [安装与资料保管](docs/SETUP.md) · [功能与边界](docs/FEATURES.md)

支持流式回复、失败重试、独立对话指令、多段生成队列、分支与版本；个人账户、项目资料、提示词库、写作画布和明确保存的长期记忆可跨设备同步。资料可按页或段落搜索、阅读原文，PDF 可手选页面 OCR；原文件支持私有保管与 ZIP 备份、预览确认恢复。

支持勾选文字、本机预览后创建限时只读分享，并在账户内撤销。持链接者可读，已阅读或复制的内容无法追回。

界面提供输入框展开工具、深浅主题、公式显示、表格 CSV、键盘操作和手机布局。可选的 Linux 代码执行器独立配置，只有明确点击运行才会执行。

## 本机启动

安装 Node.js 24 或更新版本。Windows 命令使用 PowerShell 7：

```powershell
npm ci --ignore-scripts
Copy-Item .env.example .env
New-Item -ItemType Directory -Force secrets | Out-Null
node -e "require('node:fs').writeFileSync('secrets/gateway_access_token',require('node:crypto').randomBytes(32).toString('hex'))"
```

将自己的 DeepSeek API Key 写入 `secrets/deepseek_api_key` 文件，再运行 `npm run dev`，打开 `http://127.0.0.1:3000/`。其他服务商按[安装说明](docs/SETUP.md)设置。密钥留在本机，不提交到 GitHub。服务商费用与会员订阅分别计算。

## 验证

运行 `npm run check` 和 `npm test`。初始源码共346项测试；Windows 342通过、4项Linux专属跳过。测试使用临时合成资料和模拟模型，无需真实服务商凭据。仓库提供Windows/Linux CI配置，是否执行通过以实际Actions结果为准。

## 开源范围

本仓库从经审查的0.2.0源码快照开始，自有代码采用MIT许可证。早期私有运维历史、生产凭据、账户、聊天、上传资料、服务器地址及备份不在公开范围。第三方组件保留原许可证。

目前属于早期公开源码项目，尚未核实外部用户或下载量，不宣传不存在的社区规模。`package.json` 的 `private:true` 用于防止误发npm包，不影响GitHub开源。

模型能力、文档读取和备份边界见[功能说明](docs/FEATURES.md)。欢迎以合成数据提交可复现问题。
