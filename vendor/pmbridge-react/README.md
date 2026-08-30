# @triolla-io/pmbridge-react — vendored build

This is the **built** PM Bridge widget bundle, committed to this repo on purpose.

## Why it's vendored instead of installed

The package is private on GitHub Packages. Pulling it during the Docker build
required `NPM_GITHUB_TOKEN` at build time, and every time that PAT expired the
app's `npm ci` 401'd — which silently killed *every* prod deploy, not just the
widget (see commit `45ac527`, which removed the dep to unblock four dead
deploys). Vendoring the bundle removes the private registry from the build path
entirely.

The bundle is self-contained: `tsup.config.ts` lists all ten runtime deps
(radix-ui, motion, sonner, swr, date-fns, lucide-react, zod, cva, clsx,
tailwind-merge) under `noExternal`, so they are compiled in. Only `react` /
`react-dom` stay external. Adding this directory therefore adds **zero** npm
dependencies. `styles.css` is Tailwind v4 output with every selector scoped
under `.pmbridge`, so it cannot leak into the dashboard's styles.

## Provenance

| | |
|---|---|
| Source | `triolla-io/pm-bridge`, `packages/react` |
| Version | 0.1.1 |
| Commit | `cf93ed3` ("feat(jira): map AI issue types onto the project's actual scheme") |
| Vendored | 2026-08-30 |

`index.js.map` is deliberately **not** vendored (2.3 MB), and the trailing
`//# sourceMappingURL=` comment is stripped from `index.js` so Vite, Next dev,
and browser devtools don't log a failed map fetch. Build locally if you need to
step through the widget.

## Re-vendoring after a widget change

```bash
cd ~/pm-bridge/packages/react   # git pull first
npm install && npm run build
cp dist/index.js dist/index.d.ts dist/styles.css \
   ~/linkedin-sales-intelligence/vendor/pmbridge-react/
# drop the dangling sourcemap reference (the .map is not vendored)
sed -i '' '/^\/\/# sourceMappingURL=index.js.map$/d' \
   ~/linkedin-sales-intelligence/vendor/pmbridge-react/index.js
```

`tests/unit/pm-bridge-widget.test.tsx` renders this bundle for real — run
`npx vitest run tests/unit/pm-bridge-widget.test.tsx` after re-vendoring.

Then update the Version/Commit/Vendored rows above in the same commit.

The server side is untouched by any of this: `app/api/pmb-token/route.ts` mints
the JWT, and the Box at `pmbridge.triolla.io` holds the Jira/OpenRouter config.
