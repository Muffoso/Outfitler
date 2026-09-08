# New Project Setup Guide

Step-by-step instructions for standing up a new project from the
`node-auth-boilerplate` template on Railway: repo, PostgreSQL, email/password
auth, and Google OAuth.

This guide is written from an actual run (the **Outfitler** project, 2026-09-07).
Where the live experience differed from the original plan, the guide follows what
actually worked.

---

## Prerequisites

- Railway.app account
- Google Cloud Console account (for OAuth)
- SMTP provider (e.g. Mailgun, SendGrid, Gmail) — optional, only needed for the
  password-reset email flow. The app still boots without a real one as long as
  the `SMTP_*` variables are set to *something* (see Step 6).
- Node.js installed locally (for generating secrets)

---

## Is your template up to date?

The template must already contain these three things (added to Outfitler in
commit `fd5bd93`, 2026-09-07). Open the files and check:

| File | Must contain |
| --- | --- |
| `src/scripts/migrate.js` | an `ensureAppUser()` function that reads `APP_USER_PASSWORD` |
| `src/db/migrations/004_create_app_user.sql` | **only** `GRANT` / `ALTER DEFAULT PRIVILEGES` statements — no `CREATE USER`, no hardcoded password |
| `src/db/migrations/005_create_session.sql` | exists, creates the `session` table |

If any is missing, do **Appendix A** first (or merge those commits into
`node-auth-boilerplate`). Without them the first deploy either ships a hardcoded
DB password or Google OAuth fails silently because the session table is absent.

---

## Step 1 — Create a new repo from the template

1. Go to **github.com/Muffoso/node-auth-boilerplate**
2. Click **"Use this template" → "Create a new repository"**
3. Name your repo, set visibility, click **"Create repository"**

---

## Step 2 — Create a Railway project

1. Go to **railway.app** and click **"New Project"**
2. Choose **"Deploy from GitHub repo"** and select your new repo
3. Railway detects the project and connects it — **let the first build fail or
   cancel it.** It cannot succeed until the variables in Step 6 are set
   (`src/config/index.js` exits if any required variable is missing).

---

## Step 3 — Add a PostgreSQL database

1. In the project, click **"+ New" → "Database" → "PostgreSQL"**
2. Wait for it to provision. Note the **service name** in the left sidebar
   (default: `Postgres`). If it is called something else, substitute that name
   for `Postgres` everywhere `${{Postgres.*}}` appears below.
3. You do **not** need to copy any connection string by hand — Step 6 references
   the database variables directly.

### Database users — no manual SQL

You never run `CREATE USER` yourself. The design:

- **Migrations** run as Railway's built-in `postgres` superuser. That is what
  `MIGRATION_DATABASE_URL = ${{Postgres.DATABASE_URL}}` points at.
- **The running app** connects as a limited `app_user` (only
  `SELECT/INSERT/UPDATE/DELETE`). On every deploy `src/scripts/migrate.js`
  creates or rotates that role from `APP_USER_PASSWORD`, then
  `004_create_app_user.sql` grants it privileges and `005_create_session.sql`
  grants it the session table.

The grant chain works because `migrate.js` runs everything as the superuser:
004's `ALTER DEFAULT PRIVILEGES` covers tables created afterwards, and 005 also
has an explicit `GRANT`.

---

## Step 4 — Generate the app's public domain

On the **app service** (not Postgres): **Settings → Networking → Generate
Domain**.

If Railway asks for a **port** (it can't auto-detect one before the first
successful deploy), enter **8080**. That is the "target port" — the port
Railway's edge proxy forwards incoming traffic to inside the container. It must
match the port the app binds to, which is Railway's injected `PORT` (also
`8080`). Do **not** enter `3000`.

Do this *before* Step 6 so `${{RAILWAY_PUBLIC_DOMAIN}}` resolves when the
variables are saved. You get something like
`your-app-production.up.railway.app`.

---

## Step 5 — Generate secrets

You need three random values. Ask Claude to generate them, or run:

```bash
# JWT_SECRET and SESSION_SECRET — run twice, 64-char hex each
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# APP_USER_PASSWORD — must match [A-Za-z0-9_-], min 16 chars
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

> The `APP_USER_PASSWORD` charset is restricted because `migrate.js` interpolates
> it straight into `CREATE USER ... WITH PASSWORD '...'` (SQL identifiers can't be
> parameterised). A value with other characters is rejected at deploy time.

---

## Step 6 — Set environment variables in Railway

App service → **Variables** tab.

The quickest path is the **Raw Editor**: paste the whole block below, then fill
in the four `<...>` placeholders. (Railway also shows a "suggested variables"
panel populated from `.env.example` — you can use it, but you then have to edit
~8 of the values by hand, so the Raw Editor is less error-prone.)

```
NODE_ENV=production

