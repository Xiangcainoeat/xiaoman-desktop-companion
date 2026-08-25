# Security

This repository should contain no credentials, private source photographs, account identifiers, cookies, or machine-specific paths.

Before publishing a revision:

1. Inspect all staged files and generated archives.
2. Run the path and secret scans in `workflow/PROCESS.md`.
3. Confirm that `.env`, relay configuration, raw requests, and private references remain ignored.
4. Validate the pet and run all tests.
5. Rebuild `release/SHA256SUMS` after changing a package.

If a credential is committed, rotate it immediately. Removing it in a later commit does not remove it from Git history. Purge the secret from history before making the repository public.
