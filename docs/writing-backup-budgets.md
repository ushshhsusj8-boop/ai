# Importing writing backups with current budgets

Refresh the page, open the writing canvas and choose Import writing backup. Select a JSON backup exported by this site, review the count and confirm.

The file preflight and UTF-8 parser now share a live limit of twice the current writing-library byte budget. Legacy settings still allow a 4 MiB file; a developer library budget of 32 MiB allows a 64 MiB backup file. Oversized files are rejected before reading, and the error shows the actual active limit.

This removes the obsolete fixed 4 MiB file gate that rejected legal larger backups exported by the same page. It does not increase note length, count or total-library budgets. Invalid or over-capacity batches leave the existing library unchanged.

Canceling performs no import. Identical title/content pairs are skipped; other notes receive fresh IDs while existing notes remain. Browser storage may be smaller than the configured budget, so keep the original backup if storage fails.

Exports include notes already loaded on this device. Sync first to include unread cloud changes. This patch does not import files automatically or modify chats and project files.

Regression tests cover live budget changes, exact size bounds, full Unicode restoration above 4 MiB, deduplication and atomic failures on note/total-storage limits.
