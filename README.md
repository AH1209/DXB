# DXB

A single-user, code-protected notification simulator for iPhone and desktop. Built with React, TypeScript, Vite, Tailwind CSS, Lucide, Framer Motion, Netlify Functions, Supabase PostgreSQL/Storage, and VAPID Web Push. There are no AI dependencies, messaging services, generated dialogues, or functional conversations.

**Delivery status:** implementation is ready for service configuration. Supabase credentials, a Netlify deployment, VAPID keys, and an enabled Cron job are required before it can operate. No cloud resources were provisioned and no real iPhone push delivery is claimed. An unconfigured instance displays a setup error; it does not substitute local fake persistence or fake notification success.

## Project location

The requested Windows Desktop was resolved through `[Environment]::GetFolderPath('Desktop')`. The project is delivered at `C:\Users\aboud\Desktop\DXB`. The previous messaging application was not modified.

## Quick start

Install Node.js 22 LTS or newer compatible with Vite, with npm. In PowerShell:

```powershell
Set-Location (Join-Path ([Environment]::GetFolderPath('Desktop')) 'DXB')
npm install
Copy-Item .env.example .env
```

Complete the Supabase and environment steps below, then:

```powershell
npm run dev
```

Open `http://localhost:8888/?sw=1`. `?sw=1` explicitly registers the service worker for local Netlify Dev. Production registers it automatically. Local development still uses your configured Supabase project and real protected functions; use a separate development Supabase project. `npm run dev:ui` alone serves only the frontend and cannot authenticate or persist data. Netlify Dev invokes npm internally, so npm must be available on PATH.

The development access code defaults to **1509**. Set `ACCESS_CODE=1509` explicitly in Netlify to match the requested access code. It is read only by the backend; the frontend submits entered digits to `/api/login`.

## 1. Configure Supabase

1. Create a new Supabase project. Save its database password securely. Do not reuse the previous messaging app's database unless you have intentionally reviewed the migration names and tables.
2. In the SQL Editor, run `supabase/migrations/001_dxb.sql` once. This creates tables, indexes, constraints, server-only RPCs, and RLS protections. Then run `supabase/migrations/002_storage.sql` once to create the private `avatars` bucket.
3. In project settings, copy the project URL and the **server-only service-role key**. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env` locally and in Netlify's environment settings. Do not use `VITE_` prefixes and do not put the key into browser code.
4. Enable `pg_cron` and `pg_net` in Database → Extensions. Ensure Supabase Vault is available. Do not enable the Cron job until Netlify is deployed.
5. Check that the eight application tables have RLS enabled. There are intentionally no `anon` or `authenticated` policies and no browser grants. Browser requests go through Netlify's cookie-protected API. The storage bucket remains private; avatar reads are proxied through the same protected API.
6. Review project backups, region, quotas, and availability. Keep the database running during notification sessions. Paused projects cannot dispatch.

These migrations are for a fresh schema and intentionally do not drop existing tables. If a migration partially fails, inspect the SQL error before rerunning; do not blindly delete user data.

## 2. Generate keys and set environment variables

```powershell
npm run vapid
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use the first random secret for `SESSION_SECRET` and the second for `DISPATCH_SECRET`. Never commit `.env` or live secrets. VAPID generation prints a private key; store it securely. Keep the VAPID pair stable across deployments or repair subscriptions after rotation.

| Variable                    | Value                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`              | Your project's HTTPS URL                                                                             |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service-role credential                                                                  |
| `ACCESS_CODE`               | `1509`, verified by the backend                                                                      |
| `SESSION_SECRET`            | At least 32 random characters; used to hash rate-limit IP identifiers                                |
| `DISPATCH_SECRET`           | A separate high-entropy secret shared with Supabase Vault                                            |
| `APP_ORIGIN`                | Exactly `https://YOUR-SITE.netlify.app` or your HTTPS custom origin; locally `http://localhost:8888` |
| `VAPID_PUBLIC_KEY`          | Generated public key; only this key is returned to the browser                                       |
| `VAPID_PRIVATE_KEY`         | Generated private key, server-only                                                                   |
| `VAPID_SUBJECT`             | `mailto:you@example.com` using your real contact address                                             |

Use one canonical production origin. Deploy previews need a separate configuration and database if used; they should not share production Cron or subscriptions. Never place secrets in URL query parameters, source control, or browser storage.

