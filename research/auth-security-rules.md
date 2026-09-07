# Säkerhetsregler för Autentisering och Databas

En komplett sammanställning av best practices för säker implementering av inloggning (email/lösenord och Google OAuth) samt databaskonfiguration för Node.js/Express-stacken.

---

## 1. Lösenordshantering

### Krav
- **Aldrig** lagra lösenord i klartext
- **Aldrig** använd snabba hashfunktioner (MD5, SHA-256) för lösenord
- Använd en moderna lösenordshasher med inbyggt salt

### Rekommenderad algoritm

**Argon2id** — Guldstandard 2026
- Vinnare av Password Hashing Competition
- Skydd mot GPU/ASIC-attacker
- Rekommenderade parametrar (OWASP):
  - **Memory:** 19 MiB minimum, 64-128 MiB rekommenderat
  - **Iterations:** 2 minimum, 3-5 rekommenderat
  - **Parallelism:** 1

**Fallback: Bcrypt** (om Argon2 inte är tillgängligt)
- Cost factor: 12-14 (målär 200-500ms beräkningstid)
- Aldrig högre cost factor än så — kan skapa DoS-risk

### Implementation
```javascript
// Argon2id (rekommenderat)
const argon2 = require('argon2');

// Hasha lösenord vid registrering
const hashedPassword = await argon2.hash(plainPassword, {
  memory: 65540,      // 64 MiB
  timeCost: 3,
  parallelism: 1
});

// Verifiera lösenord vid inloggning
const isValid = await argon2.verify(hashedPassword, plainPassword);

// Bcrypt (fallback)
const bcrypt = require('bcryptjs');
const hashedPassword = await bcrypt.hash(plainPassword, 12);
const isValid = await bcrypt.compare(plainPassword, hashedPassword);
```

### Bibliotek
- **`argon2`** (npm) — rekommenderat
- **`bcrypt`** eller **`bcryptjs`** (npm) — fallback

---

## 2. Google OAuth / OpenID Connect

### Krav
- Använd alltid **Authorization Code Flow** (Implicit Flow är deprecated och osäker)
- HTTPS är **obligatoriskt** — Google vägrar HTTP
- Validera ID-token **server-side**, aldrig client-side
- Hämta Googles publika nycklar från OIDC Discovery-dokumentet
- Verifiera alltid dessa claims: `iss`, `aud`, `exp`, `nonce`
- Använd `state`-parameter för CSRF-skydd
- Använd `nonce`-parameter för replay-attack-skydd
- Begränsa scope till minimum: `openid`, `email`, `profile`

### Verifiering av ID-token
```javascript
// Verifiera claims
const claims = {
  iss: 'https://accounts.google.com',
  aud: YOUR_CLIENT_ID,
  exp: Math.floor(Date.now() / 1000),
  nonce: EXPECTED_NONCE
};

// Validera alla dessa innan du accepterar tokenen
```

### Implementation med Passport
```javascript
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: '/auth/google/callback',
  passReqToCallback: true
}, async (req, accessToken, refreshToken, profile, done) => {
  // Verifiera och lagra användare
  const user = await User.findOrCreate(profile);
  return done(null, user);
}));
```

### Bibliotek
- **`passport-google-oauth20`** — enklaste för Express
- **`openid-client`** — lägre nivå, OIDC-kompatibel
- **`google-auth-library`** — Googles eget bibliotek för tokenverifiering

---

## 3. Sessioner vs JWT-tokens

### Sessions (Stateful)
**Fördelar:**
- Lätt att revokera/logga ut
- Mindre cookie
- Servern kontrollerar sessionens livslängd

**Nackdelar:**
- Kräver server-side session-lagring (Redis/databas)
- Svårare att skala horizontellt

**Bäst för:** Traditionella webbappar på en enda domän

### JWT (Stateless)
**Fördelar:**
- Stateless — skalar horisontellt
- Perfekt för API:er och microservices
- Ingen server-side session-lagring krävs

**Nackdelar:**
- Kan inte revokeras innan expiry (utan extra infrastruktur)
- Token är giltig tills den expirerar, även efter logout

**Bäst för:** API:er, mobilappar, microservices

### Rekommenderat hybrid-mönster (2026)

