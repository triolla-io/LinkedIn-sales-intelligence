# Pre-deploy checklist (run before manual prod deploy)

Staging (`staging.triolla.io`) auto-deploys from `main`. Production (`sales.triolla.io`,
Coolify app `t4p27wvxs5r8kvv40xcvx2kg`) is **manual** — only deploy it after staging is green.

1. [ ] Feature branch merged to `main`; `npm run lint` and `npm test` clean.
2. [ ] Staging auto-deployed from `main` with NO boot failure — migration applied, no P3009, no 502.
3. [ ] If a new migration exists: it applied cleanly on staging's prod-shaped (anonymized) data.
4. [ ] Smoke test on `staging.triolla.io`: log in, main pages load, and one send per channel
       (LinkedIn / email / WhatsApp) arrives at your test targets
       (`ariel+*@triolla.io` inbox, your `STAGING_TEST_PHONE`, your controlled LinkedIn profiles).
5. [ ] No errors in the staging Coolify logs.
6. [ ] **THEN**: manual "Deploy" of the prod app (`t4p27wvxs5r8kvv40xcvx2kg`) in Coolify.
7. [ ] After prod deploy: `curl -s -o /dev/null -w "%{http_code}" https://sales.triolla.io` returns `200`;
       spot-check that Inngest functions registered under the **prod** environment.

> Why this order: migrations run on container boot (`prisma migrate deploy && npm start`). Letting
> staging boot first means a failing/drifted migration crash-loops *staging*, not prod — prod keeps
> serving the previous version until you deploy it deliberately.
