# Outfitler – Bildhantering

> Detaljplan för avsnitt 4 i [`outfitler_overview.md`](outfitler_overview.md).
> Status: **beslutad** – redo för implementation. Besluten och deras
> motivering finns i avsnitt 10.

## Sammanfattning

- **Lagring:** Cloudflare R2 (S3-kompatibel objektlagring), privat bucket.
  Bilderna serveras via Cloudflare-CDN på egen subdomän med signerade URL:er.
- **Bearbetning:** vid uppladdning, i Node med `sharp`. Rotera enligt EXIF,
  strippa EXIF (GPS!), transkoda allt till WebP.
- **Arkivkopia:** nedskalad till max 2560 px långsida (inte orörd original).
- **Derivat:** `thumb` 500 px och `card` 1000 px, genereras direkt vid uppladdning.
- **En bild per plagg.** Vill man byta bild ersätter man den befintliga.
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

Byte av bild: samma endpoint. Nytt `imageId` (ny nyckel-prefix) genereras så
URL:en ändras och den oföränderliga cachen inte krockar; den gamla bildens
objekt raderas ur R2 efter att den nya skrivits och metadatan uppdaterats.

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
- Behåller ändå tillräckligt för senare bakgrundsborttagning eller ny beskärning
  (sådana modeller skalar ändå ner indata).

Beslut: alltid nedskalad `archive`, ingen orörd original sparas (avsnitt 10).

Retina: en tilltagen storlek per kontext (500/1000) duger på 2×-skärmar utan att
fördubbla antalet filer. `srcset` med 2×-varianter kan läggas till senare.

## 4. Maxstorlek på uppladdning

- **Tak: 20 MB per fil.** Moderna telefonbilder är 2–6 MB – gott om marginal
  utan att bjuda in missbruk.
- **Tillåtna typer:** `image/jpeg`, `image/png`, `image/webp`, `image/heic`,
  `image/heif`. Allt annat avvisas direkt.
- **Exakt en bild per plagg** – se avsnitt 10.

## 5. URL:er, åtkomst och integritet

- **Privat bucket.** En garderob är personlig – ingen public access, ingen
  publik custom domain.
- Nycklar: `users/{userId}/garments/{garmentId}/{imageId}/{variant}.webp`
  där `imageId` är en slumpmässig UUID → inte gissningsbara.
- Appen skapar **signerade GET-URL:er** mot R2:s S3-endpoint
  (`https://<account>.r2.cloudflarestorage.com`). TTL 7 dygn = SigV4:s
  maxgräns för presignerade URL:er. Signeras vid läsning (när en vy hämtar
  plagg) och skickas med till klienten.
- Proxa **inte** bilder genom Express i produktion – Railway-egress. Klienten
  hämtar direkt från R2 med den signerade URL:en.
- `Cache-Control: public, max-age=31536000, immutable` sätts på objekten vid
  uppladdning (webbläsarcache nu, edge-cache senare).
- **Senare:** en Cloudflare Worker på `img.outfitler.app` som gör en riktig
  auth-koll och ger edge-cache + snyggare URL:er. Utan den går signerade
  GET:ar direkt till R2 – fungerar, privat och billigt, men ingen edge-cache.

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

Eftersom det är exakt en bild per plagg läggs bildfälten direkt på
`garment`-raden – ingen separat tabell behövs:

```
garment (
  ...
  image_key_prefix text null,   -- users/{userId}/garments/{garmentId}/{imageId}
  image_variants   jsonb null,  -- { thumb: {w,h}, card: {w,h}, archive: {w,h} }
  image_width      int null,
  image_height     int null,
  image_bytes      int null,
  image_hash       text null,   -- integritetskoll
  image_updated_at timestamptz null
)
```

Spara bara `image_key_prefix` + variantkarta; bygg URL:erna vid läsning.

Om outfits senare ska ha egen bild görs samma sak på `outfit`-raden. En separat
`image`-tabell införs bara om något plagg/outfit ska ha flera bilder – vilket
inte är planerat.

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

Antaganden: en bild per plagg → 3 lagrade objekt (thumb ~25 KB + card ~90 KB
+ archive ~400 KB ≈ **0,5 MB/plagg**) och ~3–4 skrivoperationer per uppladdning.
Läsningar träffar R2 bara vid cache-miss. Aktiv användare ≈ 500 plagg.