## 3. Configure and deploy Netlify

1. Put this source in a private Git repository and connect it to a new Netlify project, or use Netlify CLI from this folder. Include `package.json`, the lockfile, `netlify.toml`, `src`, `server`, `public`, and `netlify/functions`.
2. Set build command **`npm run build`**, publish directory **`dist`**, and functions directory **`netlify/functions`**. `netlify.toml` already declares these. Use Node 22. Netlify must build functions on its Linux build host, including Sharp's native dependency.
3. Add the environment variables above to the Functions runtime scope (and local development scope if desired). None are required as public Vite variables. Set `APP_ORIGIN` to the final HTTPS origin with no path.
4. Deploy. Keep HTTPS enabled. Do not publish only the `dist` directory using a static drag-and-drop deployment; that would omit the backend functions.
5. Open the HTTPS site. Unlock using `1509`; create one contact, refresh, and confirm the contact persists. An incorrect code should fail. Logged-out calls to `/api/bootstrap` must return 401 once server configuration is present.
6. Check Netlify Functions logs for `api` and `dispatch`. Do not log request bodies, cookies, push endpoints, or keys.

Optional CLI deployment after linking your account/project:

```powershell
npx netlify login
npx netlify init
npx netlify deploy --build --prod
```

Do not deploy the locally generated `.netlify/functions-build` directory: local validation packages may contain Windows-native modules. Let Netlify build from source.

## 4. Enable the persistent dispatcher

1. In Supabase Vault, create `dxb_origin` with the final HTTPS origin, and `dxb_dispatch_secret` with the same value as Netlify `DISPATCH_SECRET`. Use Vault's UI or a private SQL session. The committed Cron SQL contains no secret values.
2. Run `supabase/cron.sql` once. It uses `pg_net` to POST to `/.netlify/functions/dispatch` every **30 seconds** with a Bearer secret read from Vault.
3. If your `pg_cron` version does not support seconds intervals, replace `'30 seconds'` with `'* * * * *'` before running. This fallback dispatches once per minute and can group more notifications together.
4. Inspect `cron.job`, `cron.job_run_details`, and `net._http_response`. A successful Cron SQL invocation alone does not prove a successful HTTP request. Check HTTP status and response content.
5. Avoid multiple named jobs for the same app. Reusing the `dxb-dispatch` job name updates its schedule. Disable it with `select cron.unschedule('dxb-dispatch');` when taking the deployment offline.

The dispatch endpoint rejects GET requests and incorrect secrets. No browser timer creates or sends scheduled events. Supabase database time is authoritative. With a 30-second interval, most accepted requests occur after the intended event time by up to one interval plus network/worker latency. Push service/device delays are additional.

## 5. Install on iPhone

1. Use iOS **16.4 or later**.
2. Open the deployed HTTPS address in Safari.
3. Share → **Add to Home Screen**. Keep **Open as Web App** enabled if your iOS version offers it. The provided DXB monogram should appear as the icon.
4. Open DXB from that Home Screen icon and unlock.
5. Settings → **Enable / repair notifications** → allow the system prompt. Permission is requested only after this action.
6. Run **Send Test Notification**. “Accepted” means the push service accepted the request, not that the device displayed it.
7. Run **Delayed Background Test**, close DXB, and lock the phone. Expect the test after approximately one minute plus the Cron interval and device/network delay.

When permission is denied, change it in the operating system's notification settings. DXB cannot silently re-enable it. On browsers that require installation for push, a regular Safari tab is insufficient.

## Background verification checklist

- [ ] Correct original icon on the Home Screen; standalone launch has no browser toolbar.
- [ ] Permission says granted and this device says active in Settings.
- [ ] Immediate test returns submitted and appears on the device.
- [ ] Delayed test arrives after closing DXB and locking the phone.
- [ ] Repeat with the PWA removed from the App Switcher; record actual OS behavior.
- [ ] Run a one-hour session with at least one awake contact. Close all tabs. Verify submitted timestamps in Supabase continue advancing.
- [ ] Reopen DXB: the same session ID, start time, end time, and saved schedule remain.
- [ ] Stop a session. Pending/claimed deliveries cancel; allow already in-flight or submitted requests to arrive.
- [ ] Let a session expire with DXB closed. Confirm server status becomes completed and no new sends are authorized.
- [ ] Compare awake and sleeping contacts over enough events to observe the statistical reduction.
- [ ] Test denied permission, network interruption, expired subscription, and repair registration.
- [ ] Inspect failed/unknown deliveries and Cron HTTP logs; do not infer delivery from UI toasts.

