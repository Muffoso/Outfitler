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
3. Click the database service → **"Connect"** tab
4. Note the **connection string** (used as `MIGRATION_DATABASE_URL` in Step 5)

---

## Step 4 — Create database users

1. In Railway, go to the database service → **"Query"** tab (or connect via psql)
2. Note the database name from the connection string
3. Run the following SQL — replace the passwords with strong random strings:

```sql
-- Migration user (DDL privileges)
CREATE USER migration_user WITH PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
GRANT CONNECT ON DATABASE YOUR_DB_NAME TO migration_user;
GRANT CREATE ON SCHEMA public TO migration_user;

-- App user (DML only — no DDL)
CREATE USER app_user WITH PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
GRANT CONNECT ON DATABASE YOUR_DB_NAME TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE migration_user IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
```

4. Build the two connection strings you will need:
   - `MIGRATION_DATABASE_URL` — same host/port/db as Railway's default URL but with `migration_user` credentials
   - `DATABASE_URL` — same host/port/db but with `app_user` credentials

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

```
NODE_ENV=production
PORT=3000

DATABASE_URL=postgresql://app_user:PASSWORD@HOST:PORT/DB_NAME
MIGRATION_DATABASE_URL=postgresql://migration_user:PASSWORD@HOST:PORT/DB_NAME

JWT_SECRET=<64-char hex from Step 5>
JWT_ACCESS_EXPIRES_IN=10m
JWT_REFRESH_EXPIRES_IN=7d
REFRESH_TOKEN_MAX_AGE_SECONDS=604800

GOOGLE_CLIENT_ID=<from Step 6>
GOOGLE_CLIENT_SECRET=<from Step 6>
GOOGLE_CALLBACK_URL=https://YOUR-RAILWAY-DOMAIN/auth/google/callback

SESSION_SECRET=<64-char hex from Step 5>

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=<smtp password>
EMAIL_FROM=noreply@example.com

APP_URL=https://YOUR-RAILWAY-DOMAIN
CORS_ORIGINS=https://YOUR-RAILWAY-DOMAIN
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