| Skala | Lagring | Månadskostnad |
|---|---|---|
| **Bara jag** (~500 plagg, ~250 MB) | inom gratis | **$0** |
| **100 aktiva användare** (~25 GB) | 15 GB × $0,015 | **~$0,25–0,70** |
| **1 000 aktiva användare** (~250 GB) | $3,60 lagring + läsningar ~$7–10 + skrivtoppar vid onboarding | **~$12–18** |

Tumregel: **~$0,015 per GB lagrad + ~$0,36 per miljon bildladdningar som missar
cachen.** Solo-fallet ligger inom gratisnivån i praktiken för alltid.

Att hålla koll på:

- Proxa inte bilder genom appen i produktion (Railway-egress).
- Onboarding av många användare samtidigt kan tillfälligt spränga 1M-gränsen
  för skrivoperationer (engångskostnad, inte löpande).
- Class B (läsningar vid cache-miss) är den rörligaste posten – långa
  `immutable`-headers och CDN framför håller den låg.

## 10. Beslut

### 1. R2 från start (inte Railway-volym först)

**Beslut:** Cloudflare R2 redan i v1.

Motivering: setupen är ~5 miljövariabler och en bucket. `ImageStore`-adaptern
(avsnitt 6) gör oss ändå inte inlåsta. Att börja med volym och migrera senare
är strikt mer jobb – datamigrering plus omskrivna URL:er – och volymens
ekonomi (betald egress per visning) är sämre från dag ett. Ingen situation
gör volymen till det bättre valet för den här appen.

### 2. Alltid nedskalad `archive`, ingen orörd original

**Beslut:** varje bild sparas som mest i `archive`-storlek (≤ 2560 px, WebP q82).
Orörd original sparas inte.

Motivering: ingen planerad funktion behöver full upplösning. 2560 px räcker för
fullskärm på retina och för framtida bakgrundsborttagning/AI (de modellerna
skalar ner indata ändå). Sparar 60–70 % lagring. Omprövas bara om en konkret
funktion kräver mer – då kan "behåll original" bli ett per-bild-tillval.

### 3. Signerade GET-URL:er (inte proxy via appen)

**Beslut:** appen mintar signerade GET-URL:er mot R2:s S3-endpoint (TTL 7 dygn),
klienten hämtar direkt därifrån.

Motivering: proxy genom Express innebär Railway-egress på varje bildvisning –
det tar bort hela poängen med R2 – plus extra CPU och latens. Nackdelen med
signerade URL:er (en länk kan delas vidare under sin TTL) är acceptabel för en
garderobsapp; nycklarna är ändå ogissningsbara UUID:er. Skarpare kontroll och
edge-cache läggs senare via en Cloudflare Worker på `img.outfitler.app` (se
avsnitt 5).

### 4. Bakgrundsborttagning: senare funktion, inte v1

**Beslut:** ingen automatisk bakgrundsborttagning / vit bakgrund i v1.

Motivering: det är en produktförbättring, inte kärnan i "överblick över
garderoben". Det drar in ett beroende (tjänst som remove.bg, egen modell, eller
Cloudflare AI) och en kostnad. `archive`-kopian bevarar möjligheten. Designa
bildpipelinen (avsnitt 2) så att ett sådant steg kan skjutas in senare utan
omskrivning.

### 5. Exakt en bild per plagg

**Beslut:** ett plagg har noll eller en bild. Vill man ha en annan bild
ersätter man den befintliga (ladda upp ny → gammal raderas).

Motivering: håller datamodellen platt (bildfälten ligger direkt på
`garment`-raden, avsnitt 7), garderobsvyn och detaljvyn blir enkla, och
lagrings- och operationskostnaden blir helt förutsägbar. Ingen bildkarusell,
ingen "välj huvudbild"-logik. Om behovet av flera bilder dyker upp senare är
det en avgränsad utökning (separat `image`-tabell + galleri-UI).

### 6. Uppladdning via appen (inte presignerad PUT) i v1

**Beslut:** `POST /api/images` (multipart, 20 MB-tak), `sharp` bearbetar
synkront server-side, resultatet läggs i R2.

Motivering: en kodväg, full kontroll över bearbetningen, ingen kö- eller
event-infrastruktur. Bild-bytes går genom Railway *vid uppladdning* (sällan),
inte vid visning (ofta) – så egress-påverkan är försumbar. Omprövas om
uppladdningslatens eller minne blir ett problem; adaptern och endpoint-formen
gör bytet till presignerad PUT lokalt avgränsat.
