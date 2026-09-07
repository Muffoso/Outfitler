# Plan: PostgreSQL + Auth (email/password + Google OAuth) på Railway

## Context

Projektet är en minimal Express.js-app på Railway.app som just nu bara serverar en statisk HTML-sida. Målet är att lägga till:
1. PostgreSQL-databas via Railway addon
2. Email/lösenord-inloggning
3. Google OAuth-inloggning

Alla säkerhetsregler från `research/auth-security-rules.md` måste följas exakt.

---

## Filstruktur (ny/modifierad)

```
/
├── server.js                          (modifiera - tunn entry point)
├── package.json                       (modifiera - lägg till dependencies)
├── Dockerfile                         (modifiera - kör migrations vid deploy)
├── .env.example                       (skapa)
├── .gitignore                         (modifiera - säkerställ .env finns)
│
├── src/
│   ├── app.js                         (skapa - Express app factory)
│   ├── config/
│   │   └── index.js                   (skapa - central config + startup-validering)
│   │
│   ├── db/
│   │   ├── pool.js                    (skapa - pg Pool-instans)
│   │   └── migrations/
│   │       ├── 001_create_users.sql
│   │       ├── 002_create_refresh_tokens.sql
│   │       └── 003_create_password_reset_tokens.sql
│   │
│   ├── middleware/
│   │   ├── security.js                (skapa - helmet, cors, rate limiters)
│   │   ├── authenticate.js            (skapa - JWT-verifiering)
│   │   └── validate.js                (skapa - zod-scheman)
│   │
│   ├── routes/
│   │   ├── auth.js                    (skapa - /api/auth/* endpoints)
│   │   └── oauth.js                   (skapa - /auth/google/* endpoints)
│   │
│   ├── services/
│   │   ├── authService.js
│   │   ├── tokenService.js
│   │   ├── passwordService.js
│   │   └── emailService.js
│   │
│   ├── passport/
│   │   └── googleStrategy.js
│   │
│   └── scripts/
│       └── migrate.js
│
└── public/
    ├── index.html                     (modifiera)
    ├── login.html                     (skapa)
    ├── register.html                  (skapa)
    └── js/
        └── auth.js                    (skapa)
```

---

## npm-paket att installera

```bash
npm install argon2 jsonwebtoken pg passport passport-google-oauth20 \
  express-rate-limit zod helmet cors nodemailer express-session \
  connect-pg-simple cookie-parser

npm install --save-dev dotenv
```

---

## Miljövariabler (.env.example)

```
NODE_ENV=development
PORT=3000

# Databas - runtime-användare (begränsade rättigheter)
DATABASE_URL=postgresql://app_user:password@host:5432/dbname?sslmode=require

# Databas - migrations-användare (DDL-rättigheter)
MIGRATION_DATABASE_URL=postgresql://migration_user:password@host:5432/dbname?sslmode=require

# JWT
JWT_SECRET=replace-with-64-char-random-hex
JWT_ACCESS_EXPIRES_IN=10m
JWT_REFRESH_EXPIRES_IN=7d
REFRESH_TOKEN_MAX_AGE_SECONDS=604800

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_CALLBACK_URL=https://your-app.railway.app/auth/google/callback

# Session (för OAuth-handskakning)
SESSION_SECRET=replace-with-64-char-random-hex

# Email (lösenordsåterställning)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=smtp-password
EMAIL_FROM=noreply@example.com
APP_URL=https://your-app.railway.app

CORS_ORIGINS=https://your-app.railway.app
```

---

## Databasschema

### SQL-migrationer (körs via migrations-användaren, idempotenta med IF NOT EXISTS)

**001_create_users.sql**
```sql
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT,           -- NULL för OAuth-konton
  google_id     TEXT UNIQUE,    -- NULL för lösenordskonton
  display_name  TEXT,
  avatar_url    TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
```

**002_create_refresh_tokens.sql** — med `family`-kolumn för stölddetektering (om återkallad token presenteras, återkalla hela familjen)

**003_create_password_reset_tokens.sql** — `token_hash` lagras, plaintext skickas i e-post, `used_at` säkerställer single-use

### Databasanvändare på Railway (körs en gång via Railway DB shell)
```sql
-- Migration-användare: kan skapa/ändra tabeller
CREATE USER migration_user WITH PASSWORD '...';
GRANT CONNECT ON DATABASE dbname TO migration_user;
GRANT CREATE ON SCHEMA public TO migration_user;

-- Runtime-användare: endast DML
CREATE USER app_user WITH PASSWORD '...';
GRANT CONNECT ON DATABASE dbname TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE migration_user IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
```

---

## Nyckelmoduler

### `src/config/index.js`
- Läser alla env-vars, validerar att samtliga krävda finns vid startup
- Om något saknas: logga variabelnamnet + `process.exit(1)`
- Frys objektet och exportera — ingen annan modul kallar `process.env` direkt

