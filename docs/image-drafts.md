# Image draft preservation and recovery

Lower image budgets do not discard previously saved draft images. Stored images are read under the fixed storage boundary; exact removals can save even while the remaining images exceed the current budget. New additions, edits and sending still use current limits. Send validates images before clearing the image or text draft.

If image storage is unreadable, adding images cannot overwrite it. Use Download raw image drafts to preserve the original bytes locally. Explicitly confirmed Clear removes only the current account's unsent image cache in this browser. Cancel preserves it. Account changes or changes in another tab block stale cleanup; text drafts and sent chats stay intact. A raw export may contain broken data and is not a normal chat backup.

Run node --test test/image-draft-preservation.test.mjs for synthetic regressions covering count and edge budget reductions, strict new writes and sending, corrupted storage, confirmation races and account isolation.
