# Deploying NayaSpend to nayaspend.app

Layout: the React app is a static site on **Cloudflare Pages** at `https://nayaspend.app`; the API is a **Cloudflare Worker** (D1 database, queue, cron triggers) at `https://api.nayaspend.app`. Both share the registrable domain, so the `SameSite=None; Secure` session cookie and CORS (`FRONTEND_BASE_URL`) work as configured.

Everything below is a one-time setup, in order. Steps marked **(you)** need your accounts; the rest are commands.

## 0. Put the domain on Cloudflare (you)
1. Cloudflare dashboard -> Add a site -> `nayaspend.app` -> Free plan.
2. At your registrar, replace the nameservers with the two Cloudflare gives you. Wait until the site shows **Active** (minutes to a few hours). Custom domains for the Worker and Pages cannot attach before this.

## 1. Log in and create the resources
```bash
cd backend
npx wrangler login
npx wrangler d1 create nayaspend        # copy the printed database_id into wrangler.toml (database_id)
npx wrangler queues create capture-retry
npx wrangler d1 migrations apply nayaspend --remote   # applies 0001-0006
```
(Wrangler 3.114 works; `npm i -D wrangler@4` is recommended but optional.)

## 2. Google Cloud Console (you)
Open the OAuth client used for NayaSpend (APIs & Services -> Credentials):
- **Authorized redirect URIs** (add both):
  - `https://api.nayaspend.app/auth/google/callback`
  - `https://api.nayaspend.app/auth/gmail/callback`
- **Authorized JavaScript origins**: `https://nayaspend.app`
- **OAuth consent screen -> Publishing status**: if it says *Testing*, Google expires refresh tokens after **7 days**, which silently breaks Gmail capture every week. Click *Publish app*. The Gmail read-only scope is "sensitive", so an unverified published app shows a warning screen and is capped at 100 users: fine for personal use; submit for verification later if you open it up.

## 3. Secrets
Run each and paste the value when prompted (nothing is stored in files):
```bash
cd backend
npx wrangler secret put GMAIL_CLIENT_ID
npx wrangler secret put GMAIL_CLIENT_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put NOTIFICATION_EMAIL      # your own email
npx wrangler secret put DEEPSEEK_API_KEY        # optional; without it AI suggestions are skipped
# Generate and set the token-encryption key in one go (the value is never shown):
openssl rand -base64 32 | npx wrangler secret put TOKEN_ENCRYPTION_KEY
```
Do not reuse the local `.dev.vars` DeepSeek key if it was ever pasted into chat: create a fresh one at platform.deepseek.com and use that.

Non-secret config (`FRONTEND_BASE_URL`, `GMAIL_REDIRECT_URI`, `DEEPSEEK_MODEL`) is already in `backend/wrangler.toml` `[vars]`.

## 4. Deploy the API
```bash
cd backend
npx wrangler deploy
```
Wrangler attaches `api.nayaspend.app` as a custom domain automatically (needs step 0). Check: `https://api.nayaspend.app/trends` should answer `401`, which means the Worker is up and the auth gate is on.

## 5. Deploy the frontend
```bash
cd frontend
npm ci
npm run build                      # picks up frontend/.env.production -> VITE_API_BASE_URL=https://api.nayaspend.app
npx wrangler pages project create nayaspend --production-branch main   # first time only
npx wrangler pages deploy dist --project-name nayaspend
```
Then Cloudflare dashboard -> Workers & Pages -> `nayaspend` -> Custom domains -> add `nayaspend.app` (and `www.nayaspend.app` if you want a redirect).
`public/_redirects` gives the SPA fallback; `public/_headers` sets security and cache headers.

## 6. Smoke test
- `https://nayaspend.app/welcome` loads; view-source shows the canonical + Open Graph tags.
- Sign in with Google completes and lands on the dashboard (cookie `session` set on `api.nayaspend.app`).
- Capture Health -> Connect Gmail completes and returns to the app.
- Trigger a capture and confirm a transaction appears; with `DEEPSEEK_API_KEY` set, an Uncategorized row gets a suggestion.
- Cron triggers: dashboard -> Workers -> `nayaspend-backend` -> Triggers shows the three schedules.

