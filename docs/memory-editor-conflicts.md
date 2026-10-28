# Memory editor conflict protection

Reload open tabs after updating. Selecting Edit captures that memory's text and priority as the editing baseline.

If another page or device changes the same entry, refreshing or reopening the dialog no longer lets an older editor silently overwrite the newer contents. Saving rejects the stale edit before a PUT and retains its text. Copy the draft, select the latest entry again, review both versions, then save. An entry deleted elsewhere cannot be resurrected by the stale editor.

Changes to other entries do not independently block saving. Newly read per-entry pause and global-off settings are retained. Existing server-side revision checks continue to protect changes made during a save request.

This does not automatically merge competing text edits. Unsaved memory edits remain in page memory and do not survive a page reload; copy important drafts before leaving.

Synthetic tests cover stale text and priority conflicts, deletion, baseline identity, sibling edits, privacy switches and explicit reselect/new-entry flows. Browser checks cover two tabs, reopen, refresh and desktop/mobile layout without real model calls or user code.