APP_USER_PASSWORD=<from Step 5>
DATABASE_URL=postgresql://app_user:${{APP_USER_PASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{Postgres.PGDATABASE}}
MIGRATION_DATABASE_URL=${{Postgres.DATABASE_URL}}

JWT_SECRET=<64-char hex from Step 5>
JWT_ACCESS_EXPIRES_IN=10m
JWT_REFRESH_EXPIRES_IN=7d
REFRESH_TOKEN_MAX_AGE_SECONDS=604800

SESSION_SECRET=<64-char hex from Step 5>

GOOGLE_CLIENT_ID=placeholder
GOOGLE_CLIENT_SECRET=placeholder
GOOGLE_CALLBACK_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}/auth/google/callback

SMTP_HOST=placeholder
SMTP_PORT=587
SMTP_USER=placeholder
SMTP_PASS=placeholder
EMAIL_FROM=noreply@example.com

APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
CORS_ORIGINS=https://${{RAILWAY_PUBLIC_DOMAIN}}
```

Notes:

- **Do not set `PORT` to `3000`.** Railway injects `PORT=8080` and its proxy
  forwards to the target port from Step 4 (`8080`). `config/index.js` only
  requires the variable to exist — the injected value satisfies that. Setting
  `PORT=3000` yourself makes the app bind `3000` while the proxy still talks to
  `8080` → `502 Bad Gateway`. Leaving it unset (or `PORT=8080`) is fine.
- **`GOOGLE_*` and `SMTP_*` can stay as `placeholder`** for the first deploy.
  `config/index.js` only checks that they are non-empty, not that they are valid.
  The site and email/password login work; Google login and reset emails start
  working once you put real values in (Step 8 for Google).
- **Watch for trailing spaces / newlines** when pasting values, especially into
  `DATABASE_URL` / `MIGRATION_DATABASE_URL`. A stray space produced
  `database "railway " does not exist` in the real run. If you use the Reference
  picker instead of typing `${{...}}`, you avoid this.
- After saving, Railway shows an **"Apply N changes"** banner. Click it /
  **Deploy** — a plain redeploy from the Deployments list runs with the *old*
  environment.

---

## Step 7 — First deploy

Clicking **Apply / Deploy** (or pushing a commit to `main`) triggers a build.

The container runs `node src/scripts/migrate.js && npm start`. A healthy deploy
log looks like:

```
Starting Container
✅ Connected to database
✅ Updated password for role: app_user      (or: Created role: app_user)
✅ Executed: 001_create_users.sql
✅ Executed: 002_create_refresh_tokens.sql
✅ Executed: 003_create_password_reset_tokens.sql
✅ Executed: 004_create_app_user.sql
✅ Executed: 005_create_session.sql
✅ All migrations completed successfully
> node server.js
✅ Server running on port 8080
```

With an up-to-date template this works on the **first** deploy — the app can
connect as `app_user` immediately because `migrate.js` creates that role (as the
superuser) before the server starts. You do **not** need the two-phase
`DATABASE_URL` switch; that is only for a project that was already deployed
against the superuser URL (see Appendix B).

If the log shows `❌ ... environment variable is not set`, the variables were not
applied — go back to Step 6 and use the **Apply changes** banner.

---

## Step 8 — Configure Google OAuth

1. Go to **console.cloud.google.com**
2. Create a new project (or reuse one)
3. **APIs & Services → OAuth consent screen**: configure it first (Google blocks
   credential creation otherwise). User type **External**; fill app name, support
   email, developer email. While it is in "Testing" mode, add your own Google
   account under **Test users**, or click **Publish app** for open sign-up.
4. **APIs & Services → Credentials → "+ Create Credentials" → "OAuth client ID"**
5. Application type: **Web application**
6. Under **Authorized redirect URIs** add exactly (must match
   `GOOGLE_CALLBACK_URL`, including scheme and no trailing slash):
   ```
   https://YOUR-RAILWAY-DOMAIN/auth/google/callback
   ```
7. Create, then copy the **Client ID** and **Client Secret**.
8. In Railway → app service → **Variables**, replace the two placeholders:
   ```
   GOOGLE_CLIENT_ID=<client id>
   GOOGLE_CLIENT_SECRET=<client secret>
   ```
   Leave `GOOGLE_CALLBACK_URL` as the `${{RAILWAY_PUBLIC_DOMAIN}}` form.
9. **Apply / Deploy.**

> Treat the client secret like a password: never commit it, never paste it into
> docs or chat. If it leaks, rotate it in the Credentials page.

---

## Step 9 — Verify the deployment

- [ ] `https://YOUR-DOMAIN/login.html` loads
- [ ] Register with email/password → redirected to the home page
- [ ] Log in with email/password → redirected to the home page
- [ ] "Sign in with Google" → consent screen → redirected back, logged in
- [ ] Log out → redirected to the login page
- [ ] (If real SMTP) Forgot password → email with reset link → reset → log in
- [ ] Deploy logs show no `permission denied for table ...` and no
      `[SessionStore] Error` — those mean `app_user`'s grants didn't apply

