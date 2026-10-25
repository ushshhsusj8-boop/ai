# Personal connection cleanup after budget changes

Users can explicitly delete an old personal model connection after an administrator lowers connection or model-list budgets. Exact removals preserve every retained entry and reuse its encrypted key without returning it to the browser. Additions and mixed edits still follow current budgets, account checks and optimistic revisions.

The authenticated HTTP envelope uses a fixed 18 MiB storage-derived boundary. It no longer shrinks with unrelated memory settings or the newly reduced business budget. Oversized declarations still fail before their payload is read; same-origin checks, rate controls and post-read session validation remain.

Open My model connections, select the unwanted entry and confirm Delete. Existing chats, other connections and other accounts remain. New model requests cannot use a deleted entry.

Run node --test test/connection-cleanup.test.mjs. Tests cover count/model reductions, a 167568-byte real temporary-account HTTP request, unchanged retained keys, rejection of mixed edits and stale writes and foreign-account reads, and the hard transport boundary. No real provider or production account is used.
