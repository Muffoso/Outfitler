# Outfitler – Bildhantering

> Detaljplan för avsnitt 4 i [`outfitler_overview.md`](outfitler_overview.md).
> Status: **förslag** – de öppna besluten sist i dokumentet ska bekräftas
> innan implementation.

## Sammanfattning

- **Lagring:** Cloudflare R2 (S3-kompatibel objektlagring), privat bucket.
  Bilderna serveras via Cloudflare-CDN på egen subdomän med signerade URL:er.
- **Bearbetning:** vid uppladdning, i Node med `sharp`. Rotera enligt EXIF,
  strippa EXIF (GPS!), transkoda allt till WebP.
- **Arkivkopia:** nedskalad till max 2560 px långsida (inte orörd original).
- **Derivat:** `thumb` 500 px och `card` 1000 px, genereras direkt vid uppladdning.
- **Uppladdningstak:** 20 MB/fil. Tillåtna typer: JPEG, PNG, WebP, HEIC/HEIF.
- **Abstraktionslager:** ett litet `ImageStore`-interface så R2 kan bytas mot
  disk / S3 / B2 utan att röra applogiken.

## 1. Var bilderna lagras

### Förslag: Cloudflare R2

Argument:

1. **Noll egress-avgift.** En garderobsapp är till största delen bildvisning.
   Railway debiterar utgående bandbredd, och en volym serveras dessutom genom
   Node-processen. R2 tar betalt för lagring och operationer men inget för
   trafik ut – bilder som visas om och om igen blir gratis att leverera.
2. **Frikopplar lagring från drift.** Omdeployer, regionbyten, att skala till
   fler instanser eller byta hostingleverantör rör inte bilderna. En
   Railway-volym är låst till en tjänst och en instans.
3. **S3-kompatibelt API.** Väl understött SDK (`@aws-sdk/client-s3`), portabelt
   till AWS S3 eller Backblaze B2 senare via en driver-ändring.
4. **CDN framför utan extra jobb.** R2 kopplas till Cloudflares nät med custom
   domain (`img.outfitler.app`) och global cache. En Railway-volym har ingen CDN.
5. **Kostar i praktiken noll länge.** Se kostnadsavsnittet nedan.

### Förkastade alternativ

| Alternativ | Varför inte |
|---|---|
| **Bilder i Postgres (BYTEA)** | Blåser upp DB-storlek och backuptider, tvingar bild-bytes genom query-minnet, ingen CDN. Antimönster. |
| **Railway persistent volume** | Enklast (ingen ny leverantör), men: betald egress, serveras via Node, ingen CDN, en enda instans, svår att komma åt filerna utanför containern. Endast tänkbar som v1-nödlösning, och bara om `ImageStore`-adaptern (avsnitt 6) finns så bytet blir smärtfritt. |
| **Cloudinary / Cloudflare Images** | Managed bildtransformation on-the-fly. Dyrare vid låg skala, mer inlåsning, och vi behöver bara ett fåtal fasta storlekar. Kan läggas ovanpå R2 senare. |

## 2. Bearbetning: vid uppladdning, inte per förfrågan

Flöde: klienten laddar upp till `/api/images` → appen bearbetar med `sharp` →
lägger `archive` + derivat i R2 → metadata till Postgres.

Argument:

- **Känd, liten uppsättning visningskontexter:** garderobsrutnät, detaljvy,
  outfit-byggare, zoom. Godtycklig storleksändring per request vore slöseri.
- **Förutsägbar CPU-last.** `sharp` klarar en telefonbild på under en sekund –
  en gång vid uppladdning är billigt; per visning är det inte det.
- **Enkel cachning.** Färdiga derivat med oföränderliga URL:er →
  `Cache-Control: public, max-age=31536000, immutable`. Inga invalideringar.
- Direktuppladdning till R2 med presignerad PUT + asynkron bearbetning är ett
  alternativ om uppladdning blir en flaskhals, men fler rörliga delar (kö,
  event-triggers) än det är värt nu.

Alltid vid bearbetning:

- `.rotate()` först – respektera EXIF-orientering innan pixlar skrivs.
- Strippa EXIF i utdata – telefonbilder bär **GPS-position** för hemmet.
- Transkoda allt till **WebP** (universellt stöd; AVIF kan läggas till för
  thumbs senare men är långsammare att koda).
- HEIC (iPhones standard) avkodas av `sharp`s förbyggda binär – vi tar emot
  och transkodar till WebP.
- Validera riktigt filinnehåll (magic bytes), inte bara `Content-Type`-headern.

## 3. Storlekar och format

| Variant | Långsida | Kvalitet | Ungefärlig vikt | Används till |
|---|---|---|---|---|
| `thumb` | 500 px | WebP q72 | 15–35 KB | Garderobsrutnät |
| `card` | 1000 px | WebP q78 | 60–120 KB | Detaljvy, outfit-byggare |
| `archive` | ≤ 2560 px | WebP q82 | 250–550 KB | Zoom/lightbox + framtida ombearbetning |

Argument för nedskalad arkivkopia i stället för orörd original:

- En 4032×3024-telefonbild ger ingen praktisk nytta i en garderobsapp;
  2560 px räcker för fullskärm på retina.
- Sparar 60–70 % lagring per bild.
- Behåller ändå tillräckligt för senare bakgrundsborttagning eller ny beskärning.
- Om vi vill köra AI / bakgrundsborttagning på bästa möjliga kvalitet kan
  "spara orörd original" göras till ett tillval – men default bör vara nedskalat.