## Architecture and reliability

`React → protected Netlify API → Supabase` stores contacts, preferences, hashed access sessions, subscription endpoints/keys, notification sessions, events, and per-device delivery attempts. `Supabase Cron → protected dispatch function → Web Push service → service worker` handles background display.

- The access code is checked server-side with fixed-length hash comparison. Random 256-bit opaque session tokens are stored only as SHA-256 hashes in the database. The browser receives an HttpOnly, SameSite=Strict cookie, Secure in production, lasting 30 days. Mutations require an exact Origin match.
- Login attempts are atomically limited in Postgres to five per IP identifier per 15 minutes, plus a global limit of 30. IP identifiers are HMAC-hashed. The shared code remains weak authentication: this is a **single-user deployment**, not multi-tenant software. Keep the URL private and never store sensitive contact notes. Anyone with the code has the same data access.
- Sessions are created transactionally, with a unique active-session constraint and a unique request ID. Retry after a network interruption cannot silently duplicate a saved schedule. Changing the configuration creates a new request identity.
- Each hourly target is divided into jittered strata, avoiding huge accidental clusters. Per-event local time uses IANA identifiers via Intl, including daylight-saving transitions. Rejection by average activity weight plus weighted sender selection lowers sleeping contacts to roughly 15% activity. A mild repeated-sender penalty reduces long identical runs without promising perfect fairness. All-asleep groups produce fewer total events.
- Session creation freezes event timestamps, sender IDs, and types. The same schedule survives app closes and restarts. The selected-contact snapshot is in session configuration. New devices/contacts join future sessions, not existing ones.
- Each event has one delivery row per active device at session start. A unique `(event_id, subscription_id)` key and `FOR UPDATE SKIP LOCKED` claims prevent concurrent workers sending the same pending delivery. Claims use tokens and 90-second leases. Session state and subscription validity are rechecked immediately before sending.
- Explicit HTTP 429/5xx rejections retry up to three total attempts with exponential delays. 404/410 expires the subscription and cancels its pending deliveries. Other explicit errors fail. Uncertain network outcomes or a worker crash after entering `sending` become `unknown` and are **not automatically resent**, favoring duplicate avoidance over guaranteed delivery. A worker that crashes before sending can have its claim reclaimed.
- Distributed Web Push cannot guarantee end-to-end exactly-once display. An already authorized/in-flight request may finish after Stop. Unique event tags and topics limit accidental duplicate replacement. Separate events use different tags.
- Pending events more than five minutes late are failed instead of causing a recovery burst. Push TTL is 120 seconds. Long device outages can therefore cause missed notifications. Operational history is kept for 30 days; contacts and settings remain until deleted.
- UI counts distinguish planned events, events submitted to at least one push service, and per-device failed/uncertain and pending deliveries. With multiple devices, delivery counts can exceed event counts. “Submitted” is never labeled “delivered.”
- Photos are limited to 2 MB and 20 million decoded pixels, normalized to 256px WebP, stored in a private bucket, and served via authentication. Initials are the fallback. Uploaded photos never enter the service-worker cache.
- The service worker caches the application shell and static assets, displays every push, navigates to a contact on notification click, and uses the Badging API when available. It does not silently run a scheduler. API responses are no-store and are never cached by the worker.

## Predictable edge-case behavior