**Access Token:**
- Livslängd: **5-15 minuter**
- Lagring: Minne (JS-variabel), ALDRIG localStorage
- Format: JWT

**Refresh Token:**
- Livslängd: **7-30 dagar**
- Lagring: `HttpOnly` cookie med flaggor: `Secure; SameSite=Strict`
- Implementera **refresh token rotation** — utfärda ny refresh-token vid varje användning

**Cookie-flaggor (obligatoriska):**
```
HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=...
```

### Implementation
```javascript
// Generera tokens
const accessToken = jwt.sign(
  { userId: user.id },
  process.env.ACCESS_TOKEN_SECRET,
  { expiresIn: '10m' }
);

const refreshToken = jwt.sign(
  { userId: user.id },
  process.env.REFRESH_TOKEN_SECRET,
  { expiresIn: '7d' }
);

// Spara refresh-token i HttpOnly cookie
res.cookie('refreshToken', refreshToken, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
});

// Skicka access-token till frontend (i response body)
res.json({ accessToken });
```

### Bibliotek
- **`jsonwebtoken`** (npm) — JWT-signering och verifiering
- **`jose`** (npm) — modernt, OIDC-kompatibelt JWT-bibliotek
- **`express-session`** + **`connect-redis`** — server-side sessions med Redis

---

## 4. Databas-säkerhet (Principle of Least Privilege)

### Krav
- App-användaren får **BARA**: `SELECT`, `INSERT`, `UPDATE`, `DELETE`
- App-användaren får **INTE**: `DROP`, `CREATE`, `TRUNCATE`, eller något superuser-privilegium
- Använd en **separat migrations-användare** med DDL-rättigheter
- Exponera aldrig databasport publikt
- Använd alltid **parameteriserade queries** — aldrig string-interpolation
- Aktivera SSL på databasanslutningen
- Verifiera certifikat: `rejectUnauthorized: true`

### PostgreSQL-konfiguration

**Skapa roller och användare:**
```sql
-- Skapa en readonly-roll
CREATE ROLE app_readonly;
GRANT CONNECT ON DATABASE myapp TO app_readonly;
GRANT USAGE ON SCHEMA public TO app_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

-- Skapa en roll för INSERT/UPDATE/DELETE
CREATE ROLE app_writer IN ROLE app_readonly;
GRANT INSERT, UPDATE, DELETE ON users, sessions TO app_writer;

-- Skapa användaren som appen använder
CREATE USER myapp_runtime WITH PASSWORD 'strong_random_password';
GRANT app_writer TO myapp_runtime;

-- Migrations-användare (separat)
CREATE USER myapp_migration WITH PASSWORD 'migration_password';
GRANT ALL PRIVILEGES ON DATABASE myapp TO myapp_migration;
```

### Connection pooling
```javascript
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: true,
    ca: process.env.DB_SSL_CERT
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

// Aldrig direct query — använd parameteriserade queries
const result = await pool.query(
  'SELECT * FROM users WHERE email = $1',
  [userEmail]
);
```

### Bibliotek
- **`pg`** (node-postgres) — låg-nivå PostgreSQL-klient
- **`knex`** — query builder med parameterisering
- **`drizzle-orm`** — modern TypeScript ORM
- **`prisma`** — high-level ORM med migrations

---

## 5. Hemligheter och Miljövariabler

### Krav
- **Aldrig** commit `.env`-filer till Git
- Lägg till `.env` i `.gitignore` omedelbart
- Skapa en `.env.example` med dummyvärden
- Validera att alla nödvändiga variabler finns vid app-start
- Använd en **central config-modul** — inte `process.env` spritt överallt

### .env-setup
```bash
# .env (ALDRIG committad)
DATABASE_URL=postgresql://user:password@host/db
JWT_SECRET=random_long_secret_key
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_secret
API_KEY=sensitive_api_key

# .env.example (Committa denna)
DATABASE_URL=postgresql://user:password@host/db
JWT_SECRET=your_secret_here
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
API_KEY=your_api_key
```

### Config-modul
```javascript
// config.js
module.exports = {
  database: {
    url: process.env.DATABASE_URL || 'postgresql://localhost/myapp'
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    accessTokenExpiry: '10m',
    refreshTokenExpiry: '7d'
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET
  },
  validate() {
    const required = ['JWT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required env vars: ${missing.join(', ')}`);
    }
  }
};