Retina: en tilltagen storlek per kontext (500/1000) duger på 2×-skärmar utan att
fördubbla antalet filer. `srcset` med 2×-varianter kan läggas till senare.

## 4. Maxstorlek på uppladdning

- **Tak: 20 MB per fil.** Moderna telefonbilder är 2–6 MB – gott om marginal
  utan att bjuda in missbruk.
- **Tillåtna typer:** `image/jpeg`, `image/png`, `image/webp`, `image/heic`,
  `image/heif`. Allt annat avvisas direkt.
- Rimlig gräns på antal bilder per plagg (förslag: 8) för att hålla vyer och
  kostnad i schack.

## 5. URL:er, åtkomst och integritet

- **Privat bucket.** En garderob är personlig.
- Nycklar: `users/{userId}/garments/{garmentId}/{imageId}/{variant}.webp`
  där `imageId` är en slumpmässig UUID → inte gissningsbara.
- Appen skapar **signerade GET-URL:er** (giltiga ~7 dygn, matchar
  cache-livslängden). Proxa **inte** bilder genom Express i produktion – då
  betalar vi Railway-egress igen; signerade URL:er direkt mot CDN är poängen.
- Custom domain `img.outfitler.app` → R2 via Cloudflare.
- `Cache-Control: public, max-age=31536000, immutable` på alla varianter.

## 6. Abstraktionslager

```js
interface ImageStore {
  put(key, buffer, contentType): Promise<void>
  signedUrl(key, ttlSeconds): Promise<string>
  delete(keys: string[]): Promise<void>
}
```

- Driver `r2` i produktion.
- Driver `local` (disk) om appen någon gång ska köras lokalt, `memory` för test.
- Applogiken känner bara till interfacet – byte av leverantör är en config-ändring.

Miljövariabler (Railway): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_HOST` (t.ex.
`img.outfitler.app`).

## 7. Datamodell

Hör ihop med avsnitt 2 i [`outfitler_overview.md`](outfitler_overview.md).

```
image (
  id           uuid pk,
  user_id      fk,
  garment_id   fk null,     -- alt. outfit_id; polymorft eller två kolumner
  key_prefix   text,        -- users/{userId}/.../{imageId}
  variants     jsonb,       -- { thumb: {w,h}, card: {w,h}, archive: {w,h} }
  orig_width   int,
  orig_height  int,
  bytes        int,
  content_hash text,        -- dedupe + integritetskoll
  created_at   timestamptz
)
```

Spara bara `key_prefix` + variantkarta; bygg URL:erna vid läsning.

## 8. Backup

R2 och Postgres måste backas upp var för sig. Förlorad R2-data utan förlorad DB
= trasiga thumbnails överallt.

- Aktivera versioning på bucketen, eller periodisk synk till en andra
  bucket/leverantör.
- Livscykelregel som städar bort föräldralösa objekt (bilder vars plagg
  raderats) så lagringen inte läcker.
- Railways Postgres-backup täcker metadatan.

## 9. Kostnad

Cloudflares publika R2-priser (kontrollerad jan 2026 – verifiera på
`developers.cloudflare.com/r2/pricing`):

| Post | Pris | Gratis / månad |
|---|---|---|
| Lagring | $0,015 / GB / månad | 10 GB |
| Class A-operationer (skriv: upload, delete, list) | $4,50 / miljon | 1 miljon |
| Class B-operationer (läs: GET, HEAD) | $0,36 / miljon | 10 miljoner |
| **Egress (trafik ut)** | **$0** | obegränsat |

Ingen obligatorisk minimiavgift – R2 ingår i Workers Free-planen (kort krävs,
men $0 under gratisnivån).

Antaganden: varje uppladdad bild → 3 lagrade objekt (thumb ~25 KB + card ~90 KB
+ archive ~400 KB ≈ **0,5 MB/bild**) och ~3–4 skrivoperationer. Läsningar träffar
R2 bara vid cache-miss.

| Skala | Lagring | Månadskostnad |
|---|---|---|
| **Bara jag** (~750 bilder, ~375 MB) | inom gratis | **$0** |
| **100 aktiva användare** (~37 GB) | 27 GB × $0,015 | **~$0,40–1** |
| **1 000 aktiva användare** (~375 GB) | $5,50 lagring + läsningar ~$10–13 + skrivtoppar vid onboarding | **~$18–25** |

Tumregel: **~$0,015 per GB lagrad + ~$0,36 per miljon bildladdningar som missar
cachen.** Solo-fallet ligger inom gratisnivån i praktiken för alltid.

Att hålla koll på:

- Proxa inte bilder genom appen i produktion (Railway-egress).
- Onboarding av många användare samtidigt kan tillfälligt spränga 1M-gränsen
  för skrivoperationer (engångskostnad, inte löpande).
- Class B (läsningar vid cache-miss) är den rörligaste posten – långa
  `immutable`-headers och CDN framför håller den låg.

## 10. Öppna beslut

1. **R2 nu**, eller Railway-volym som v1 med adaptern som skydd?
   (Rekommendation: R2 direkt – ~5 env-vars, och egress-frågan försvinner permanent.)
2. **Spara orörd original** som tillval, eller alltid nedskalad `archive`?
3. **Signerade URL:er** (enklare) vs **proxy via appen** (starkare kontroll)?
4. Behöver v1 **bakgrundsborttagning / vit bakgrund** på plaggbilder, eller är
   det en senare funktion?
5. **Max antal bilder per plagg?** (förslag: 8)
6. **Uppladdningsflöde:** via appen (enkelt, valt ovan) eller presignerad PUT
   direkt till R2 (skalar bättre, mer komplext)?