## Automatic deploys (Cloudflare Git integration)
Push to `main` -> Cloudflare builds and deploys. `.github/workflows/ci.yml` only runs typechecks and tests (also on pull requests).

**Frontend** (Workers & Pages -> `nayaspend` -> Connect to Git):
- Repository `NayaSpend`, production branch `main`
- Framework preset: React (Vite) - Build command: `npm --prefix ../backend ci && npm ci && npm run build` - Output directory: `dist` - Root directory: `frontend`
- Environment variable (Production): `NODE_VERSION` = `22`
(The frontend imports types from the backend, so the build installs both. `VITE_API_BASE_URL` comes from the committed `frontend/.env.production`.)

**API** (Workers & Pages -> `nayaspend-backend` -> Settings -> Builds -> Connect):
- Repository `NayaSpend`, production branch `main`, Root directory `backend`
- Build command: `npm ci`
- Deploy command: `npx wrangler@4 d1 migrations apply nayaspend --remote && npx wrangler@4 deploy`
- Environment variable: `NODE_VERSION` = `22`
Worker secrets live in Cloudflare and are untouched by deploys. Backend integration tests are not part of CI yet.

## Dev environment and release flow
Two long-lived branches only: `main` (production) and `dev`. All work is committed and pushed to `dev`; when it is verified on the dev site, merge `dev` into `main` (PR: https://github.com/mhhassaan/NayaSpend/compare/main...dev) and production deploys itself. After a release, bring dev up to date: `git checkout dev && git merge main && git push`.

| | Production (`main`) | Dev (`dev`) |
|---|---|---|
| Site | nayaspend.app | dev.nayaspend.app |
| API | api.nayaspend.app (Worker `nayaspend-backend`) | api-dev.nayaspend.app (Worker `nayaspend-backend-dev`) |
| Database | D1 `nayaspend` | D1 `nayaspend-dev` (separate data) |
| Queue | `capture-retry` | `capture-retry-dev` |

Dev config lives in `backend/wrangler.toml` under `[env.dev]` (deploy by hand with `npx wrangler@4 deploy --env dev`; secrets with `secret put NAME --env dev`). Dev runs only two of the three cron triggers because the free plan allows 5 per account.

**Dev Worker auto-deploy** (Workers & Pages -> Create -> Import a repository, or open `nayaspend-backend-dev` -> Settings -> Builds -> Connect): repository `NayaSpend`, production branch `dev`, root directory `backend`, build command `npm ci`, deploy command `npx wrangler@4 d1 migrations apply nayaspend-dev --remote --env dev && npx wrangler@4 deploy --env dev`, variable `NODE_VERSION` = `22`.

**Dev frontend**: the Pages project already builds every non-production branch as a preview, so pushing `dev` publishes `dev.nayaspend.pages.dev`. In Pages -> Settings -> Variables and secrets add, for the **Preview** environment only, `VITE_API_BASE_URL` = `https://api-dev.nayaspend.app` and `NODE_VERSION` = `22`. Then point `dev.nayaspend.app` at it: Cloudflare DNS, CNAME `dev` -> `dev.nayaspend.pages.dev` (proxied), and add `dev.nayaspend.app` under the Pages project's custom domains if Cloudflare asks for it.

**Google Cloud Console** (same OAuth client): add redirect URIs `https://api-dev.nayaspend.app/auth/google/callback` and `https://api-dev.nayaspend.app/auth/gmail/callback`, and `https://dev.nayaspend.app` as an authorized origin.

**Migrations are the one thing that does not roll back.** They apply to the production database on every deploy of `main`, so a migration always reaches the dev database first (on a `dev` deploy) and gets checked there before the release merge.

## Known follow-ups
- Notification emails use Resend's shared sender `alerts@resend.dev`, which only delivers to the Resend account owner's address. Fine for one user; for others, verify `nayaspend.app` in Resend and change `FROM_ADDRESS` in `backend/src/services/notificationEngine.ts`.
- No `og:image` yet: add a 1200x630 image and `<meta property="og:image">` for link previews.
- Rotate any key that was pasted into chat or logs.