| Situation                                       | Behavior                                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| No contacts / no selection                      | Empty state; Start disabled; backend also validates selection                                            |
| Invalid duration, count, override, distribution | Server schema rejects the request                                                                        |
| Main count changes                              | Only inherited hours change; explicit overrides stay                                                     |
| Duration shortened                              | Hidden later overrides are discarded                                                                     |
| Permission denied / unsupported / not installed | Explain required setup; no fake success; Start cannot save without an active registered device           |
| App offline                                     | Cached shell where available, offline notice, no offline writes; server schedule continues               |
| Refresh or reopen                               | Load the existing persisted session; never restart its clock                                             |
| Double Start / two tabs                         | Request idempotency and unique active constraint prevent duplicate sessions                              |
| Contact edited during a session                 | Editing is blocked until the session stops                                                               |
| Contact deleted during a session                | Sender's events/deliveries cascade-delete; reply targets become You; other schedule times stay unchanged |
| Photo upload fails after contact creation       | Contact persists; retry uses the saved contact ID to avoid creating duplicates                           |
| Duplicate names                                 | Allowed, with a visible duplicate-name hint; IDs identify contacts                                       |
| Newly added contact during session              | Saved immediately; eligible for the next session                                                         |
| All contacts sleeping                           | Total activity reduced probabilistically; zero events is possible for a small target                     |
| One contact selected                            | Replies target You when no other contact exists                                                          |
| Client clock/time zone changes                  | Server start/end remain authoritative; UI refreshes server time every 15 seconds                         |
| Stop / logout                                   | Cancel pending and claimed deliveries; in-flight pushes cannot be recalled                               |
| Logout all devices                              | Revoke all stored sessions, disable all subscriptions, stop the active schedule                          |
| Subscription expires                            | Mark expired, cancel queued deliveries, provide repair action                                            |
| Subscription changes while closed               | Repair on next open when an existing subscription is available; otherwise use Settings                   |
| Cron interruption                               | No browser fallback; overdue window/expiration rules prevent late bursts                                 |

## Validation and maintenance

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npx netlify functions:build --src netlify/functions --functions .netlify/functions-build
```

Tests use seeded randomness and explicit timestamps. Database integration tests execute the actual migration in PGlite (embedded PostgreSQL), exercising transactional state changes without Supabase credentials. API authentication tests mock the database boundary, not code verification or request handling. These do not prove Supabase extensions, deployed networking, or Apple's delivery behavior; use the deployment checklist for that final integration.

The supplied `pnpm-lock.yaml` records tested dependency resolutions. For exact reproduction use the pinned pnpm version in `packageManager` with `pnpm install --frozen-lockfile`; npm installation is also supported but resolves from package.json rather than the pnpm lock. No paid API is required. Netlify/Supabase quotas and infrastructure costs depend on your accounts and usage; inspect usage before sustained high-frequency operation.

For a new release, update the package version and service-worker cache version. Preserve VAPID keys, review dependency updates, rerun tests/builds, and test notification clicks. Refresh runtime IANA data through Node/browser updates. Run `node scripts/icons.mjs` only to regenerate sizes from the preserved original emblem.

## Project structure

```text
DXB/
  public/
    icons/                    Original emblem and all generated icon sizes
    manifest.webmanifest      Standalone PWA metadata
    sw.js                     Cache, visible push, click routing, badges
  src/
    components/               Access, contact form, controller, settings, UI
    App.tsx                   Navigation, contact list, search and filters
    api.ts                    Protected requests and browser push registration
    domain.ts                 Shared strict validation, countries and time zones
    styles.css                OLED responsive interface and Tailwind import
    main.tsx                  React and service-worker entry
  server/
    db.ts                     Server-only Supabase client and RPC helpers
    security.ts               Cookies, hashing, origin and endpoint checks
    schedule.ts               Persistent randomized schedule generation
    push.ts                   Bounded Web Push worker
  netlify/functions/
    api.ts                    Authentication, CRUD, settings, sessions, tests
    dispatch.ts               Secret-protected Cron entry
  supabase/
    migrations/001_dxb.sql     Tables, indexes, RLS, transactional RPCs
    migrations/002_storage.sql Private photo bucket
    cron.sql                  Vault-based 30-second dispatch invocation
  tests/                      Unit, security, API and PostgreSQL integration tests
  scripts/icons.mjs           Reproducible icon derivatives
  .env.example
  netlify.toml
  package.json
  pnpm-lock.yaml
  tsconfig.json
  vite.config.ts
  eslint.config.js
  README.md
  VALIDATION.md
```

Tailwind v4 is configured using `@tailwindcss/vite` in Vite and the CSS `@theme` block; a legacy `tailwind.config.js` is not required.

## Platform references

- [Apple: sending Web Push notifications](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- [WebKit: Web Push for iOS and iPadOS Home Screen apps](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [Supabase: Cron quickstart and seconds intervals](https://supabase.com/docs/guides/cron/quickstart)
- [Netlify: function configuration and limits](https://docs.netlify.com/build/functions/configuration/)

Operating systems control notification sounds, grouping, layout, Focus suppression, and delivery. A PWA cannot promise exact arrival times, custom native sounds, or per-notification application identity. The supplied icon is the installed DXB identity, not an impersonation of another app.
