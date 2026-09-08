# Outfitler – Implementationsplan: Bildhantering

> Genomför besluten i [`image_storage.md`](image_storage.md). Kryssa av steg
> allteftersom – detta är en gemensam checklista.
>
> **Verifiering:** allt körs på Railway (ingen lokal körning). Varje fas ska
> lämna appen deploybar och verifierbar via deploy-loggar + live-URL.
>
> **Beroendeordning:** bildlösningen hänger bildfälten på `garment`-raden, så
> plaggmodellen måste finnas först. Fas 1–3 bygger den grunden; Fas 4–6 är
> själva bildlösningen.

---

## Faskarta

| Fas | Innehåll | Leverabel |
|---|---|---|
| 1 | Datamodell för plagg (dokumentation) | Överenskommen kolumnlista |
| 2 | `garments`-tabell + migration | Tom tabell i produktion |
| 3 | Plagg-API (utan bild) | Plagg-CRUD live |
| 4 | `ImageStore` + R2 | Appen kan skriva/läsa/radera i R2 |
| 5 | Bildpipeline + upp­laddnings-endpoint | En bild per plagg end-to-end via API |
| 6 | Frontend: garderobsvy | Lägga till plagg med bild i UI:t |

---

## Fas 1 – Datamodell för plagg (förutsättning, görs gemensamt)

Mål: fylla i **Datamodell §2** i `outfitler_overview.md` tillräckligt för att
`garments` ska kunna skapas. Ingen kod.

- [ ] Beslut: fält på `garment` – utöver `id`, `user_id`, `created_at`,
  `updated_at`. Förslag: `name`, `category`, `color`, `brand`, `notes`,
  `archived` (bool). Taggar och betyg kan skjutas till senare fas.
- [ ] Beslut: relation `garment` → `user` (ägs av `user_id UUID REFERENCES users(id)`).
- [ ] Beslut: bekräfta bildkolumnerna från `image_storage.md` §7:
  `image_key_prefix`, `image_variants jsonb`, `image_width`, `image_height`,
  `image_bytes`, `image_hash`, `image_updated_at` (alla nullable).
- [ ] Beslut: ska outfits/taggar/betyg med i samma omgång eller egen plan?
- [ ] Dokumentera i `outfitler_overview.md` §2 (och ev. eget `plan/data_model.md`
  om det blir omfattande).

---

## Fas 2 – `garments`-tabell + migration

- [ ] `src/db/migrations/006_create_garments.sql`:
  - `CREATE TABLE IF NOT EXISTS garments (...)` enligt Fas 1, med bild­kolumnerna
    nullable.
  - `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`.
  - `CREATE INDEX IF NOT EXISTS idx_garments_user_id ON garments(user_id);`
  - Explicit `GRANT SELECT, INSERT, UPDATE, DELETE ON garments TO app_user;`
    (som migration 005 – `ALTER DEFAULT PRIVILEGES` i 004 täcker det också,
    men var explicit).
- [ ] Kör migrationen mot `MIGRATION_DATABASE_URL` enligt
  [`auth-database-railway-setup.md`](auth-database-railway-setup.md).
- [ ] Verifiera i Railway-loggen: `✅ Executed: 006_create_garments.sql`.

---

## Fas 3 – Plagg-API (utan bild)

- [ ] `src/services/garmentService.js` – frågor mot `pool`, **alltid** filtrerade
  på `user_id`. `list`, `getById`, `create`, `update`, `remove`.
- [ ] `src/routes/garments.js` – `requireAuth` på alla routes, zod-validering
  (samma mönster som `routes/auth.js`):
  - `POST   /api/garments`
  - `GET    /api/garments`
  - `GET    /api/garments/:id`
  - `PATCH  /api/garments/:id`
  - `DELETE /api/garments/:id`
  - 404 om plagget inte finns eller inte ägs av `req.user.id`.
- [ ] Montera i `src/app.js` före `express.static`:
  `app.use('/api/garments', require('./routes/garments'));`
- [ ] Rate limiting: applicera `app.locals.limiters.general` på routern.
- [ ] Verifiera live med en inloggad access-token: skapa → lista → hämta →
  uppdatera → radera ett plagg.

---

## Fas 4 – Lagringslager (`ImageStore`) + R2

### 4a. Förberedelser i Cloudflare (användaren, utanför koden)

- [ ] Cloudflare-konto, aktivera R2 (kräver registrerat kort; $0 under gratisnivån).
- [ ] Skapa bucket `outfitler-images` – **Location hint: EU**, ingen public
  access, ingen custom domain.
- [ ] Skapa R2 API-token scoped till bucketen (Object Read & Write). Notera:
  **Account ID**, **Access Key ID**, **Secret Access Key**.
- [ ] Lägg till i Railway (**app-tjänsten**, inte migrate):
  `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET=outfitler-images`.
  > `src/config/index.js` hårdfailar på saknade obligatoriska vars – sätt dem
  > i Railway **före** deployen som lägger till dem i `requiredEnvVars`.

### 4b. Kod

- [ ] `npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`
- [ ] `src/config/index.js`: lägg R2-varsna i `requiredEnvVars` och exponera
  `config.r2 = { accountId, accessKeyId, secretAccessKey, bucket }`.
