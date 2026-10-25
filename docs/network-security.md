# Network transport security regression

The lockfile pins undici 8.12.2. GHSA-xjj6-f33q-929c describes a malformed upstream response that can terminate Node despite a caught fetch error.

Run npm ci --ignore-scripts, then node --test test/undici-security.test.mjs. Each case uses an isolated child process, a temporary loopback server and synthetic credentials. It verifies that excessive compression codings plus an incomplete response fail cleanly, then a valid compressed JSON or streaming response succeeds through the workspace transport and actual gateway.

No real model, production account or user code is used. The child isolation lets a vulnerable version fail without terminating the test runner.

Official advisory: https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c
