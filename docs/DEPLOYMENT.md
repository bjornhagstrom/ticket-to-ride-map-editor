# Deployment

## Target

- Public URL: <https://hagstrom.nu/ttr/>
- Hosting provider: Websupport
- Web root: `hagstrom.nu/public_html/ttr`
- Deployment type: static files under the `/ttr` path

The repository does not contain SSH private keys or passwords. Configure hosting access outside the project.

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
