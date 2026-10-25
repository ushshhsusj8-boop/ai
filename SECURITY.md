# Security

## Report a vulnerability

If GitHub private vulnerability reporting is enabled, use this repository's Security tab → Report a vulnerability. If it is unavailable, open a minimal issue requesting a private reporting channel; do not include exploit details, secrets, account records or user documents. The maintainer will arrange a private discussion. No response-time commitment is promised.

## Boundaries

Provider credentials stay on the server in ignored files. Account/session checks and same-origin protections apply to private APIs. Use synthetic data when reproducing issues. Never attach production state, original-file archives or complete chat exports to a public issue.

The optional code runner is a separate Linux process with pinned images, a private socket, no network, a 20-second timeout and a 384-MiB memory limit. It must not execute automatically. Do not expose the Docker socket or runner API publicly.

## Deployment

Use HTTPS, disable local no-auth mode in production, restrict backend ingress and review reverse-proxy trust. Back up the complete private state directory and encryption keys privately. This source release does not include production infrastructure or credentials.

## Dependency review

On 2026-10-25 this source snapshot pins undici to 8.12.2. It addresses the upstream advisories [GHSA-xjj6-f33q-929c](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c), [GHSA-4qv8-2p9j-2685](https://github.com/nodejs/undici/security/advisories/GHSA-4qv8-2p9j-2685) and [GHSA-f72v-6w45-q472](https://github.com/nodejs/undici/security/advisories/GHSA-f72v-6w45-q472). A fresh npm audit after the patch reports zero known vulnerable packages. This is a dated registry check, not proof that the application has no vulnerabilities; review updates and test upgrades regularly. No production deployment is bundled with this source update.

## Shared snapshot access

Sharing requires explicit selection, local preview and confirmation. The public reader uses a bearer secret, not account authorization; anyone given the full link can read its selected text until expiry or revocation. Secrets have 256 bits of entropy, stay out of URL request paths and are stored only as SHA-256 digests. Private creation/list/revocation require the authenticated owner and same-origin checks. Account revisions and request IDs reject stale writes and duplicate creation. Untrusted Markdown is rendered safely, public fetches omit cookies, and pages/APIs use no-store. Revocation denies future reads and erases the current snapshot, but cannot erase screenshots, downloaded copies or historical backups. Restoring an old complete state backup may restore formerly active links: review and revoke restored records before reopening access. Code-only rollback must not restore old state.

## Account-controlled upstream model services

Each authenticated owner may save personal public HTTPS model endpoints and their own keys. Requests resolve credentials server-side under the current account and connection revision. Connection files use AES-256-GCM with owner-bound authenticated data and a separate private encryption key. Missing keys or corrupt files fail closed without overwriting old data. Private clients never inherit shared provider keys. Endpoint/protocol edits require reentering a key. Actual outbound sockets use a validated pinned public IP, TLS verification, no proxy inheritance and no redirects; mixed public/private DNS answers and local/metadata/reserved destinations are rejected. Use trusted providers: selected chat context is intentionally sent to the chosen service. Full private backup restoration must retain both encrypted connection records and their encryption key; never attach them to issues or public source.

## Administration and data-preserving cleanup

Owner binding requires an explicit existing account and a one-time 30-minute code generated in a trusted shell. The server stores only its digest; ordinary registration and shared invitation tokens grant no administrative role. Role/policy sidecars stay private, use revision checks and atomic writes, and fail closed on corruption. Administrator status controls shared budgets, not access to other owners' data or keys.

Lowering a budget must not prevent revoking an existing share or turning off retained private context. Compatibility requests retain finite hard HTTP bounds, authenticated ownership and revision validation. The application permits only the implemented data-reducing/disable transitions above new business budgets. New/edited/re-enabled data and new shares still follow current business validation.
