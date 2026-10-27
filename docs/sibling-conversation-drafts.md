# Retaining drafts from different browser tabs

Refresh all open tabs before using the updated page.

Previously, editing one conversation in a stale tab replaced the entire draft map and could discard another tab's saved draft for a different conversation. The page now retains its last successful baseline, reads the latest map and merges only entries changed by that page. Successful storage writes update the baseline; failed writes leave the current textarea usable.

Other tabs' newly saved drafts count toward the current draft-count budget. An addition that would exceed that budget is refused without evicting saved drafts. Existing over-budget entries may still be edited or removed.

This fixes stale whole-map replacement during interleaved tab edits. It is not a transactional cross-process lock or real-time collaborative editing: the same conversation still shares one draft slot. Sent chat history, image drafts and other account scopes are unchanged. Text overwritten by an older version cannot be reconstructed.

Synthetic tests cover interleaved edits/clearing, unchanged stale pages, prototype-like keys and count boundaries. Two-tab browser checks cover actual input events, reloads, storage failures and quota exhaustion without model calls or real account data.
