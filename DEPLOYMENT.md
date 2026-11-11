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

## Automatic deploys (GitHub Actions)
`.github/workflows/deploy.yml` runs on every push to `main`: typecheck and tests, then the production D1 migrations, then the Worker, then the Pages site. Nothing deploys if the checks fail.

One-time setup (you):
1. Cloudflare dashboard -> My Profile -> API Tokens -> Create Token -> *Edit Cloudflare Workers* template. Under Permissions also add: Account / D1 / Edit, Account / Cloudflare Pages / Edit, Account / Queues / Edit. Account resources: your account. Zone resources: `nayaspend.app`.
2. GitHub repo -> Settings -> Secrets and variables -> Actions -> New repository secret:
   - `CLOUDFLARE_API_TOKEN`: the token from step 1
   - `CLOUDFLARE_ACCOUNT_ID`: shown on the right of the Cloudflare dashboard home (or in any Workers URL)
3. Merge to `main` (or run the workflow manually from the Actions tab) and watch it go green.

The Worker's own secrets (Google, Resend, DeepSeek, encryption key) live in Cloudflare and are untouched by deploys. Backend integration tests are not part of CI yet (the Workers test runtime has not been verified in CI).

## Known follow-ups
- Notification emails use Resend's shared sender `alerts@resend.dev`, which only delivers to the Resend account owner's address. Fine for one user; for others, verify `nayaspend.app` in Resend and change `FROM_ADDRESS` in `backend/src/services/notificationEngine.ts`.
- No `og:image` yet: add a 1200x630 image and `<meta property="og:image">` for link previews.
- Rotate any key that was pasted into chat or logs.
