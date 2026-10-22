# Recharge Tracker

React/Vite frontend deployed from `main` of `hannasaker/recharge-` to
https://recharge-pink.vercel.app through the existing Vercel GitHub integration.

```sh
npm ci
npm test
npm run lint
npm run build
npm run dev
```

Supabase configuration uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## Ledger loading

`src/lib/ledger.js` is the shared read path for initial loading, post-write
refreshes, payment allocation, and Google Sheets backup preparation. It reads
customers, recharges, payments, and services in deterministic ID order with
500-row pages and exact counts. Missing counts, truncated pages, duplicate IDs,
request errors, and changes observed between two complete scans reject the load.
Only a complete successful ledger is published to React, together as one state.

A request generation prevents older successes and failures from replacing newer
results. Writes lock dependent actions, invalidate outstanding reads, and always
reload afterward, including after a failed or partially completed write. Logout
and account changes invalidate outstanding loads and write completions. Token
refresh for the same user does not restart the ledger load. Reads time out after
30 seconds; loading and failed states hide balances, statements, exports, and
backup actions. Retry performs a fresh complete load.

Two matching REST scans detect observed concurrent edits; they are not a database
transaction or a guarantee against other clients editing immediately afterward.
A database snapshot/RPC would be needed for that stronger guarantee. Existing
payment arithmetic and database write operations remain unchanged.

The incident's exact live cause was not established. The original competing read
paths allowed stale responses to overwrite newer results. The reported 984
recharges were below Supabase's default 1,000-row cap; the cap was not established
as the incident's cause.

## Verification and deployment

Tests mock Supabase and block external fetches. They cover delayed/out-of-order
responses, logout and same-user re-login, failed loads and Retry, write locking
and reload after failure, timeouts, pagination beyond 1,000 rows, completeness
failures, and backup rejection. They do not mutate production records or submit
a Google Sheets backup. The existing Sheets endpoint uses `no-cors`, so sending
a backup still requires checking the Sheet to confirm receipt.

A successful push to `main` should create a Vercel production deployment. Verify
GitHub's Vercel status for that exact SHA and the assets served from the production
homepage. If no deployment starts, open Vercel project `recharge` in team
`hannasakers-projects`, check its Git connection/production branch, and deploy
the intended `main` SHA. A clean working tree or an up-to-date push alone does not
show that a new version has been deployed.
