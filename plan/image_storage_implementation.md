# Outfitler – Implementationsplan: datamodell + bildhantering

> Genomför datamodellen i [`outfitler_overview.md`](outfitler_overview.md) §2 och
> besluten i [`image_storage.md`](image_storage.md). Kryssa av steg allteftersom
> – detta är en gemensam checklista.
>
> **Verifiering:** allt körs på Railway (ingen lokal körning). Varje fas ska
> lämna appen deploybar och verifierbar via deploy-loggar + live-URL.
>
> **Beroendeordning:** bildlösningen hänger bildfälten på `garment`-raden, så
> plagg-, outfit- och taggmodellen byggs först (Fas 1–3). Fas 4–5 är själva
> bildlösningen. Fas 6–7 är UI.

---

## Faskarta

| Fas | Innehåll | Leverabel |
|---|---|---|
| 1 | Datamodell (dokumentation) | Överenskommen modell – **klar** |
| 2 | Migrationer: garments, outfits, tags + join-tabeller | Tomt schema i produktion |
| 3 | API: garments, outfits, tags (utan bild) | CRUD + taggning + betyg live |
| 4 | `ImageStore` + R2 | Appen kan skriva/läsa/radera i R2 |
| 5 | Bildpipeline + upp­laddnings-endpoint | En bild per plagg end-to-end via API |
| 6 | Frontend: garderobsvy | Plagg med bild, betyg och taggar i UI:t |
| 7 | Frontend: outfit-byggare | Skapa outfits av plagg, betygsätt, tagga |

---

## Fas 1 – Datamodell ✅ klar

Dokumenterad i [`outfitler_overview.md`](outfitler_overview.md) §2. Sammanfattning:

- **plagg (garment):** `id`, `user_id`, bildkolumner (nullable, `image_storage.md`
  §7), `rating` (SMALLINT 1–5, nullable), `notes` (fritext, nullable),
  `archived` (bool), `created_at`, `updated_at`. **Inget** namn/kategori/färg/märke.
- **outfit:** `id`, `user_id`, `name` (obligatoriskt), `rating` (1–5, nullable),
  `notes` (fritext, nullable), tidsstämplar. Ingen egen bild.
- **tagg (tag):** `id`, `user_id`, `name` – unik per användare, skiftlägesokänsligt;
  skapas implicit när den sätts.
- **betyg:** kolumn på `garment` och `outfit`, ingen egen tabell.
- **Join:** `outfit_garments` (med `position`), `garment_tags`, `outfit_tags`.
- Allt `ON DELETE CASCADE` från `users`.

---

## Fas 2 – Migrationer (schema)

Tre filer, stil som migration 005: idempotent (`IF NOT EXISTS`), explicit
`GRANT` till `app_user`, `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.

- [x] `src/db/migrations/006_create_garments.sql`
  - `garments`: `id`, `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`,
    `image_key_prefix TEXT`, `image_variants JSONB`, `image_width INT`,
    `image_height INT`, `image_bytes INT`, `image_hash TEXT`,
    `image_updated_at TIMESTAMPTZ`,
    `rating SMALLINT CHECK (rating BETWEEN 1 AND 5)`,
    `notes TEXT`,
    `archived BOOLEAN NOT NULL DEFAULT FALSE`,
    `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - `idx_garments_user_id`
  - `GRANT SELECT, INSERT, UPDATE, DELETE ON garments TO app_user;`
- [x] `src/db/migrations/007_create_outfits.sql`
  - `outfits`: `id`, `user_id` (FK CASCADE), `name TEXT NOT NULL`,
    `rating SMALLINT CHECK (rating BETWEEN 1 AND 5)`, `notes TEXT`,
    `created_at`, `updated_at`
  - `outfit_garments`: `outfit_id UUID REFERENCES outfits(id) ON DELETE CASCADE`,
    `garment_id UUID REFERENCES garments(id) ON DELETE CASCADE`,
    `position SMALLINT NOT NULL DEFAULT 0`,
    `PRIMARY KEY (outfit_id, garment_id)`
  - `idx_outfits_user_id`, `idx_outfit_garments_garment_id`
  - `GRANT` på båda tabellerna
- [x] `src/db/migrations/008_create_tags.sql`
  - `tags`: `id`, `user_id` (FK CASCADE), `name TEXT NOT NULL`, `created_at`
  - `CREATE UNIQUE INDEX ... ON tags (user_id, lower(name));`
  - `garment_tags`: `garment_id` + `tag_id` (båda FK CASCADE),
    `PRIMARY KEY (garment_id, tag_id)`
  - `outfit_tags`: `outfit_id` + `tag_id` (båda FK CASCADE),
    `PRIMARY KEY (outfit_id, tag_id)`
  - `idx_garment_tags_tag_id`, `idx_outfit_tags_tag_id`
  - `GRANT` på alla tre tabellerna