// app.js
const config = require('./config');
config.validate(); // Kör vid startup
```

### Secrets-hantering

**Lokalt utveckling:**
- Använd `dotenv` (npm)

**Produktion:**
- **AWS Secrets Manager** — cloud-native, audit-loggar, automatisk rotation
- **Infisical** — open-source, developer-friendly
- **HashiCorp Vault** — self-hosted, kraftfull
- **dotenv-vault** — enkelt för små projekt

### Bibliotek
- **`dotenv`** (npm) — lokalt utveckling
- **`@aws-sdk/client-secrets-manager`** — AWS Secrets Manager
- **`infisical/sdk`** — Infisical-integrering
- **`node-vault`** — HashiCorp Vault-klient

---

## 6. Frontend-säkerhet

### XSS-prevention
- Använd moderna ramverk (React, Vue) — de escaper output som standard
- **Aldrig** `dangerouslySetInnerHTML` med användardata
- Implementera **Content Security Policy (CSP)**
- Undvik `eval()`, `setTimeout(string)`, `innerHTML` med opålitlig data
- Sanitera HTML med `DOMPurify` om rendering av användardata är nödvändig

### CSRF-prevention
- `SameSite=Strict` på session-cookies — detta blockerar de flesta CSRF-attacker
- För API:er som använder `Authorization: Bearer` headers — CSRF är inte tillämplig
- För cookie-baserad auth, använd CSRF-tokens (via `csrf-csrf`-biblioteket)

### Cookie-flaggor (obligatoriska)
```javascript
res.cookie('sessionId', sessionToken, {
  httpOnly: true,      // Blockera JS-åtkomst
  secure: true,        // Endast över HTTPS
  sameSite: 'strict',  // Blockera cross-site
  path: '/',           // Specifik path
  maxAge: 3600000      // 1 timme
});
```

### CSP-header-exempel
```javascript
const helmet = require('helmet');

app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'", "https://api.example.com"]
  }
}));
```

### Bibliotek
- **`DOMPurify`** — HTML-sanitering på frontend
- **`csrf-csrf`** — CSRF-token-hantering
- **`helmet`** — security-headers (inkluderar CSP)

---

## 7. Backend-säkerhet (Rate Limiting & Input-validering)

### Rate Limiting

**Globala gränser:**
- Vanliga endpoints: 100 requests per 15 minuter per IP
- Auth-endpoints (login, register): **5-10 requests per 15 minuter**
- Password reset: **3 requests per 30 minuter**

**Respons-format:**
```javascript
res.status(429).json({
  error: 'Too many requests',
  retryAfter: 60  // sekunder
});
res.set('Retry-After', '60');
```

### Input-validering

**Whitelist-approach (inte blacklist):**
- Validera **typ** (string, number, email, etc.)
- Validera **längd** (min/max)
- Validera **format** (regex, e-post, URL, etc.)
- Validera **range** (nummer mellan X och Y)

```javascript
const { body, validationResult } = require('express-validator');

app.post('/auth/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8, max: 128 }).trim().escape(),
  body('username').isAlphanumeric().isLength({ min: 3, max: 20 })
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  // Proceed with registration
});
```

### Middleware-ordning i Express
```javascript
// Denna ordning är KRITISK
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const app = express();

// 1. Security headers
app.use(helmet());

// 2. CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS.split(','),
  credentials: true
}));

// 3. Rate limiting (före body-parsing)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts'
});

// 4. Body parser
app.use(express.json({ limit: '10kb' })); // Begränsa payload-size

// 5. Input validation (middleware)
const validateInput = [
  body('email').isEmail(),
  body('password').isLength({ min: 8 })
];

