# Nobomo - Authentication & Database Implementation Summary
**Date:** 2026-04-21

## Overview
Complete authentication system implemented for Nobomo project on Railway.app, including email/password authentication and Google OAuth 2.0 integration with PostgreSQL database.

---

## Architecture

### Tech Stack
- **Runtime:** Node.js 24.15.0, npm 11.12.1
- **Framework:** Express.js 4.18.2
- **Database:** PostgreSQL 16+ (via Railway.app addon)
- **Password Hashing:** Argon2id
- **Authentication:** JWT + Refresh Token rotation
- **OAuth:** Google OAuth 2.0 (passport-google-oauth20)
- **Session Store:** connect-pg-simple (for OAuth handshake state)
- **Security:** Helmet.js, CORS, express-rate-limit

### Project Structure
```
/
├── src/
│   ├── app.js                    # Express app factory
│   ├── config/index.js           # Centralized env var validation
│   ├── db/
│   │   ├── pool.js              # PostgreSQL connection pool
│   │   └── migrations/          # SQL migration files
│   ├── middleware/
│   │   ├── security.js          # Helmet, CORS, rate limiting
│   │   └── authenticate.js      # JWT middleware
│   ├── routes/
│   │   ├── auth.js              # Password auth endpoints
│   │   └── oauth.js             # Google OAuth endpoints
│   ├── services/
│   │   ├── authService.js       # Auth logic
│   │   ├── tokenService.js      # JWT + refresh token logic
│   │   ├── passwordService.js   # Argon2 + reset tokens
│   │   └── emailService.js      # Email sending (Nodemailer)
│   ├── passport/
│   │   └── googleStrategy.js    # Google OAuth strategy
│   └── scripts/
│       └── migrate.js           # Migration runner
├── public/
│   ├── index.html               # Protected home page
│   ├── login.html               # Login form
│   ├── register.html            # Registration form
│   └── js/auth.js               # Client-side token management
├── package.json                 # Dependencies
├── server.js                    # Entry point
├── .env.example                 # Environment template
└── .gitignore
```

---

## Database Schema

### Tables

**users**
- `id` (UUID, PK)
- `email` (TEXT, UNIQUE)
- `password_hash` (TEXT, nullable for OAuth-only)
- `google_id` (TEXT, UNIQUE, nullable)
- `display_name` (TEXT)
- `avatar_url` (TEXT)
- `email_verified` (BOOLEAN, default: false)
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)

**refresh_tokens**
- `id` (UUID, PK)
- `user_id` (UUID, FK → users)
- `token_hash` (TEXT, UNIQUE) — SHA-256 hash of actual token
- `family` (UUID) — For theft detection via rotation
- `created_at` (TIMESTAMPTZ)
- `expires_at` (TIMESTAMPTZ)
- `revoked_at` (TIMESTAMPTZ, nullable)

**password_reset_tokens**
- `id` (UUID, PK)
- `user_id` (UUID, FK → users)
- `token_hash` (TEXT, UNIQUE) — SHA-256 hash
- `created_at` (TIMESTAMPTZ)
- `expires_at` (TIMESTAMPTZ) — 30 minutes
- `used_at` (TIMESTAMPTZ, nullable) — Single-use enforcement

### Database Users (Railway)
- **migration_user:** DDL privileges (CREATE, ALTER, DROP)
- **app_user:** DML only (SELECT, INSERT, UPDATE, DELETE) — principle of least privilege

---

## Authentication Flows

### 1. Email/Password Registration
1. POST `/api/auth/register` with `{email, password}`
2. Email normalized (lowercase + trim)
3. Password hashed with Argon2id
4. User inserted into DB
5. Access token issued (10 min JWT)
6. Refresh token generated → hashed → stored in DB
7. Refresh token set as HttpOnly cookie
8. Response: `{accessToken, user}`

### 2. Email/Password Login
1. POST `/api/auth/login` with `{email, password}`
2. Email lookup (normalization prevents enumeration)
3. Password verified (timing-attack resistant via argon2)
4. Tokens issued (access + refresh with family)
5. Refresh cookie set
6. Response: `{accessToken, user}`

### 3. Token Refresh
1. POST `/api/auth/refresh` (automatic via cookie)
2. Old token marked `revoked_at = NOW()`
3. New token generated with same `family`
4. If revoked token presented again → entire family revoked (theft detected)
5. New refresh cookie set
6. Response: `{accessToken}`

### 4. Password Reset
1. POST `/api/auth/forgot-password` with `{email}`
2. Token generated: `crypto.randomBytes(32).toString('hex')` (64 char hex)
3. Token hashed before DB storage
4. Email sent with plaintext token in link
5. User clicks link, POST `/api/auth/reset-password` with `{token, password}`
6. Token verified (not used, not expired)
7. Password hash updated
8. **All existing refresh tokens revoked** (session invalidation)
9. Same response whether email exists or not (prevents user enumeration)

