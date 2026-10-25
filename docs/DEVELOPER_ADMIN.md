# Site owner, administrators and developer budgets

Register and sign in to an account on your own installation first. Ordinary registration and the shared gateway invitation never grant administrator access.

In a trusted shell on the same installation, after a private state/configuration backup, load the same environment file used by the server:

```powershell
node --env-file=.env src/site_owner.mjs --issue-code
```

This prints a one-time setup code valid for 30 minutes. Keep it private. On the website open 设置 → 绑定站点所有者, enter the code and bind the currently signed-in account. The code is stored only as a digest; expired/reused codes and a second ownership claim are rejected. Do not add this code, account files or the permission sidecar to source control. The CLI also supports binding an existing local username directly; only use it in a trusted administrator shell.

The owner may assign or revoke administrators by an existing website username. Administrators may edit shared budgets; this role does not grant reading another account's conversations, memories, documents or API keys. The owner cannot be removed through the administrator toggle. Conflicts reject stale revisions, and corrupt permission files fail closed without being overwritten.

Open 设置 → 站点管理 to inspect the configured policy and choose a preset or edit fields within the displayed hard resource bounds. With no permission file, the application reads the developer preset without automatically assigning an owner. Site policy governs the normal server's shared usage budgets; old gateway environment examples alone do not describe all active limits.

Developer defaults include no extra daily request/token/code-run soft quota, concurrency 4, a ten-minute request timeout, a 262,144-character composer, 1,000,000 input characters and 256 input messages. Search/tool budgets of zero delegate to the provider. OpenRouter integration bounds results at 25 per search and tool processing at the provider's 30-step maximum. It is not an unlimited-provider, free-usage or model-capability promise. Provider windows, output budgets and available credits still apply.

Document, OCR, image, memory, project, draft, conversation, vault, prompt, writing, history, private-connection and sharing budgets are configurable from the same policy. See [features](FEATURES.md) and `public/site_limits.js` for the implemented preset and finite bounds. Code execution still requires explicit Run, an independent Linux executor, 20 seconds, 384 MiB and no network.

Include the entire private state directory, encrypted connection records and their encryption key, workspace keys, and the account permission/policy sidecar in private backups. Chat JSON and original-file ZIPs are not full server-state backups. A code-only upgrade or rollback must preserve current account, policy, deletion and share-revocation state. Never restore old permissions or active shares merely to roll back code.

Lowering a budget does not erase stored data. Clear old data only through its explicit user operation. Large memory-disable and account-instruction-disable requests use a finite compatibility envelope before current business validation. A share revocation must remain possible when other old shares still exceed a newly lowered budget. Old libraries and files may be reduced without adding/editing or enabling over-budget data. Retained text and other accounts stay intact.

This repository contains implementation and synthetic tests only. It does not ship a hosted owner's account, permission file, setup code, credentials, private infrastructure, live data or deployment history.
