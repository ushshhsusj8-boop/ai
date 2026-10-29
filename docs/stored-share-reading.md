# Reading stored shares after creation quotas change

Previously valid, unexpired and unrevoked read-only share links remain readable after an administrator lowers the creation message-count or byte budget. Refresh the share viewer to load the updated code.

Stored snapshots are validated against the finite stored-data hard bounds. New snapshot previews and server-side creation still enforce the current policy. Structural validation, allowed roles, expiry and revocation checks remain in place; text is not truncated.

Lowering creation quotas does not revoke existing links. To stop access, use the owner's share management panel to revoke the specific share. This change does not extend expiry, restore revoked links, create new shares or append later chat messages.

Synthetic browser checks cover old message/byte budgets, unchanged text, current creation limits, stored hard bounds, invalid roles, expiry/revocation and desktop/mobile layout. Real accounts, model calls and user code are not used.
