# Features and practical limits / 功能与边界

## Personal model URLs and keys

Every signed-in account can open 设置 → 我的模型连接 · 自定义 URL to add, edit or delete its own URL, API key and model IDs. There is no fixed provider list. Use a public HTTPS Base URL or a complete OpenAI-compatible Chat Completions/Responses endpoint; the matching path is normalized on save. Up to 12 connections and 24 models per connection are supported. Saving does not call a model. Select the saved “我的” provider at the top of normal or temporary chat to send a question.

Keys and connection contents are encrypted per account on the server and keys never return to the form, browser storage or chat request body. An unchanged endpoint may retain a blank key field; changing URL/protocol requires reentering your own key. Revision conflicts preserve drafts. Another account cannot view or use the connection. Deleting it preserves chat and does not silently reroute its next question. Existing shared providers remain available. When a saved endpoint or model disappears, its old selection remains marked unavailable. Reopening the chat cannot reuse another conversation's provider or pick the first remaining model. Send, Enter and parallel submissions are blocked before clearing drafts. The top model menu remains available for an explicit replacement, which opens a new conversation while preserving the original. Only enable images when the provider confirms support; submitted context follows that provider's retention policy and billing.

Private connections use direct public HTTPS with certificate checks. Local/private/reserved/metadata addresses, this server, URL credentials, query secrets and redirects are rejected. DNS results are all checked and the selected address is pinned for the actual socket connection. Private connections do not inherit site keys or change global proxies. Include the account-file connections directory AND connections.key encryption key in full private server backups; chat JSON alone does not back them up. Never publish these files.

## Revocable read-only text shares

Open input tools → 分享当前对话, or 设置 → 只读分享与撤销. All messages start unchecked. Select text, review the complete local preview, then confirm to upload a frozen snapshot with a 1-, 7- or 30-day expiry (default 7). Attachments, source IDs, account/project settings and later messages are excluded; personal information already in selected text still needs review. Limits: 100 messages/128 KiB per snapshot, 20 records/2 MiB per account and 8 MiB globally. Revoke expired records to free slots. Oversized snapshots are rejected rather than truncated.

Anyone holding the link can read it without signing in. Its random 256-bit secret is in the URL fragment, sent only in a request header without cookies; the server stores its SHA-256 digest. The link is displayed only after creation and cannot be recovered from the list. Revoke it from the account manager to deny future reads and remove the current snapshot. Already read/copied content and historical backups cannot be recalled. After restoring a full old server backup, review and revoke any restored shares. Normal deployment or code rollback must preserve current state. Public pages use no-store responses and revalidate on cached-page return or visibility changes.

## Temporary text chats

After signing in, choose 临时聊天 in the sidebar. The isolated page retains text only in its own memory. It does not use account history, memory, instructions, projects, files or code tools, or write drafts, backups and sync data. Closing, refreshing, leaving, cached-page return or account changes clear the temporary content. Stream, stop, explicit retry, multi-turn text and model output-token settings are available. Upstream providers may retain requests under their own policies; this is not a zero-retention promise. The site retains content-free runtime and usage metadata. Normal chat and its existing draft remain available when you return.

## Conversations

Each conversation has its own instructions, provider/model parameters, context preferences and draft. Modify-and-ask, continue-from-reply and regeneration create independent versions and preserve the original. Project inheritance shows a preparation state and rejects repeated clicks. Creating an edit/continue branch does not itself call a model; regeneration does.

Streaming retains received text after stopping or disconnecting. A retry is explicit. Queued generation is isolated by conversation; settings control concurrency. Input context has a budget, and long documents are searched for relevant fragments rather than guaranteed to be read completely in one request.

## Account-wide instructions

Use 设置 → 账户通用指令 to save default response preferences (up to 2,000 characters) for this account. Each conversation can opt out in 上下文范围. The server resolves the authenticated account and revision; a stale version is rejected before model access. Instructions are included in the input budget. Failed reads preserve the question; conflicting writes preserve the draft. Specific project, conversation and user requests take precedence over these defaults. Clearing and saving removes the text; pausing retains it. Conversation JSON contains only the opt-out switch; copy instruction text separately or privately back up the complete server state.

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

The external API setup panel lists site-token models only. Account-private connections remain available in signed-in normal/temporary chats; their internal IDs and keys are not accepted by the site-token `/v1` API.
