# Deployment

## Target

- Public URL: <https://hagstrom.nu/ttr/>
- Hosting provider: Websupport
- Web root: `hagstrom.nu/public_html/ttr`
- Deployment type: static files under the `/ttr` path

The repository does not contain SSH private keys or passwords. Configure hosting access outside the project.

## How it has been done

Over SSH with a key made for this site, `~/.ssh/<site-key>`, as `<account>@<ssh-host>`. The service listens on port **<port>** (<old-port> was used first and no longer answers). The host key is in `known_hosts`. `scp -r out/. <host>:hagstrom.nu/public_html/<new-directory>/`, then a checked `mv` swap, as in the procedure below. The site root, `hagstrom.nu/public_html`, is a WordPress install: only `ttr` and the `ttr-…` directories beside it are ours, and nothing else there is touched.

## Build

From the repository root:

```bash
npm install
npm run typecheck
npm run build
```

The final public files are created in `out/`. Check that `out/index.html` exists before uploading.

The `/ttr` base path is defined in `next.config.ts`. Changing the public path requires updating both `basePath` and `assetPrefix`, followed by a fresh build.

## Safe publication procedure

1. Build locally and stop if the build or type check fails.
2. Create a new uniquely named temporary directory beside the live `ttr` directory.
3. Upload the **contents** of `out/` into that temporary directory.
4. Verify that the temporary directory contains `index.html`, `_next/` and `favicon.svg`.
5. Rename the current live directory to a uniquely named backup.
6. Rename the temporary directory to `ttr`.
7. Request the public URL and confirm an HTTP 200 response.
8. Confirm that at least one referenced CSS asset and JavaScript asset also returns HTTP 200.

Do not upload source files, `node_modules/` or `.next/` into the public directory.

## Rollback

If the new version fails:

1. Rename the failed live `ttr` directory to a diagnostic name.
2. Rename the most recent known-good backup directory back to `ttr`.
3. Verify the public URL again.

Backups should not be deleted as part of routine publication. Remove them only through a separate, deliberate cleanup decision.

## Data safety

Publishing new static files does not normally remove users' maps because maps are held in browser storage. Data can still appear lost if the hostname, public path or local-storage key changes. Preserve all three unless a migration has been designed and tested.

Always export an important map as JSON before testing destructive editor changes.

## Publications

| Date | Source | Live directory was | Backup kept as |
| --- | --- | --- | --- |
| 2026-09-22 | made by an earlier session, over several rounds | `ttr` | `ttr-before-background-20260922`, `ttr-before-label-fix-20260922`, `ttr-before-free-label-20260922`, `ttr-before-formats-20260922`, `ttr-before-physical-sizes-20260922`, `ttr-before-starter-map-20260922` |
| 2026-10-01 | `main` at 376ee11 (code the same at 9d60fa9): Rules panel, PNG export, ticket panel, balance column and the work since | `ttr` from 2026-09-22 | `ttr-before-rules-20261001` |

For 2026-10-01 all 54 files were checked against their SHA-256 sums on the server before the swap, `out/` was scanned for names from the private reference data (none found), and afterwards the page, a CSS file, a JS file and `/ttr/about/` answered 200 and the live page was driven in a browser. No backup directory has been removed.
