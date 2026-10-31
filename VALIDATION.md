# DXB validation — 31 October 2026

## Passed locally

- Strict TypeScript check: no errors.
- ESLint: no errors.
- Vitest: **43 tests passed across 4 files**.
- Production Vite build: completed successfully.
- Netlify function packaging: both `api` and `dispatch` built successfully.
- Dependency manifest and lockfile specifiers match.
- Original icon preserved; 192px, 512px, 180px Apple touch, 32px favicon, and padded 512px maskable assets generated.

The tests cover duration/frequency validation, per-hour inheritance, selection validation, country/time-zone validation, daylight-saving changes, 01:00/07:00 boundaries, all-asleep rate reduction, mixed-zone weighting, scheduling bounds/randomness, content distributions, reply fallback, opaque session hashing/cookies, Origin enforcement, SSRF prevention, real backend code checking, rate-limit rejection, and unauthorized API calls.

PostgreSQL integration tests execute `001_dxb.sql` in PGlite. They cover RLS and RPC grants, persistent login throttling, atomic session creation, idempotent request IDs, overlapping claim calls, Stop after claim, submit-once transitions, explicit retry vs uncertain send, automatic expiration, contact deletion, edit locking, delayed tests, and expired authentication cleanup.

## Browser checks

Checked in the in-app Chromium browser against an **isolated local QA fixture**, separate from the delivered application. The fixture contains fictional test contacts and substitutes only the API boundary for UI checks. It is not included in the Desktop project, archive, or production build.

- Four-digit entry and unlock screen.
- Desktop contact list and DXB Control navigation.
- Search by city (`Paris`) returns matching contacts.
- Contact form saves a new contact; France selects Europe/Paris.
- Settings save and reflect the changed profile name.
- Contact selection and per-hour override UI.
- Changing baseline 20 → 21 leaves explicit Hour 2 override at 40 and updates inherited Hour 1 to 21.
- Mobile widths 390px and 320px; no horizontal document overflow at 320px.
- Independently scrolling selector has a 350px outer height and 70px rows (five visible rows).
- Notification settings report unregistered status and disable test actions when no subscription exists.
- The supplied original logo is displayed in the actual rendered interface.

Browser fixture checks do not establish cloud persistence or real push delivery. Database persistence and lifecycle behavior were checked separately against PostgreSQL. Desktop and mobile screenshots show QA data only.

## Not verified without external configuration / hardware

- Supabase-hosted migration execution, storage upload and RLS enforcement on the user's actual project.
- Supabase `pg_cron`, `pg_net`, Vault, and outbound calls to the deployed Netlify function.
- Netlify production deployment, environment settings, HTTPS origin and function runtime.
- Push-service acceptance using a real device subscription and VAPID keys.
- Delivery to a physical iPhone while locked, closed, or removed from App Switcher.
- Native iOS icon installation, notification appearance, badges, Focus behavior, and permission prompts.
- Real concurrent PostgreSQL connections under production load; PGlite serializes its embedded connection, while the production SQL uses row locks and SKIP LOCKED.

Use the README's background-verification checklist after configuring the cloud services. No live credentials were supplied or committed.