### 5. Google OAuth
1. GET `/auth/google` → redirect to Google consent screen
2. Scopes: `openid email profile`
3. State + nonce parameters for CSRF/replay protection
4. Google callback POST → `/auth/google/callback`
5. ID token verified: `iss`, `aud`, `exp`, `nonce` claims checked
6. User linked/created in DB
7. Tokens issued (access + refresh)
8. Redirect to `/` with access token in short-lived cookie (10s)
9. Client-side JS extracts token and stores in memory

---

## Security Implementation

### Password Security
- **Algorithm:** Argon2id
- **Memory:** 19 MiB (19456 KiB)
- **Time Cost:** 2 iterations
- **Parallelism:** 1
- **Hashing Time:** ~100-200ms per password (DoS-resistant)

### Token Security
- **Access Token:**
  - Format: JWT (HS256)
  - Lifetime: 10 minutes
  - Storage: In-memory JavaScript variable (never localStorage/sessionStorage)
  - Algorithm verification: explicit `algorithms: ['HS256']` to prevent alg:none attacks

- **Refresh Token:**
  - Format: 64-char hex string
  - Storage: HttpOnly cookie
  - Cookie Flags: `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`
  - Lifetime: 7 days
  - Rotation: New token issued on each refresh
  - Family-based theft detection: If revoked token used, entire family revoked

### Database Security
- **Connection:** SSL with `rejectUnauthorized: true`
- **Pool:** max 20 connections, 30s idle timeout, 2s connection timeout
- **Queries:** All parameterized (no string interpolation)
- **Users:** Separate migration (DDL) and runtime (DML only) users
- **Token Storage:** Only hashes stored (SHA-256), plaintext never persisted

### HTTP Security
- **Helmet.js Headers:**
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
  - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'`
    - CSP is in `reportOnly` mode in non-production environments (development/staging); enforced in production
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `Cross-Origin-Opener-Policy: same-origin`
  - Note: `Permissions-Policy` header is **not** configured

- **Session Cookie (OAuth handshake only):**
  - `SameSite=Lax` — intentionally not `Strict` to allow Google's cross-site redirect to deliver the state/nonce cookie back
  - `HttpOnly; Secure` (production); `Max-Age=3600`

- **CORS:** Whitelist by `CORS_ORIGINS` env var, `credentials: true`

- **Rate Limiting:**
  - General: 100 req/15min per IP
  - Auth endpoints (login/register): 5 req/15min per IP
  - Password reset: 3 req/30min per IP
  - Response: HTTP 429 (no `Retry-After` header — error message returned in JSON body)

- **Input Validation:** Zod schemas for all endpoints
  - Email: valid format, max 254 chars
  - Password: min 8 chars, max 128 chars
  - Tokens: exact format validation

### Timing Attack Protection
- Invalid login attempts still call `argon2.verify()` with dummy hash (constant-time behavior)
- Prevents attacker from determining if email exists

---

## API Endpoints

### Authentication Routes (`/api/auth/*`)

| Method | Endpoint | Body | Response | Rate Limit |
|--------|----------|------|----------|------------|
| POST | `/register` | `{email, password}` | `{accessToken, user}` (201) | Auth (5/15m) |
| POST | `/login` | `{email, password}` | `{accessToken, user}` (200) | Auth (5/15m) |
| POST | `/refresh` | (cookie) | `{accessToken}` (200) | General |
| POST | `/logout` | — | (204) | General |
| POST | `/forgot-password` | `{email}` | `{message}` (200) | Reset (3/30m) |
| POST | `/reset-password` | `{token, password}` | `{message}` (200) | Reset (3/30m) |

### OAuth Routes (`/auth/*`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/google` | Initiate Google OAuth consent screen |
| GET | `/google/callback` | Google redirect callback (handles state verification) |

---

## Environment Variables

Required (validation at startup):
```
NODE_ENV                      # 'development' or 'production'
PORT                          # 3000
DATABASE_URL                  # postgresql://app_user:...
MIGRATION_DATABASE_URL        # postgresql://migration_user:...
JWT_SECRET                    # 64-char random hex
JWT_ACCESS_EXPIRES_IN         # '10m'
JWT_REFRESH_EXPIRES_IN        # '7d'
REFRESH_TOKEN_MAX_AGE_SECONDS # 604800 (7 days)
GOOGLE_CLIENT_ID              # From Google Cloud Console
GOOGLE_CLIENT_SECRET          # From Google Cloud Console
GOOGLE_CALLBACK_URL           # https://yourdomain.com/auth/google/callback
SESSION_SECRET                # 64-char random hex
SMTP_HOST                     # Email provider
SMTP_PORT                     # Usually 587 or 465
SMTP_USER                     # Email account
SMTP_PASS                     # Email password
EMAIL_FROM                    # Sender address
APP_URL                       # https://yourdomain.com
CORS_ORIGINS                  # https://yourdomain.com
```

If any variable is missing at startup → `process.exit(1)` with logged variable names.

