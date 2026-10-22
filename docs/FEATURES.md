# Features and practical limits / 功能与边界

## Conversations

Each conversation has its own instructions, provider/model parameters, context preferences and draft. Modify-and-ask, continue-from-reply and regeneration create independent versions and preserve the original. Project inheritance shows a preparation state and rejects repeated clicks. Creating an edit/continue branch does not itself call a model; regeneration does.

Streaming retains received text after stopping or disconnecting. A retry is explicit. Queued generation is isolated by conversation; settings control concurrency. Input context has a budget, and long documents are searched for relevant fragments rather than guaranteed to be read completely in one request.

## Accounts and explicit memory

Accounts separate private conversations, projects and other cloud data. Legacy shared conversation support is separate and never makes a new private account conversation public automatically.

Use 设置 → 长期记忆, or 保存为记忆 on a message, to review and explicitly save reusable background. No automatic scan or summarization of old chats is performed. The limits are 40 entries, 500 characters per entry and 12,000 characters total. A request selects up to eight entries and 4,000 formatted characters. Global and per-conversation switches are available. Editing a paused entry preserves its paused state.

Memory JSON import previews a merge before confirmation. Replacing the selected file cancels the old preview; a rejected replacement cannot confirm the previous file. Memory export is separate from conversation JSON.

## Projects and documents

Project instructions and enabled documents are shared only with associated conversations. A project holds up to three parsed documents; conversation/project retrieval jointly respects the document limit. Per file: up to 5 MiB and 120,000 parsed characters; PDF limit: 200 pages. Scanned/mixed PDFs display coverage and allow selected-page OCR, up to 20 pages per operation. OCR and supported file parsing run in the browser using locally served assets.

Search opens saved page/section snapshots with literal highlights. Citations refer to saved excerpts. Updates affect future requests, not already saved responses.

## Original files and backups

Original files require a separate explicit upload to the authenticated private vault. Account limits: 60 files and 64 MiB total; a ZIP restore archive is limited to 65 MiB. Restore validates the full archive, displays a preview and waits for confirmation. Identical files are skipped; conflicts reject the batch and keep existing files. A missing project is not recreated or guessed.

Original-file ZIPs contain original files only. Projects, parsed text, conversations, explicit memories and code-history backups have separate formats. Keep the complete private server state for disaster recovery. No source repository is a backup of user data.

## Writing and code

The writing canvas supports local editing, Markdown export, explicit account sync and conflict copies. Code history supports search and JSON import/export; cloud backup/restore is explicit. A configured runner accepts only a deliberate Run action and is restricted to 20 seconds, 384 MiB and no network. Generated attachments are not included in code-history cloud backups.

## Interface

Compact sidebar and message menus, input tool expansion, light/dark themes, text size, readable Markdown/math, CSV table export, keyboard controls and phone layouts are included. Browser speech recognition depends on browser support and permission; transcription enters a draft for review before sending.
