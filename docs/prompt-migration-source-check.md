# Legacy prompt migration and changes in another tab

Refresh the page, open the prompt library and choose Migrate legacy local library.

If the legacy source changes while the cloud read or confirmation is pending, migration stops. No stale snapshot is uploaded, the active local envelope is unchanged and the operation is not marked as migrated. Unreadable source data is also preserved rather than certified as migrated.

Save edits in other tabs, then explicitly retry. The retry takes a new source snapshot. Successful migration keeps the original legacy library and creates copies with new IDs where needed. Existing cloud version, account, capacity and conflict checks still apply.

The patch does not automatically repeat historical migrations or remove copies created before the fix. Regression tests use temporary accounts and real local HTTP routes to cover network-time changes, confirmation-time changes, successful retry, account isolation and corrupt source preservation. No external model request is made.