---

## Frontend Architecture

### `public/js/auth.js` (ES Module)
- **In-Memory Token:** `let accessToken = null` (never in localStorage)
- **Functions:**
  - `initAuth()` — Restore session on page load via silent refresh
  - `refreshAccessToken()` — POST /api/auth/refresh, update token
  - `authFetch(url, options)` — Wrapper that adds Authorization header, auto-retry on 401
  - `logout()` — POST /logout, clear token, redirect

### `public/login.html`
- Email + password form
- Google OAuth link (`/auth/google`)
- Links to register and forgot-password pages

### `public/register.html`
- Email + password + confirm password form
- Client-side validation (password match)
- Link to login page

### `public/index.html`
- Protected page (checks token at load)
- Displays user email + ID
- Logout button
- Auto-redirects to /login.html if not authenticated

---

## Deployment on Railway

### Prerequisites
1. Railway.app account
2. PostgreSQL addon enabled
3. GitHub repository connected

### Setup Steps

1. **Create Database Users (via Railway DB shell):**
```sql
CREATE USER migration_user WITH PASSWORD '...';
GRANT CONNECT ON DATABASE dbname TO migration_user;
GRANT CREATE ON SCHEMA public TO migration_user;

CREATE USER app_user WITH PASSWORD '...';
GRANT CONNECT ON DATABASE dbname TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE migration_user IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
```

2. **Set Environment Variables in Railway Dashboard:**
   - Copy all from `.env.example`
   - Use Railway's auto-injected `DATABASE_URL` as `MIGRATION_DATABASE_URL` for first deploy
   - Create separate `app_user` connection string for runtime `DATABASE_URL`

3. **Dockerfile (already updated):**
```dockerfile
CMD ["sh", "-c", "node src/scripts/migrate.js && node server.js"]
```
   - Migrations run on every deploy (idempotent via IF NOT EXISTS)
   - Server starts after migrations complete

4. **Deploy:**
   - Push to GitHub main branch
   - Railway auto-deploys

---

## Testing Checklist

- [ ] Register with email/password
- [ ] Login with email/password
- [ ] Refresh token (automatic on 401)
- [ ] Logout (invalidates token)
- [ ] Password reset flow (email + link + new password)
- [ ] Google OAuth (sign in with Google, auto-create account)
- [ ] Rate limiting (>5 login attempts in 15min → 429)
- [ ] Security headers (curl -I → check X-Frame-Options, HSTS)
- [ ] Token theft detection (use old refresh token after rotation → family revoked)
- [ ] Session invalidation (logout → old refresh token no longer works)

---

## Security Audit Checklist

- [x] Argon2id password hashing (19 MiB, 2 iterations)
- [x] Access tokens in memory only (never localStorage)
- [x] Refresh cookies HttpOnly + Secure + SameSite=Strict
- [x] OAuth session cookie uses SameSite=Lax (required for cross-site Google redirect)
- [x] JWT verified with explicit algorithm (no alg:none)
- [x] Refresh token rotation with family-based theft detection
- [x] All DB queries parameterized
- [x] DB SSL with rejectUnauthorized: true (disabled for railway.internal connections)
- [x] Runtime DB user has no DDL privileges
- [x] All required env vars validated at startup
- [x] Rate limiters on auth endpoints
- [x] Middleware order correct (Helmet → CORS → rate limit → body parser)
- [x] Password reset: same response for existing/non-existing email
- [x] Password reset invalidates all sessions
- [x] Google OAuth verifies iss, aud, exp, nonce
- [x] State parameter verified in OAuth callback
- [x] Helmet HSTS, CSP, X-Frame-Options configured
- [x] CSP enforced in production, report-only in other environments
- [ ] Permissions-Policy header not configured
- [x] .env in .gitignore (no secrets committed)

---

## Known Limitations & Future Improvements

### Current Limitations
1. Email verification not yet implemented (email_verified column exists but unused)
2. Password reset emails sent via Nodemailer (SMTP requires external provider)
3. No 2FA/MFA
4. No account deletion endpoint
5. No password change endpoint (only reset via email)
6. No user profile editing
7. OAuth profile picture not yet displayed

### Recommended Next Steps
1. Implement email verification on registration
2. Add password change endpoint (requires old password verification)
3. Add account deletion (GDPR compliance)
4. Implement 2FA (TOTP)
5. Add user profile management endpoints
6. Set up monitoring/alerting (failed auth attempts, rate limit hits)
7. Add audit logging for sensitive operations
8. Implement request ID tracking for debugging

---

## References

- **Security Rules:** [research/auth-security-rules.md](../research/auth-security-rules.md)
- **Implementation Plan:** [plan/auth-database-railway-setup.md](../plan/auth-database-railway-setup.md)
- **Commits:** See git log for implementation history

---

**Implementation completed:** 2026-04-21  
**Status:** ✅ Ready for Railway deployment  
**Test Environment:** Requires PostgreSQL + email provider setup
