# Prompt counts when restoring a workspace JSON backup

Refresh the page, open Backup and import, select a JSON backup exported by this site and import it.

The merged prompt count now uses the active prompt quota. Legal developer libraries above 30 prompts can be restored; a legacy quota of 30 still allows only 30. Overflow errors show the current quota, and rejected imports do not modify existing data.

Duplicate IDs retain the existing prompt content. New IDs are merged, and importing the same backup again adds no duplicates. For an active account cloud cache, its revision and baseline remain intact; a changed cloud cache still invalidates a stale preview before any write.

This patch only replaces the obsolete fixed merged-count check. Prompt text/byte limits, whole-batch validation, chat/preset/favorite rules and account isolation remain unchanged. The page reloads after a successful import.

Synthetic tests cover 31-prompt round trips, duplicate preservation, active cloud metadata and stale-preview protection, and exact custom/legacy quota boundaries.
