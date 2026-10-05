# Deployment

## Target

- Public URL: <https://hagstrom.nu/ttr/>
- Deployment type: static files under the `/ttr` path (`output: "export"` in `next.config.ts`)

The repository holds no SSH keys, passwords, account names or server layout. Hosting access is set up
outside the project, and each publication is recorded in the owner's private notes, with the name of
the backup it leaves behind.

## Build

From the repository root:

```bash
npm ci
npm test
```

`npm test` runs the type check, lint, the suites and the production build. The final public files are
created in `out/`. Check that `out/index.html` exists before uploading.

The `/ttr` base path is defined in `next.config.ts`. Changing the public path requires updating both
`basePath` and `assetPrefix` (and the two icon links in `app/layout.tsx`), followed by a fresh build.

## Before every release

The site is in use and has been announced, so a release is tested more than a commit is:

```bash
npm test                                   # type check, lint, unit suites, production build into out/
npm run dev &                              # then, with the dev server at localhost:3000/ttr/:
node tests/regression.cjs                  # the regression suite in Chromium

# the production build, served under /ttr as on the server
mkdir -p /tmp/ttr-serve && ln -sfn "$PWD/out" /tmp/ttr-serve/ttr
(cd /tmp/ttr-serve && python3 -m http.server 4173 &)
TTR_URL=http://localhost:4173/ttr/ node tests/regression.cjs
npx playwright install webkit              # once
TTR_BROWSER=webkit TTR_URL=http://localhost:4173/ttr/ node tests/regression.cjs
```

In WebKit a few checks are Chromium's own and are skipped, each listed with its reason at the end of
the run (Safari gets a print profile of its own; only Chromium saves a PDF). Then walk through the
production build by hand: the welcome box and its video, the example map, drawing, tickets and a full
deck, Map balance, the print dialog with every part, export and import of a map file, Start over.
Only then, and with the owner's go, publish.

## Safe publication procedure

1. Build locally and stop if the type check, a test or the build fails.
2. Look through `out/` for anything that should not be public: no data files, and no names taken from
   the private reference data.
3. Create a new, uniquely named temporary directory beside the live `ttr` directory.
4. Upload the **contents** of `out/` into that temporary directory.
5. Compare a checksum of every uploaded file with the local one, and verify that the temporary
   directory contains `index.html`, `_next/` and `favicon.svg`.
6. Rename the current live directory to a uniquely named backup.
7. Rename the temporary directory to `ttr`.
8. Request the public URL and confirm an HTTP 200 response, and the same for a CSS file, a JavaScript
   file, `/ttr/about/` and `/ttr/whats-new/`.
9. Open the live page in a browser: the example map loads, and the console shows no errors.

Do not upload source files, `node_modules/` or `.next/` into the public directory.

## Rollback

If the new version fails:

1. Rename the failed live `ttr` directory to a diagnostic name.
2. Rename the most recent known-good backup directory back to `ttr`.
3. Verify the public URL again.

Backups should not be deleted as part of routine publication. Remove them only through a separate,
deliberate cleanup decision.

## Data safety

Publishing new static files does not normally remove users' maps because maps are held in browser
storage. Data can still appear lost if the hostname, public path or local-storage key changes. Preserve
all three unless a migration has been designed and tested.

Always export an important map as JSON before testing destructive editor changes.
