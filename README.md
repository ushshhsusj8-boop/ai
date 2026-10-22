# plaude chat

A self-hosted, multi-provider AI chat workspace built with Node.js and browser-native JavaScript.

[中文说明](README.zh-CN.md) · [Setup](docs/SETUP.md) · [Features and limits](docs/FEATURES.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## What it does

- Stream responses, keep separate conversation instructions, retry interrupted questions and navigate conversation branches.
- Use private accounts with cross-device chat, project, prompt-library, writing-canvas and explicit long-term-memory sync.
- Keep shared project instructions and documents; search parsed text and open cited pages or sections.
- Read PDF, DOCX and text documents, with optional browser OCR for selected PDF pages.
- Store original files privately, download ZIP backups and preview a same-account restore before confirming.
- Use Markdown, math, CSV table export, themes, keyboard controls and a compact mobile layout.
- Optionally connect an isolated Linux Python/Java runner. Running code always requires an explicit user action.

Provider adapters include DeepSeek, NVIDIA, OpenRouter, Google Gemini and OpenAI Responses. Features depend on the configured provider and model. Bring your own provider key; no subscription, provider quota or hosted account is bundled.

## Run locally

Requirements: Node.js 24 or newer and npm. PowerShell examples use PowerShell 7 (`pwsh`).

```powershell
npm ci --ignore-scripts
Copy-Item .env.example .env
New-Item -ItemType Directory -Force secrets | Out-Null
node -e "require('node:fs').writeFileSync('secrets/gateway_access_token',require('node:crypto').randomBytes(32).toString('hex'))"
```

Write your own DeepSeek API key into `secrets/deepseek_api_key`. The default provider is `deepseek`; see [Setup](docs/SETUP.md) for alternatives. Keep these files local.

```powershell
npm run dev
```

Open `http://127.0.0.1:3000/`. The example configuration binds to loopback. A provider key is required to start the application. Tests need no provider credentials.

## Verify

```powershell
npm run check
npm test
```

The current source contains 338 tests. On Windows, 334 pass and four Linux-specific tests are skipped. Tests use temporary data and mocked model transports. CI is configured for Windows and Linux; a configured workflow is not evidence that a hosted CI run has already passed.

## Data and scope

This repository begins with a reviewed source snapshot based on version 0.2.0. Earlier private operational history is not included. It contains application source and synthetic tests, with no production accounts, chats, files, keys, server addresses or deployment backups.

This is an early public-source project. No third-party adoption or download numbers are claimed. The npm `private` flag prevents accidental npm package publication; it does not control GitHub visibility or the MIT license.

See [Features](docs/FEATURES.md) for practical limits and [Setup](docs/SETUP.md) for persistence and production settings.

## License

Project code is available under the [MIT License](LICENSE). Bundled and installed dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