The server printing "Server running" is **not** proof the `app_user` connection
works — the pool connects lazily on the first query. The register/login test is
the real check.

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `❌ MIGRATION_DATABASE_URL environment variable is not set` (repeated) | Variables saved but not applied. Click the **"Apply N changes"** banner, not a plain redeploy. |
| `database "railway " does not exist` | Trailing space/newline in a DB URL. Re-add the variable via the **Reference** picker instead of typing it. |
| `❌ APP_USER_PASSWORD environment variable is not set` | Add it (Step 5/6) and redeploy. |
| `❌ APP_USER_PASSWORD must be at least 16 chars and use only A-Z a-z 0-9 _ -` | Regenerate with the `base64url` command in Step 5. |
| Deploy crash-loops right after switching `DATABASE_URL` to `app_user` | The `app_user` password in the URL doesn't match `APP_USER_PASSWORD`, or a migration that grants privileges hasn't run yet. Point `DATABASE_URL` back at `${{Postgres.DATABASE_URL}}`, deploy once, then switch (Appendix B). |
| Google login → `redirect_uri_mismatch` | The redirect URI in Google Cloud must equal `GOOGLE_CALLBACK_URL` character-for-character. |
| Google login → `access_denied` while consent screen is in Testing | Add the account under **Test users**, or publish the consent screen. |
| `[SessionStore] Error` in logs on Google login | `session` table missing or not granted — confirm `005_create_session.sql` ran. |
| `injected env (0) from .env` lines in logs | Cosmetic (a dotenv build banner). Ignore. |

---

## Appendix A — Bringing an old template up to date

If the template predates the `app_user` hardening, apply these changes (this is
exactly what was done to Outfitler):

| File | Change |
| --- | --- |
| `src/scripts/migrate.js` | Add `ensureAppUser(client)`, called right after `client.connect()` and before the migration loop. It reads `APP_USER_PASSWORD`, validates it against `/^[A-Za-z0-9_-]{16,}$/`, then runs `CREATE USER app_user WITH PASSWORD '...'` (or `ALTER USER ... WITH PASSWORD` if the role exists). Exit non-zero if the variable is missing or malformed. |
| `src/db/migrations/004_create_app_user.sql` | Delete the `DO $$ ... CREATE USER ... 'AppUser123456' ... $$` block. Keep only the `GRANT CONNECT / USAGE / SELECT,INSERT,UPDATE,DELETE ON ALL TABLES` and `ALTER DEFAULT PRIVILEGES ... GRANT ... TO app_user`. |
| `src/db/migrations/005_create_session.sql` | New file. `CREATE TABLE IF NOT EXISTS "session" (sid varchar NOT NULL, sess json NOT NULL, expire timestamp(6) NOT NULL)`, add PK on `sid` (guarded so re-runs don't fail), `CREATE INDEX IF NOT EXISTS "IDX_session_expire"`, then `GRANT SELECT, INSERT, UPDATE, DELETE ON "session" TO app_user`. |
| `.env.example` | Add `APP_USER_PASSWORD=`; change `DATABASE_URL` to the `app_user` form; change `MIGRATION_DATABASE_URL` comment to point at the superuser / `${{Postgres.DATABASE_URL}}`. |

Commit and push to the template's `main`.

---

## Appendix B — Switching an already-deployed project to `app_user`

If you already deployed with `DATABASE_URL` pointing at the superuser
(`${{Postgres.DATABASE_URL}}`), switch in two phases so you can confirm the role
exists before you depend on it:

1. Add `APP_USER_PASSWORD` (Step 5 value). Leave `DATABASE_URL` on the superuser
   URL. **Deploy.** Confirm the log shows
   `✅ Updated password for role: app_user` and `✅ Executed: 004 / 005`.
2. Change `DATABASE_URL` to:
   ```
   postgresql://app_user:${{APP_USER_PASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{Postgres.PGDATABASE}}
   ```
3. **Deploy.** Verify the site still loads and register/login still works.

---

## Working on the project (Railway-only workflow)

You don't need to run the app locally. The loop is:

1. Edit code locally, or in the GitHub web editor
2. `git commit` + `git push` to `main`
3. Railway auto-deploys the push
4. Watch **Deployments → (latest) → Deploy Logs**; test on the public domain
5. To change environment variables: app service → **Variables**, edit, then click
   the **"Apply changes"** banner

### If you do want to run locally

1. Clone the repo, `npm install`
2. Copy `.env.example` to `.env`, fill in values (localhost URLs, HTTP is fine).
   You need a local PostgreSQL: a superuser URL for `MIGRATION_DATABASE_URL` and
   `APP_USER_PASSWORD` set.
3. `node src/scripts/migrate.js`
4. `npm start` → `http://localhost:3000`