// 6. Routes (med validering)
app.post('/auth/login', authLimiter, validateInput, (req, res) => {
  // ...
});
```

### Bibliotek
- **`express-rate-limit`** — standard rate limiting
- **`rate-limit-redis`** — Redis-backed rate limiting för distribuerad miljö
- **`express-validator`** — validering + sanitering
- **`zod`** eller **`joi`** — schema-baserad validering
- **`helmet`** — security headers

---

## 8. HTTPS / TLS

### Krav
- **TLS 1.3** är standard 2026 (TLS 1.0/1.1 är deprecated)
- TLS 1.2 är det absoluta minimumet
- **HTTPS är obligatoriskt** för all auth-relaterad trafik
- Använd en **reverse proxy** (nginx, Caddy) — inte Node.js native `https`-modul

### Let's Encrypt / Certbot
```bash
# Installera Certbot
sudo apt-get install certbot

# Generera certifikat
sudo certbot certonly --standalone -d yourdomain.com

# Auto-renewal (Certbot gör detta automatiskt)
sudo systemctl enable certbot.timer
```

### HSTS-header (obligatorisk)
```javascript
const helmet = require('helmet');

app.use(helmet.hsts({
  maxAge: 31536000,        // 1 år
  includeSubDomains: true,
  preload: true            // Registrera på HSTS preload-list
}));
```

### Nginx-konfiguration
```nginx
server {
  listen 443 ssl http2;
  server_name yourdomain.com;

  ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

  ssl_protocols TLSv1.3 TLSv1.2;
  ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
  ssl_prefer_server_ciphers on;

  # Redirect HTTP to HTTPS
  return 301 https://$server_name$request_uri;

  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}

# HTTP redirect
server {
  listen 80;
  server_name yourdomain.com;
  return 301 https://$server_name$request_uri;
}
```

---

## 9. Lösenordsåterställning

### Flöde
1. Användare fyller i email
2. Generera kryptografisk slumpmässig token
3. **Hasha tokenen** innan lagring i databas
4. Skicka **klartext-token** i email-länk
5. Användare klickar länk, verifiera hashen i databasen
6. Sätt nytt lösenord
7. Invalidera **alla** befintliga sessioner för den användaren

### Implementation

```javascript
const crypto = require('crypto');
const argon2 = require('argon2');

// 1. Generate & hash reset token
app.post('/auth/forgot-password', async (req, res) => {
  const { email } = req.body;

  // Returnera samma svar oavsett om email finns (förhindra enumeration)
  const user = await User.findOne({ email });
  if (!user) {
    return res.json({ message: 'Check your email for reset link' });
  }

  // Generera random token
  const resetToken = crypto.randomBytes(32).toString('hex');

  // Hasha token
  const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

  // Spara hashen med expiry
  await PasswordReset.create({
    userId: user.id,
    token: hashedToken,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minuter
  });

  // Skicka email med klartext-token
  await sendEmail(email, `https://yourapp.com/reset-password?token=${resetToken}`);

  return res.json({ message: 'Check your email for reset link' });
});

// 2. Verify token & reset password
app.post('/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;

  // Hasha token för jämförelse
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  // Verifiera token
  const reset = await PasswordReset.findOne({
    token: hashedToken,
    expiresAt: { $gt: new Date() }
  });

  if (!reset) {
    return res.status(400).json({ error: 'Invalid or expired token' });
  }

  const user = await User.findById(reset.userId);

  // Sätt nytt lösenord
  user.password = await argon2.hash(newPassword);
  await user.save();

  // Invalidera alla sessioner
  await Session.deleteMany({ userId: user.id });

  // Invalidera reset-token (engångsanvändbar)
  await PasswordReset.deleteOne({ _id: reset._id });

  res.json({ message: 'Password reset successful' });
});
```

### Krav
- Token-typ: **64-character hex** (från `crypto.randomBytes(32).toString('hex')`)
- Giltighetstid: **15-60 minuter** (OWASP max 1 timme)
- **Engångsanvändbar** — invalidera direkt efter användning
- Returnera alltid samma svar (förhindra user enumeration)
- Rate-limitera requests för password reset
- Invalidera **alla** sessioner efter lyckad reset

---

## 10. Security Headers (Helmet.js)

### Vad gör Helmet?
`app.use(helmet())` aktiverar 13 security headers automatiskt:

| Header | Syfte | Rekommendation |
|--------|-------|----------------|
| `Strict-Transport-Security` | Tvinga HTTPS | `max-age=31536000; includeSubDomains; preload` |
| `Content-Security-Policy` | Blockera XSS | Whitelist trusted sources |
| `X-Content-Type-Options` | Förhindra MIME-sniffing | `nosniff` |
| `X-Frame-Options` | Förhindra clickjacking | `DENY` eller `SAMEORIGIN` |
| `Referrer-Policy` | Kontrollera referrer-info | `no-referrer` |
| `Permissions-Policy` | Begränsa browser-features | Disable onödiga features |
| `Cross-Origin-Opener-Policy` | Isolera browsing-context | `same-origin` |
| `X-DNS-Prefetch-Control` | Minska DNS-läckage | `off` |
| `X-XSS-Protection` | Legacy XSS-skydd | Aktiverad (för gamla browsers) |
| `X-Content-Security-Policy` | Legacy CSP | Aktiverad (för gamla browsers) |
| `Expect-CT` | Certificate Transparency | Aktiverad (experimentell) |
| `Public-Key-Pins` | HPKP | Deprecated, men kan aktiveras |

### Implementation

```javascript
const helmet = require('helmet');

