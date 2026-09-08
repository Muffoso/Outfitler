# Outfitler – Översikt

> **Status: PLATSHÅLLARE.** Detta dokument ska fyllas i innan större implementation
> påbörjas. CLAUDE.md kräver att hela filen läses in i varje konversation – håll
> den därför koncis och beslutsorienterad.

## 1. Produktvision

Outfitler är en web app för att skapa översikt över alla sina klädesplagg och hur
de kan kombineras ihop till outfits. Användaren kan ge varje klädesplagg och outfit
taggar, ratings m.m. för att kunna filtrera med m.m.

_TODO: mål, målgrupp, avgränsningar (vad appen INTE ska vara)._

## 2. Datamodell

_TODO: definiera entiteter, fält och relationer._

- **Plagg (garment)** – _TODO: t.ex. namn, kategori, färg, märke, bild, anteckningar_
- **Outfit** – _TODO: en namngiven samling plagg + metadata_
- **Tagg** – _TODO: fritt definierade taggar, kopplade till plagg och/eller outfits_
- **Rating** – _TODO: skala och betydelse, per plagg och per outfit_

## 3. Huvudfunktioner

_TODO: prioriterad ordning._

- Lägga till / redigera / ta bort plagg
- Skapa outfits av plagg
- Tagga och rata plagg och outfits
- Filtrera och söka på taggar, rating, kategori m.m.

## 4. Bildhantering

_TODO: var lagras bilder (Railway-volym, extern bucket, ...), uppladdningsflöde,
storlekar/thumbnails, maxstorlek._

## 5. UI-vyer

_TODO: huvudvyer – garderobsöversikt, outfit-byggare, detaljvy för plagg/outfit,
filterpanel._

## 6. Färgpalett

### Princip

Appen visar mest av allt **användarens egna foton på kläder** – i alla tänkbara
färger. Gränssnittets färger måste därför **dra sig tillbaka** och aldrig
konkurrera med eller "skära sig" mot ett plagg i bild. Regeln är: låg mättnad,
neutral grund, **en enda** dämpad accentfärg, och semantiska färger enbart som
återkoppling (aldrig som dekoration). Undvik rena, högmättade toner (klarröd,
koboltblå, lime) – de krockar hårdast med foto.

### Neutraler (gränssnittets arbetshästar)

`#FAFAF8` – "Porslin": appens bakgrund (nätt varm off-white).
`#FFFFFF` – "Ren vit": kort och ytor som bär plaggbilder; ger en lugn ram runt fotot.
`#EEEDE9` – "Dimma": input-fält, hover, sekundära ytor.
`#DAD8D2` – "Kalksten": kanter och avdelare.
`#6E6B64` – "Sten": sekundär text, ikoner, platshållartext.
`#33322F` – "Grafit": primär brödtext.
`#1C1C1B` – "Kol": rubriker och text med hög betoning.

### Accent (endast en)

`#42566A` – "Skifferblå": primära knappar, länkar, aktiva filter, fokusram. Så
låg mättnad att den står lugnt intill vilken plaggfärg som helst.
`#E6EBEF` – "Skiffer ljus": bakgrund för valt/aktivt tillstånd (markerad tagg, vald outfit).

### Semantiska färger (endast återkoppling)

`#5C7C5A` – "Salvia": lyckat resultat, sparat, positivt.
`#B3893F` – "Ockra": varning.
`#A65450` – "Tegel": destruktiv åtgärd, fel (dämpad – inte firebrick).

### Taggar och ratings

- **Taggchips** är neutrala som standard (Dimma-bakgrund, Grafit-text). Användaren
  skapar godtyckliga taggar – att färgkoda varje tagg skulle göra garderobsvyn
  rörig. Ev. färgkodning senare hämtas från en fast lågmättad uppsättning.
- **Rating** visas med ifylld vs. kontur i Grafit. Om stjärnor måste läsas tydligt
  som betyg används dämpad bärnsten `#C99A4E` sparsamt.

### Mörkt läge

`#1A1A19` bakgrund · `#242422` yta · `#3A3934` kanter · `#EDEBE6` primär text ·
`#A6A29A` sekundär text · accent `#8FA6BA` · Salvia `#89A886` · Ockra `#D3AA63` ·
Tegel `#C98984`.

_TODO: bekräfta paletten mot riktiga plaggbilder; besluta om mörkt läge ska med i v1._

## 7. Teknisk plattform

- Web app (HTML/CSS/Vanilla JS) byggd på auth-templaten `webapp-with-auth-template`
- Node.js / Express, PostgreSQL på Railway.app
- Autentisering: JWT + Google OAuth (klart)
- DB-migrationer via `src/scripts/migrate.js`; appen kör som begränsad `app_user`
- Deploy: push till `main` → Railway auto-deployar

_TODO: arkitekturprinciper, lagerindelning (UI / logik / data), namn- och
mappkonventioner._

## 8. Öppna frågor

_TODO._