- [ ] `src/services/imageStore/r2.js`:
  - `S3Client` med `region: 'auto'`,
    `endpoint: https://<accountId>.r2.cloudflarestorage.com`, credentials.
  - `put(key, buffer, contentType)` – `PutObjectCommand` med
    `CacheControl: 'public, max-age=31536000, immutable'`.
  - `signedUrl(key, ttlSeconds = 604800)` – `getSignedUrl(client, GetObjectCommand, { expiresIn })`.
  - `del(keys[])` – `DeleteObjectsCommand` (batch).
  - `delPrefix(prefix)` – `ListObjectsV2` + `del` (för att städa en gammal bild).
- [ ] `src/services/imageStore/index.js` – exporterar vald driver (nu bara `r2`;
  seam för `local`/`memory` senare).
- [ ] Tillfällig verifiering: en engångs-endpoint eller skript som gör
  `put` + `signedUrl` + hämtar tillbaka + `del`. Ta bort efteråt.

---

## Fas 5 – Bildpipeline + uppladdnings-endpoint

- [ ] `npm i sharp multer`
- [ ] Kontrollera i Railway **build**-loggen att `sharp` drar in en förbyggd
  binär med HEIF-stöd (för iPhone-HEIC).
- [ ] `src/services/imageProcessor.js` – tar en `Buffer`:
  - Validera magic bytes (jpeg / png / webp / heic / heif) → annars fel `415`.
  - `sharp(buf).rotate()` (EXIF-orientering) och strippa metadata i utdata.
  - Generera varianter:
    - `archive` – långsida ≤ 2560 px, WebP q82
    - `card` – långsida 1000 px, WebP q78
    - `thumb` – långsida 500 px, WebP q72
  - Returnera `{ variants: {thumb,card,archive}, width, height, bytes, hash }`
    (hash = sha256 av arkivbufferten).
- [ ] Endpoints i `src/routes/garments.js` (eller `src/routes/images.js`):
  - `PUT /api/garments/:id/image` – `requireAuth`, äger plagget?,
    `multer({ storage: memoryStorage(), limits: { fileSize: 20*1024*1024 } })`:
    1. nytt `imageId = crypto.randomUUID()`
    2. prefix `users/{userId}/garments/{garmentId}/{imageId}`
    3. processa → `put` alla tre varianter (`.../thumb.webp` osv.)
    4. `UPDATE garments SET image_key_prefix, image_variants, image_width, …`
    5. om plagget hade en gammal bild: `delPrefix(gammalt prefix)`
    6. svara med signerade URL:er per variant
  - `DELETE /api/garments/:id/image` – `delPrefix` + nolla `image_*`-kolumnerna.
- [ ] Ny limiter `app.locals.limiters.upload` (t.ex. 30 / 15 min) i
  `src/middleware/security.js`, applicera på uppladdnings-routen.
- [ ] Felhantering: multer `LIMIT_FILE_SIZE` → `413`; ogiltig typ → `415`.
- [ ] `GET /api/garments` och `/:id`: berika varje plagg med färska signerade
  URL:er (`image: { thumb, card, archive }` eller `null`).
- [ ] Verifiera live: ladda upp en JPEG → URL:er i svaret → bilderna öppnas →
  ladda upp en ny → kontrollera i Cloudflare-dashboarden att det gamla
  prefixet är borta.

---

## Fas 6 – Frontend: garderobsvy

- [ ] `public/wardrobe.html` (eller bygg ut `index.html`) – rutnät av plagg med
  `thumb`, tydligt tom-läge. Palett-tokens (`var(--...)`), palettväxlaren kvar.
- [ ] `public/js/wardrobe.js` – `authFetch('/api/garments')`, rendera kort;
  klick → detaljvy med `card`-bilden.
- [ ] Skapa/redigera plagg + **ladda upp/byt bild**:
  `<input type="file" accept="image/jpeg,image/png,image/webp,image/heic">`,
  `PUT /api/garments/:id/image` som `multipart/form-data`.
- [ ] Klientvalidering: storlek < 20 MB, tillåten typ, förhandsvisning.
- [ ] Ladd- och feltillstånd; "Byt bild" ersätter (ingen flera-bilder-UI).
- [ ] `src/middleware/security.js` CSP: `imgSrc` tillåter redan `https:`. Vill
  vi strama åt senare: lägg till R2-endpointen explicit.
- [ ] Verifiera i webbläsaren på live-URL:en: skapa plagg → ladda upp bild →
  syns i rutnätet → byt bild → uppdateras.

---

## Senare (ej i denna plan)

- Cloudflare Worker på `img.outfitler.app`: riktig auth-koll + edge-cache +
  snyggare URL:er (`image_storage.md` §5).
- Städjobb för föräldralösa R2-objekt (`image_storage.md` §8).
- R2-versioning / backup-synk.
- AVIF-varianter, `srcset` 2× för retina.
- Bakgrundsborttagning (`image_storage.md` §10, beslut 4).
- Outfit-bilder (samma mönster på `outfit`-raden).

---

## Sammanfattning: nya beroenden och miljövariabler

**npm:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `sharp`, `multer`

**Railway-miljövariabler (app-tjänsten):**
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`

**Nya migrationer:** `006_create_garments.sql` (+ ev. fler i Fas 1-beslutet)