app.use(helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "trusted-cdn.com"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Tighten i produktion
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.example.com"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      fontSrc: ["'self'"]
    },
    reportUri: '/csp-report' // Mottag CSP-överträdelse-rapporter
  },

  // Strict Transport Security
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },

  // Förhindra MIME-sniffing
  noSniff: true,

  // Förhindra clickjacking
  frameguard: {
    action: 'deny'
  },

  // Referrer-policy
  referrerPolicy: {
    policy: 'no-referrer'
  },

  // Permissions-Policy
  permissionsPolicy: {
    features: {
      camera: ["'none'"],
      microphone: ["'none'"],
      geolocation: ["'none'"],
      paymentRequest: ["'self'"]
    }
  },

  // Cross-Origin-Opener-Policy
  crossOriginOpenerPolicy: true,

  // Disable X-Powered-By
  hidePoweredBy: true
}));

// CSP-rapportmottagare (optional men rekommenderat)
app.post('/csp-report', (req, res) => {
  const { 'csp-report': report } = req.body;
  console.warn('CSP Violation:', report);
  // Lagra i logg/monitoring-system
  res.sendStatus(204);
});
```

### CSP Best Practices

**Development-mode (Report-Only):**
```javascript
app.use(helmet.contentSecurityPolicy({
  directives: { /* ... */ },
  reportOnly: true // Bara rapportera, blockera inte
}));
```

**Production-mode (Enforce):**
```javascript
app.use(helmet.contentSecurityPolicy({
  directives: { /* ... */ },
  reportOnly: false // Blockera överträdelser
}));
```

---

## Snabb Referenslista: Library Stack

| Område | Bibliotek |
|--------|-----------|
| **Lösenordshasning** | `argon2`, fallback `bcrypt` |
| **JWT** | `jsonwebtoken`, `jose` |
| **Sessions** | `express-session` + `connect-redis` |
| **Google OAuth** | `passport-google-oauth20`, `openid-client` |
| **Security Headers** | `helmet` |
| **Rate Limiting** | `express-rate-limit` + `rate-limit-redis` |
| **Input Validation** | `express-validator`, `zod`, `joi` |
| **HTML Sanitization** | `DOMPurify` (frontend) |
| **CSRF-tokens** | `csrf-csrf` |
| **Secrets (Dev)** | `dotenv` |
| **Secrets (Prod)** | AWS Secrets Manager, Infisical, HashiCorp Vault |
| **Database** | `pg`, `knex`, `drizzle-orm`, `prisma` |

---

## Checklista för Implementation

- [ ] Lösenord hashes med Argon2id (eller Bcrypt)
- [ ] Google OAuth med Authorization Code Flow
- [ ] HTTPS/TLS obligatorisk
- [ ] JWT access + refresh tokens implementerade
- [ ] Databas-användare med Principle of Least Privilege
- [ ] `.env`-filer inte committade (.gitignore)
- [ ] Rate limiting på auth-endpoints
- [ ] Input-validering och sanitering
- [ ] Helmet.js för security headers
- [ ] CORS korrekt konfigurerad
- [ ] Password reset med engångs-token
- [ ] Alla sessioner invaliderade vid logout
- [ ] CSP-headers implementerade
- [ ] HSTS aktiverat
- [ ] Refresh token rotation implementerad
