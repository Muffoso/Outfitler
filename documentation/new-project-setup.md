# New Project Setup Guide

Step-by-step instructions for starting a new project from the `node-auth-boilerplate` template.

---

## Prerequisites

- Railway.app account
- Google Cloud Console account (for OAuth)
- SMTP provider (e.g. Mailgun, SendGrid, or Gmail)
- Node.js installed locally (for generating secrets)

---

## Step 1 — Create a new repo from the template

1. Go to **github.com/Muffoso/node-auth-boilerplate**
2. Click **"Use this template" → "Create a new repository"**
3. Name your repo, set visibility, click **"Create repository"**

---

## Step 2 — Create a Railway project

1. Go to **railway.app** and click **"New Project"**
2. Choose **"Deploy from GitHub repo"** and select your new repo
3. Railway will detect the project — do **not** deploy yet

---

## Step 3 — Add a PostgreSQL database

1. In your Railway project, click **"+ New"** → **"Database"** → **"PostgreSQL"**
2. Wait for the database to provision
3. Reference the DB into the app service in Step 7 — no manual connection string needed

---

## Step 4 — Database users (no manual SQL)

You do **not** create database users by hand. The design is:

- **Migrations** run as Railway's built-in `postgres` superuser — that is what
  `MIGRATION_DATABASE_URL` points at (`${{Postgres.DATABASE_URL}}`).
- **The running app** connects as a limited `app_user` (SELECT/INSERT/UPDATE/DELETE
  only). `src/scripts/migrate.js` creates that role from the `APP_USER_PASSWORD`
  env var on every deploy, and `004_create_app_user.sql` grants its privileges.

So all you do is set `APP_USER_PASSWORD` (see Step 7). Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

It must match `[A-Za-z0-9_-]`, at least 16 chars (it is interpolated into `CREATE USER`).

---

## Step 5 — Generate secrets

Run the following in a terminal to generate the two required secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run it twice — one value for `JWT_SECRET`, one for `SESSION_SECRET`.

---

## Step 6 — Configure Google OAuth

1. Go to **console.cloud.google.com**
2. Create a new project (or reuse an existing one)
3. Navigate to **"APIs & Services" → "Credentials"**
4. Click **"+ Create Credentials" → "OAuth client ID"**
5. Application type: **Web application**
6. Add under **"Authorized redirect URIs"**:
   ```
   https://YOUR-RAILWAY-DOMAIN/auth/google/callback
   ```
   (You'll get the Railway domain after first deploy — you can add it retroactively)
7. Copy **Client ID** and **Client Secret**

---

## Step 7 — Set environment variables in Railway

In your Railway project, go to the app service → **"Variables"** tab and add:

Generate a public domain first (service → **Settings → Networking → Generate
Domain**) so `${{RAILWAY_PUBLIC_DOMAIN}}` resolves. Then, in the **Raw Editor**:

```
NODE_ENV=production
PORT=3000

APP_USER_PASSWORD=<base64url from Step 4>
DATABASE_URL=postgresql://app_user:${{APP_USER_PASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{Postgres.PGDATABASE}}
MIGRATION_DATABASE_URL=${{Postgres.DATABASE_URL}}

JWT_SECRET=<64-char hex from Step 5>
JWT_ACCESS_EXPIRES_IN=10m
JWT_REFRESH_EXPIRES_IN=7d
REFRESH_TOKEN_MAX_AGE_SECONDS=604800

GOOGLE_CLIENT_ID=<from Step 6>
GOOGLE_CLIENT_SECRET=<from Step 6>
GOOGLE_CALLBACK_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}/auth/google/callback

SESSION_SECRET=<64-char hex from Step 5>

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=<smtp password>
EMAIL_FROM=noreply@example.com

APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
CORS_ORIGINS=https://${{RAILWAY_PUBLIC_DOMAIN}}
```

---

## Step 8 — Deploy

1. In Railway, trigger a deploy (or push a commit to main)
2. The app runs `node src/scripts/migrate.js` before starting — this creates all database tables automatically
3. Check the deploy logs to confirm:
   - No missing environment variable errors
   - Migration completed successfully
   - Server started on the correct port

---

## Step 9 — Update Google OAuth callback URL

If you added a placeholder URL in Step 6, go back to Google Cloud Console and update the redirect URI with your actual Railway domain.

---

## Step 10 — Verify the deployment

Test the following:

- [ ] `https://YOUR-DOMAIN/login.html` loads
- [ ] Register with email/password → redirected to home page
- [ ] Login with email/password → redirected to home page
- [ ] "Sign in with Google" → OAuth flow completes → redirected to home page
- [ ] Logout → redirected to login page
- [ ] Forgot password → email received with reset link
- [ ] Reset password → can log in with new password

---

## Local development

1. Clone your new repo
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in values (use `localhost` URLs, HTTP is fine locally)
4. Run migrations:
   ```bash
   node src/scripts/migrate.js
   ```
5. Start the server:
   ```bash
   npm start
   ```
6. Open `http://localhost:3000`
