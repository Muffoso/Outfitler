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
| 5 | Bildpipeline + upp­laddnings-endpoint | En bild per plagg end-to-end via API — **klar, verifiera live** |
| 6a | Frontend: garderobsvy (Fas 3-funktioner) | Plagg, betyg, taggar, notes i UI:t — **klar** |
| 6b | Frontend: bild i garderobsvyn | Ladda upp/byt/ta bort bild i UI:t — **klar, verifiera live** |
| 7 | Frontend: outfit-byggare | Skapa outfits av plagg, betygsätt, tagga — **klar, verifiera live** |

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

Alla routes: `requireAuth`, zod-validering (delad `middleware/validate.js`), varje
fråga filtrerad på `req.user.id`, `app.locals.limiters.general`. 404 om raden
inte finns eller inte ägs av användaren. Skrivningar med taggar/plagg går i
transaktion (`src/db/withTransaction.js`). `:id` som inte är en UUID → 404
(`router.param`). Alla tre monterade i `src/app.js` före `express.static`.
CORS-metoderna utökade med `PATCH` i `middleware/security.js`.

- [x] `src/services/garmentService.js` + `src/routes/garments.js`
  - `POST   /api/garments` – skapar tomt plagg; body får innehålla `rating`,
    `notes`, `tags[]`
  - `GET    /api/garments` – filter `?tag=`, `?rating=`, `?archived=`
  - `GET    /api/garments/:id`
  - `PATCH  /api/garments/:id` – `rating`, `notes`, `archived`, `tags[]`
    (ersätter taggsättet)
  - `DELETE /api/garments/:id`
- [x] `src/services/outfitService.js` + `src/routes/outfits.js`
  - `POST   /api/outfits` – `name`, `garmentIds[]`, `rating?`, `notes?`, `tags[]?`
  - `GET    /api/outfits` – filter `?tag=`, `?rating=`
  - `GET    /api/outfits/:id` – inkl. ingående plagg (med bild-URL:er efter Fas 5)
  - `PATCH  /api/outfits/:id` – `name`, `rating`, `notes`, `garmentIds[]`, `tags[]`
  - `DELETE /api/outfits/:id`
- [x] `src/services/tagService.js` + `src/routes/tags.js`
  - `GET    /api/tags` – användarens taggar + antal användningar
  - `DELETE /api/tags/:id` – tar bort taggen och alla dess kopplingar
  - get-or-create per namn (skiftlägesokänsligt) när taggar sätts via garment/outfit
- [x] Route-, validerings- och serialiseringslagret verifierat lokalt med stubbad
  pool (22 fall: auth, validering, `:id`-UUID, CRUD, taggning, outfit-ägarkoll).
- [ ] Verifiera live med inloggad token: skapa plagg → sätt betyg + tagg → skapa
  outfit av två plagg → betygsätt outfit → filtrera plagg på tagg → `GET /api/tags`.

---

## Fas 4 – Lagringslager (`ImageStore`) + R2

### 4a. Förberedelser i Cloudflare (användaren, utanför koden)

- [x] Cloudflare-konto, aktivera R2 (kräver registrerat kort; $0 under gratisnivån).
- [x] Skapa bucket `outfitler-images` – ingen public access, ingen custom domain.
- [x] Skapa R2 API-token scoped till bucketen (Object Read & Write): **Account
  ID**, **Access Key ID**, **Secret Access Key**.
