# Contributing

Thank you for helping improve plaude chat. This is an early source project; begin with a focused issue or change.

## Report an issue

Use the issue template and include browser/OS, steps, expected behavior and actual behavior. Use synthetic accounts, prompts, files and screenshots. Never post credentials or private user data. Discuss security-sensitive findings privately as described in SECURITY.md.

## Develop

Use Node.js 24+. Install with `npm ci --ignore-scripts`, then run `npm run check` and `npm test`. Tests use mocked provider transports and temporary directories; no real provider key or cloud deployment is required. Linux-specific filesystem tests skip on Windows.

Keep changes focused. For a reproducible defect, explain its trigger and include a meaningful regression check. Preserve account ownership, sync revisions, draft recovery, restore atomicity, and explicit confirmation for data writes and code execution. Do not weaken execution or input limits to make tests pass.

## Pull requests

Describe the problem, behavior after the change and relevant verification. AI-assisted contributions are welcome when the author reviews and tests them; explain material generated changes. Contributions are submitted under the project's MIT license. Preserve third-party notices.

## 中文

欢迎使用合成资料提交可复现问题。先运行语法检查和测试，不使用真实模型或用户资料做回归。提交说明应包含问题、修改后的行为与验证结果；敏感漏洞按SECURITY.md私下沟通。
