# Security

## Report a vulnerability

If GitHub private vulnerability reporting is enabled, use this repository's Security tab → Report a vulnerability. If it is unavailable, open a minimal issue requesting a private reporting channel; do not include exploit details, secrets, account records or user documents. The maintainer will arrange a private discussion. No response-time commitment is promised.

## Boundaries

Provider credentials stay on the server in ignored files. Account/session checks and same-origin protections apply to private APIs. Use synthetic data when reproducing issues. Never attach production state, original-file archives or complete chat exports to a public issue.

The optional code runner is a separate Linux process with pinned images, a private socket, no network, a 20-second timeout and a 384-MiB memory limit. It must not execute automatically. Do not expose the Docker socket or runner API publicly.

## Deployment

Use HTTPS, disable local no-auth mode in production, restrict backend ingress and review reverse-proxy trust. Back up the complete private state directory and encryption keys privately. This source release does not include production infrastructure or credentials.

## Known dependency advisory

An npm audit on 2026-10-22 reports one moderate-severity advisory, [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), propagated through `mammoth` → `argparse` → `sprintf-js` (three affected package entries). It concerns unbounded precision in formatting strings. Application-level reachability has not been established. The audit tool proposes a major rollback of `mammoth`; that rollback has not been applied. Do not treat passing tests as a clean security audit.