### `src/db/pool.js`
- `pg.Pool` med: `max: 20`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 2000`, `ssl: { rejectUnauthorized: true }`

### `src/middleware/security.js` — middleware-ordning (kritisk)
1. `helmet()` med HSTS `maxAge: 31536000; includeSubDomains; preload`, CSP, X-Frame-Options: DENY
2. `cors()` med `credentials: true`
3. Rate limiters:
   - Generell: 100 req/15min
   - Auth (login/register): 5 req/15min
   - Password reset: 3 req/30min
   - HTTP 429 + `Retry-After` header
4. `cookie-parser()`
5. `express.json({ limit: '10kb' })`

### `src/services/tokenService.js`
- Access token: JWT HS256, 5-15 min, signeras med `JWT_SECRET`
- Refresh token: `crypto.randomBytes(32).toString('hex')` → lagras hashad (SHA-256) i DB
- Rotation: vid refresh sätts `revoked_at` på gammal rad, ny rad skapas med samma `family`
- Stölddetektering: om återkallad token presenteras → återkalla hela familjen
- Cookie: `HttpOnly; Secure; SameSite=Strict; Path=/`

### `src/services/passwordService.js`
- Hash: `argon2id`, `memoryCost: 19456` (19 MiB), `timeCost: 2`, `parallelism: 1`
- Reset-token: `crypto.randomBytes(32).toString('hex')`, giltig 30 min, single-use
- Samma svar oavsett om e-posten finns (motverkar user enumeration)

### `src/services/authService.js`
- `login()`: normalisera email, om inte hittad kör ändå argon2.verify med dummy-hash (timing attack-skydd)
- `loginWithGoogle()`: koppla google_id till befintligt konto om e-post matchar
- `revokeAllUserTokens()`: återkalla alla refresh tokens efter lösenordsåterställning

### `src/routes/auth.js` — endpoints
- `POST /api/auth/register` — zod: `{ email: string().email().max(254), password: string().min(8).max(128) }`
- `POST /api/auth/login`
- `POST /api/auth/refresh` — läser refresh-cookie
- `POST /api/auth/logout`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

### `src/passport/googleStrategy.js`
- Authorization Code Flow
- Verifierar `iss`, `aud`, `exp`, `nonce`
- `state`-parameter för CSRF-skydd
- Scope: `openid email profile` (minimum)

### `src/app.js`
Express-fabrik (ingen `listen`):
1. cookie-parser
2. security middleware (ovan)
3. session (connect-pg-simple, för OAuth nonce-lagring)
4. passport
5. Montera `/api/auth` och `/auth/google`
6. Servera `public/` statiskt (sist)
7. Global error handler (logga internt, returnera generisk 500)

### `server.js` (modifierad)
```js
// Ladda dotenv endast i development
// Importera config (triggar validering/exit om env saknas)
// app.listen(config.port)
// Hantera SIGTERM: pool.end() → process.exit(0)
```

### Frontend: `public/js/auth.js` (ES-modul)
- `let accessToken = null` — lagras ALDRIG i localStorage/sessionStorage
- `refreshAccessToken()`: silent refresh via cookie vid sidladdning
- `authFetch()`: lägger till `Authorization: Bearer` header, retry vid 401
- `logout()`: POST /logout, nollställ token, redirect

---

## Implementationsordning

**Fas 1: Grund**
1. Installera npm-paket
2. `.env.example` + `.gitignore`
3. `src/config/index.js`
4. `src/db/pool.js` + SQL-migrationsfiler
5. `src/scripts/migrate.js`

**Fas 2: Security middleware**
6. `src/middleware/security.js`
7. `src/app.js` (bara security + static)
8. Modifiera `server.js`

**Fas 3: Lösenordsautentisering**
9. `passwordService.js`, `tokenService.js`, `authService.js`
10. `authenticate.js` middleware
11. `src/routes/auth.js`
12. Testa med curl: register → login → refresh → logout

**Fas 4: Email**
13. `emailService.js`
14. Lägg till forgot/reset-password routes
15. Testa hela reset-flödet

**Fas 5: Google OAuth**
16. Skapa OAuth-credentials i Google Cloud Console
17. `googleStrategy.js` + `src/routes/oauth.js`
18. Lägg till session middleware i app.js
19. Testa OAuth end-to-end

**Fas 6: Frontend**
20. `public/js/auth.js`
21. `public/login.html`, `public/register.html`
22. Modifiera `public/index.html`

**Fas 7: Railway-deploy**
23. Sätt env-vars i Railway dashboard
24. Modifiera `Dockerfile` CMD: `node src/scripts/migrate.js && node server.js`
25. Skapa DB-användare via Railway DB shell
26. Deploy + verifiera i Railway-loggar

---

## Verifiering

- `curl -X POST /api/auth/register` → 201 + accessToken i svar, refresh-cookie satt
- `curl -X POST /api/auth/login` → 200 + tokens
- `curl -X POST /api/auth/refresh` med cookie → ny accessToken
- `curl -X POST /api/auth/logout` → 204, cookie rensad
- Password reset: skicka e-post → klicka länk → byt lösenord → gamla tokens ogiltiga
- Google OAuth: redirect till Google → callback → tokens utfärdade
- Rate limiting: >5 inloggningsförsök på 15 min → 429
- Säkerhet: kontrollera att `X-Frame-Options: DENY`, `Strict-Transport-Security` finns i headers

---

## Kritiska filer att modifiera/skapa

- [server.js](server.js)
- [package.json](package.json)
- [Dockerfile](Dockerfile)
- [src/config/index.js](src/config/index.js)
- [src/app.js](src/app.js)
- [src/db/pool.js](src/db/pool.js)
- [src/services/tokenService.js](src/services/tokenService.js)
- [src/services/passwordService.js](src/services/passwordService.js)
- [src/services/authService.js](src/services/authService.js)
- [src/middleware/security.js](src/middleware/security.js)
- [src/routes/auth.js](src/routes/auth.js)
- [src/passport/googleStrategy.js](src/passport/googleStrategy.js)
