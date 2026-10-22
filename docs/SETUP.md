# Setup, persistence and production

## Local development

Use Node.js 24+ and run `npm ci --ignore-scripts`. Copy `.env.example` to `.env`, create `secrets/`, and generate a random gateway token of at least 32 characters. Put your own provider key into one matching ignored file:

| Provider | Key file | DEFAULT_PROVIDER |
| --- | --- | --- |
| DeepSeek | secrets/deepseek_api_key | deepseek |
| NVIDIA | secrets/nvidia_api_key | nvidia |
| OpenRouter | secrets/openrouter_api_key | openrouter |
| Google Gemini | secrets/gemini_api_key | gemini |
| OpenAI | secrets/openai_api_key | openai |

Uncomment the matching `*_API_KEY_FILE` setting where needed. At least one provider key and the gateway token are required. The default provider must be configured. Start with `npm run dev`, then open `http://127.0.0.1:3000/`.

The local example uses `LOCAL_DEV_NO_AUTH=1` only with a non-production environment and a loopback bind. To create an account, use the generated gateway token as the invite code. A hosted installation requires HTTPS and authenticated access.

The OpenAI provider is optional. Tests do not use a real OpenAI API key. ChatGPT subscriptions and provider API access have separate billing and limits.

## Production

Use `NODE_ENV=production`, `LOCAL_DEV_NO_AUTH=0`, a strong gateway token, and a same-origin HTTPS reverse proxy. Restrict direct access to the backend. Configure proxy trust only when your trusted proxy is the immediate upstream.

`deploy/Caddyfile.example` demonstrates an HTTPS reverse proxy on a placeholder domain. The optional Compose example binds the backend only to `127.0.0.1:3000`; configure your own HTTPS proxy. This repository does not install or start Docker, a proxy, an executor or a cloud service automatically.

Use one writer for each file-based account/state store. Protect and back up the whole state directory together; do not copy only `accounts.json`. Workspace encryption settings and keys, if used, must also be backed up privately. Data backups are separate from source control.

`MAX_OUTPUT_TOKENS=0` leaves the site-wide output-token ceiling unset. Provider/model limits, request timeout, input limits and storage protection still apply. Users may choose a per-conversation output budget where supported.

## Optional code runner

The web application and Linux code runner are separate processes. The feature is disabled without `CODE_RUNNER_SOCKET`. Configure pinned Python/Java image digests and a private Unix socket only on an isolated Linux host. Preserve the implemented 20-second / 384-MiB / no-network restrictions. Review `src/code_runner.mjs` before deployment. Do not expose the socket or Docker daemon to the browser or public network.

## Windows commands

Use `pwsh.exe -NoLogo -NoProfile` for automation. `start-local.ps1` is an optional foreground launcher; it does not install a service or create a startup task. The documented `npm run dev` command is sufficient.
