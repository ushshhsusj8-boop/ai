# Cloud project offline cache freshness

Reload all open tabs after updating. The project workspace caches the newest confirmed account snapshot for offline viewing. Editing and sending project materials still require a connection.

Delayed older responses no longer replace a newer snapshot already confirmed by another tab. The IndexedDB comparison and write use one read/write transaction; a newer deletion therefore cannot be resurrected by an older response. Invalid cached envelopes cannot block valid server responses. When IndexedDB is unavailable, the same page also retains its highest confirmed online revision.

The cache contains only previously read data, and may not include newer changes on another device. It does not replace JSON or original-file backups. Account isolation, authorization failures, server-side optimistic concurrency and local editing drafts retain their existing behavior.

Regression tests cover out-of-order reads, shared-cache deletions, unavailable storage and malformed cached data. Synthetic browser checks also exercise overlapping transactions across tabs, offline page reloads and desktop/mobile layout. No real models or user code are executed.
