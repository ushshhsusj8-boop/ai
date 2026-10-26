# Canonical personal API URLs

Refresh the page and open Settings > My model connections. Public HTTPS Base URLs and full Chat Completions or Responses endpoints remain supported without a provider allowlist.

Unicode paths are percent-encoded and the selected protocol suffix is appended. Validation and the URL form now share a limit of 18,464 characters for the complete encoded endpoint, including that suffix. This accommodates previously accepted 2,048-character Unicode inputs after expansion. Longer normalized results are rejected before persistence; the existing encrypted list is retained.

Previously stored expanded URLs can be read, reopened, renamed with an unchanged blank key, and explicitly deleted. The patch does not rewrite existing connection files merely by reading them. Changing the destination or protocol still requires a new key.

Account/revision checks, AES-GCM storage, HTTPS-only destinations, DNS pinning, blocked private addresses and redirect rejection remain in place. A provider may impose a smaller URL limit.

Regression tests use synthetic accounts, authenticated legacy envelopes, actual temporary HTTP routes and mocked transport. They cover both protocols, suffix expansion, key and sibling preservation, oversized writes, stale revisions and foreign-account reads. No external model request is made.
