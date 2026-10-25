# Large writing notes: reload and offline synchronization

Confirmed synchronization baselines now use the fixed stored-note boundary, including JSON escaping, instead of an obsolete fixed string length. A valid large note can be edited offline and synchronized after reopening without a false conflict. A confirmed offline deletion can reach the server after reopening without first downloading the deleted note again.

Normal note and account budgets, version checks and genuine conflict handling still apply. Two concurrent edits preserve both versions. The regression suite includes a 640004-character synthetic note and a real temporary-account HTTP integration.

Run node --test test/writing-large-sync.test.mjs test/writing-large-http.test.mjs.

If an older version already lost the baseline, first export local writing backups and use conflict handling to preserve both versions. The fix does not guess an already lost revision or automatically delete a note that an older client already downloaded again. No production account, real model or user code is used by the tests.