- [ ] Push till `main`. `Dockerfile` CMD kör `node src/scripts/migrate.js` vid
  varje deploy, så migrationerna körs automatiskt (alla filer körs om varje
  gång – de nya är idempotenta).
- [ ] Verifiera i Railway deploy-loggen: `✅ Executed: 006_create_garments.sql`,
  `007_create_outfits.sql`, `008_create_tags.sql`, och att servern startar
  (`✅ Server running on port …`).

---

## Fas 3 – API (utan bild)

Alla routes: `requireAuth`, zod-validering (mönster som `routes/auth.js`), varje
fråga filtrerad på `req.user.id`, `app.locals.limiters.general`. 404 om raden
inte finns eller inte ägs av användaren. Montera alla tre i `src/app.js` **före**
`express.static`.

- [ ] `src/services/garmentService.js` + `src/routes/garments.js`
  - `POST   /api/garments` – skapar tomt plagg; body får innehålla `rating`,
    `notes`, `tags[]`
  - `GET    /api/garments` – filter `?tag=`, `?rating=`, `?archived=`
  - `GET    /api/garments/:id`
  - `PATCH  /api/garments/:id` – `rating`, `notes`, `archived`, `tags[]`
    (ersätter taggsättet)
  - `DELETE /api/garments/:id`
- [ ] `src/services/outfitService.js` + `src/routes/outfits.js`
  - `POST   /api/outfits` – `name`, `garmentIds[]`, `rating?`, `notes?`, `tags[]?`
  - `GET    /api/outfits` – filter `?tag=`, `?rating=`
  - `GET    /api/outfits/:id` – inkl. ingående plagg (med bild-URL:er efter Fas 5)
  - `PATCH  /api/outfits/:id` – `name`, `rating`, `notes`, `garmentIds[]`, `tags[]`
  - `DELETE /api/outfits/:id`
- [ ] `src/services/tagService.js` + `src/routes/tags.js`
  - `GET    /api/tags` – användarens taggar + antal användningar
  - `DELETE /api/tags/:id` – tar bort taggen och alla dess kopplingar
  - get-or-create per namn (skiftlägesokänsligt) när taggar sätts via garment/outfit
- [ ] Verifiera live med inloggad token: skapa plagg → sätt betyg + tagg → skapa
  outfit av två plagg → betygsätt outfit → filtrera plagg på tagg → `GET /api/tags`.

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
- [ ] Betyg (1–5, ifylld/kontur enligt §6), taggchips och fritext­fält (`notes`)
  i detaljvyn; filterrad på tagg/betyg/arkiverad ovanför rutnätet.
- [ ] Klientvalidering: storlek < 20 MB, tillåten typ, förhandsvisning.
- [ ] Ladd- och feltillstånd; "Byt bild" ersätter (ingen flera-bilder-UI).
- [ ] `src/middleware/security.js` CSP: `imgSrc` tillåter redan `https:`. Vill
  vi strama åt senare: lägg till R2-endpointen explicit.
- [ ] Verifiera i webbläsaren på live-URL:en: skapa plagg → ladda upp bild →
  sätt betyg + tagg → syns i rutnätet → filtrera → byt bild → uppdateras.

---

## Fas 7 – Frontend: outfit-byggare

- [ ] `public/outfits.html` + `public/js/outfits.js` – lista över outfits, var
  och en visad som sina plaggs `thumb`-bilder.
- [ ] Bygg-vy: välj plagg ur garderoben, ge outfiten `name`, spara via
  `POST /api/outfits`.
- [ ] Redigera: lägg till/ta bort plagg, betygsätt, tagga, fritext (`notes`).
- [ ] Verifiera live: skapa outfit av plagg med bild → syns i listan → redigera →
  radera.

---

## Senare (ej i denna plan)

- Cloudflare Worker på `img.outfitler.app`: riktig auth-koll + edge-cache +
  snyggare URL:er (`image_storage.md` §5).
- Städjobb för föräldralösa R2-objekt (`image_storage.md` §8).
- R2-versioning / backup-synk.
- AVIF-varianter, `srcset` 2× för retina.
- Bakgrundsborttagning (`image_storage.md` §10, beslut 4).
- Outfit-bilder (samma mönster på `outfit`-raden).
- Rikare taggning (färgkodning från fast lågmättad uppsättning, `overview` §6).
- Filtrering/sök på fler axlar (`overview` §3).

---

## Sammanfattning: nya beroenden och miljövariabler

**npm:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `sharp`, `multer`

**Railway-miljövariabler (app-tjänsten):**
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`

**Nya migrationer:** `006_create_garments.sql`, `007_create_outfits.sql`,
`008_create_tags.sql`