- [x] Railway (**app-tjänsten**): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=outfitler-images`.

### 4b. Kod

- [x] `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` i `package.json`.
- [x] `src/config/index.js`: R2-varsna i `requiredEnvVars`; `config.r2 =
  { accountId, accessKeyId, secretAccessKey, bucket, endpoint }`.
- [x] `src/services/imageStore/r2.js`: `S3Client` (`region: 'auto'`, R2-endpoint),
  `put` (immutable Cache-Control), `signedUrl` (default 7 dygn, kapat till
  SigV4-max), `del(keys[])`, `delPrefix(prefix)`.
- [x] `src/services/imageStore/index.js` – exporterar `r2`-drivern (seam för
  `local` senare).
- [x] Tillfällig verifiering: `GET /api/_storage-selftest` (`requireAuth`) +
  knappen "Testa lagring" i garderobsvyn – gör put → signedUrl → fetch → del.
  **Route, knapp och handler tas bort i början av Fas 5.**
- [ ] Kör "Testa lagring" på live-deployen → förväntat `ok: true` med alla steg.

---

## Fas 5 – Bildpipeline + uppladdnings-endpoint

- [x] `sharp` + `multer` i `package.json`. **`sharp@0.35` kräver Node ≥ 20** →
  `Dockerfile` bumpad `node:18-alpine` → `node:20-alpine` (Node 18 är EOL ändå).
  Samma bump behövs i [[template-repo]].
- [ ] Kontrollera i Railway **build**-loggen att `sharp` drar in en förbyggd
  musl-binär med HEIF-stöd (för iPhone-HEIC).
- [x] `src/services/imageProcessor.js` – magic-byte-koll (jpeg/png/webp/heic →
  annars `UNSUPPORTED_TYPE`), `sharp().rotate()` (EXIF, strippas i utdata),
  varianter `archive` ≤2560/q82, `card` 1000/q78, `thumb` 500/q72 → WebP.
  Returnerar per-variant `{buffer,width,height}` + `bytes` + `hash` (sha256).
- [x] `src/routes/garments.js`:
  - `PUT /api/garments/:id/image` – `requireAuth`, ägarkoll, `multer`
    memoryStorage 20 MB / 1 fil. Nytt `imageId`, prefix
    `users/{userId}/garments/{garmentId}/{imageId}`, `put` alla tre varianter,
    `setImage(...)`, `delPrefix(gammalt prefix)`, svara med serialiserat plagg.
  - `DELETE /api/garments/:id/image` – `clearImage` + `delPrefix`.
- [x] Limiter `app.locals.limiters.upload` (40 / 15 min) i
  `src/middleware/security.js`, på uppladdnings-routen.
- [x] Felhantering: `LIMIT_FILE_SIZE` → `413`; ogiltig typ → `415`; ingen fil → `400`.
- [x] `garmentService` serialiserar `image: { thumb:{url,w,h}, card, archive,
  width, height }` med färska signerade URL:er, `null` när ingen bild finns.
  `DELETE /api/garments/:id` städar även R2.
- [x] Tog bort den tillfälliga `/api/_storage-selftest` + "Testa lagring"-knappen.
- [x] Verifierat lokalt med stubbad pool/store + riktig `sharp` (9 fall: upload
  → 3 varianter, nyckel­format, ersätt raderar gammalt prefix, 415/400, delete).
- [ ] Verifiera live: ladda upp en JPEG i garderobsvyn → bild syns → ladda upp
  en ny → kontrollera i Cloudflare-dashboarden att det gamla prefixet är borta.

---

## Fas 6 – Frontend: garderobsvy

### 6a – garderobsvyn (Fas 3-funktioner, gjord före Fas 4–5)

- [x] `public/index.html` byggd om till garderobsvyn: topbar (titel, palett­växlare,
  logga ut), verktygsrad (+ Nytt plagg, filter på tagg/betyg/arkiverad), rutnät
  av plaggkort. Palett-tokens genomgående.
- [x] `public/js/index.js` – `authFetch` mot `/api/garments`, `/api/tags`; skapa
  plagg, sätt betyg (1–5 stjärnor), lägg till/ta bort taggchips (datalist med
  befintliga taggar), redigera `notes` (spara vid blur), arkivera/återställ,
  ta bort. Varje mutation laddar om lista + taggar så filter/räknare stämmer.
- [x] Platshållare för bild i kortet ("Bilduppladdning kommer i Fas 5").
- [x] CSP-fix: palett-boot flyttad från inline `<script>` till
  `public/js/palette-boot.js` (script-src `'self'` blockerar inline).
- [x] Verifierat i webbläsaren på live-URL:en (skapa/betyg/tagg/anteckning/
  filter/arkivera/ta bort fungerar).

### 6b – bild i garderobsvyn (efter Fas 5)

- [x] Kortets bildyta är en `<label>` med dold `<input type="file"
  accept="image/jpeg,image/png,image/webp,image/heic,image/heif">`. Har plagget
  en bild visas `thumb` (cover), annars "Klicka för att lägga till bild".
- [x] `PUT /api/garments/:id/image` som `multipart/form-data`; klientkoll på
  storlek < 20 MB; `busy`-tillstånd på bildytan under uppladdning.
- [x] "Byt bild" = ny uppladdning ersätter. "Ta bort bild"-knapp när bild finns
  (`DELETE /api/garments/:id/image`).
- [x] `imgSrc` i CSP tillåter redan `https:` → R2-signerade URL:er funkar utan
  ändring. (Strama åt till R2-endpointen senare om vi vill.)
- [ ] Verifiera i webbläsaren: skapa plagg → ladda upp bild → syns i rutnätet →
  byt bild → ta bort bild.

---

## Fas 7 – Frontend: outfit-byggare

- [x] Delade UI-delar brutna ut: `public/css/app.css` (chrome + komponenter,
  laddas av båda sidorna) och `public/js/shared.js` (`api`, `starRow`,
  `tagChips`, `tagAddForm`, …). `index.js` refaktorerad att använda dem.
- [x] Nav i topbaren: **Garderob | Outfits** på båda sidorna.
- [x] `public/outfits.html` + `public/js/outfits.js` – rutnät (3 per rad) där
  varje outfit visas som en collage-cover av sina plaggs `thumb`-bilder +
  namn + betygsbadge. Klick → detaljdialog.
- [x] Detaljdialog: redigera `name`, betyg (1–10), taggar, `notes`; lista över
  ingående plagg med ×; "+ Lägg till plagg" öppnar en väljare med garderobens
  övriga plagg; ta bort outfit. "+ Ny outfit" skapar och öppnar dialogen.
- [x] Verifierat med jsdom (19 fall: skapa, lägg till/ta bort plagg via väljare,
  betyg, namnbyte, tagg, rutnät-cover, radera) + wardrobe-regression (12 fall).
- [ ] Verifiera live: skapa outfit → lägg till plagg med bild → syns i rutnätet
  som collage → betygsätt/tagga → ta bort.

---

## Iterationer efter Fas 6 (användarfeedback 2026-09-08)

- [x] **Betyg 1–10** (var 1–5). Migration `009_widen_rating_to_10.sql`
  (DROP + ADD CHECK, idempotent); zod `max(10)` i garments/outfits; 10 stjärnor
  i detaljvyn.
- [x] **Filtrera på flera taggar** med **Någon/Alla**-växel. `?tag=` upprepas,
  `?match=any|all`; backend: `EXISTS` resp. `count(DISTINCT lower(name)) = N`.
  Verktygsraden visar användarens taggar som växelchips.
- [x] **Bildrutnät i huvudvyn** – 3 per rad, **bara bilden** (liten betygsbadge).
  Klick öppnar en `<dialog>` med detaljerna (bild, betyg, taggar, notes,
  arkivera, ta bort).
- [x] **Palettväxlare = dropdown med färgrutor** i stället för "Palett: Dämpad".
  `theme.js` bygger knapp + meny i `[data-palette-picker]`; login/register
  använder samma via `.palette-float`.
- [x] **Mobil taggning:** tagg läggs till via ett `<form>` (submit funkar med
  mobiltangentbordets Enter/Klar) + "Lägg till"-knapp.
- [ ] Verifiera live: betyg upp till 10, multi-tagg-filter med Alla/Någon,
  rutnät → klick → detalj, palettdropdown, lägga tagg på mobil.

### Andra iterationen (2026-09-08)

- [x] **Palettnamnen borttagna** – dropdownen visar bara färgrutor (namn kvar
  som `aria-label`).
- [x] **Fritextsök bland taggar** – sökfält i taggfiltret som prefix-filtrerar
  chippen i realtid. Delad komponent `createTagFilter` i `shared.js` (används
  av båda sidorna).
- [x] **"Använd"-knapp** på outfit *och* plagg. Datumfält förifyllt med idag,
  redigerbart. `POST /api/{outfits,garments}/:id/wear`. Outfit-wear skapar
  även en `garment_wears`-rad per ingående plagg. Migration `010_create_wears.sql`.
- [x] **Användningsstatistik** – `wearCount` + `lastWornOn` på plagg och outfits,
  visas i detaljvyerna och på outfit-korten.
- [x] **Sortering** i båda vyerna: senast tillagd / betyg / senast använd /
  mest använd (`?sort=`). ORDER BY på härledda wear-kolumner.
- [x] **Tydligare Någon/Alla** – bytt till segmenterad kontroll + förklarande
  bildtext ("Visar plagg med **minst en** av de 2 valda taggarna" / "med
  **alla** 2 valda taggarna").
- [x] Verifierat med jsdom (17 fall: sök, bildtext, sort, wear, palett) +
  route-test (8 fall: sort, wear-endpoints, datumvalidering) + outfit-regression.
- [ ] Verifiera live: sök tagg, "använd" outfit → plaggens räknare ökar,
  sortera på mest/senast använd, palettdropdown utan namn.

### Tredje iterationen (2026-09-08)

- [x] Taggchippen ligger på **en rad** som scrollar i sidled (`overflow-x`),
  ingen radbrytning.
- [x] **Någon/Alla-knappen flyttad intill sökfältet**; texten "Någon" →
  "Någon av taggarna".
- [x] **Oanvända taggar raderas automatiskt** – `tagService.pruneOrphans`
  körs först i `listForUser` (`GET /api/tags`), som frontend alltid hämtar
  efter en ändring.
- [x] **Sortering som ikonknapp + meny** (`createSortMenu` i `shared.js`) i
  stället för en `<select>` som visade valt alternativ. Menyn markerar det
  aktiva valet med ✓; knappen visar bara en ikon.
- [x] Verifierat med jsdom (22 fall) + route-test + laddningstest av båda sidorna.

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
`008_create_tags.sql`, `009_widen_rating_to_10.sql`, `010_create_wears.sql`
