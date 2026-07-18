# Chat-chattaren

En Chrome-tillägg (MV3) som för kundtjänstchatten åt dig. Du pekar ut chattens fält en
gång, skriver ditt ärende, och en LLM föreslår nästa meddelande — **du godkänner varje
sändning**. Ingen widget-detektering, ingen server, ingen inloggning: du använder din egen
OpenRouter-nyckel.

[![Patreon](https://img.shields.io/badge/Patreon-AndersBjarby-f96854?logo=patreon)](https://www.patreon.com/AndersBjarby)

## Så funkar det

1. Öppna företagets chatt själv så minst ett meddelande syns.
2. Klicka på tilläggets ikon → en sidopanel öppnas.
3. Skriv ditt ärende ("pengarna tillbaka för order 12345, den kom trasig") och de fakta
   verktyget får använda.
4. Peka ut tre saker i chatten: **skrivfältet**, **meddelandelistan** och **skicka-knappen**.
5. Klicka **Starta**. Verktyget läser motpartens svar och föreslår nästa meddelande.
6. Du ser utkastet ordagrant och klickar **Skicka**, **Redigera**, **Hoppa över** eller
   **Avsluta**. Stänger du panelen dör sessionen — det är stoppknappen.

## Installera (utvecklarläge)

1. `chrome://extensions` → slå på **Utvecklarläge**.
2. **Läs in okpackad** → välj den här mappen.
3. Skapa en nyckel på [openrouter.ai/keys](https://openrouter.ai/keys) och fyll på lite
   kredit. Ett helt samtal kostar några kronor (Grok 4.5 med reasoning är dyrare än en
   lättviktsmodell — kostnadstak på ~7,50 kr per session skyddar plånboken).

Modell: `x-ai/grok-4.5` (reasoning på — den tänker igenom sina grepp mot tröga bottar).

## Säkerhet — hårda spärrar (kod, inte prompt)

Dessa körs på det *utgående* meddelandet och överlever prompt injection:

- **Personnummer och kortnummer** (form + Luhn, personnummer först) → blockeras helt, ingen
  "skicka ändå".
- **Inloggningsuppgifter** (BankID, lösenord, engångskod, CVV) → blockeras helt.
- **AI-förnekelse** ("jag är en människa") → blockeras helt. Ingen inställning återaktiverar.
- **Faktagrundning**: varje ordernummer, datum, belopp och mejladress i ett utkast måste
  finnas i din faktaruta eller i text motparten själv skrev. Uppdiktade uppgifter blockeras
  (du kan godkänna om du vet att de stämmer — de källtaggas i panelen).
- **Bindande åtaganden och juridik** (accepterar/godkänner/säger upp; ARN, Konsumentverket)
  → alltid över till dig.
- **Bilaga-begäran** ("skicka en bild på varan") → över till dig, verktyget kan inte bifoga.
- **Strikt alternering**: aldrig två sändningar utan ett nytt svar emellan.
- **Tak**: 8 meddelanden · 30 anrop · 15 min · ~1 kr · minst 3 s mellan sändningar.
- **Närvaro**: skriver eller klickar du själv i chatten dör sessionen direkt.

## Ärliga gränser

- **v1 är co-pilot.** Inget skickas utan att du klickar. Det finns inget autoläge — trygghet
  förtjänas, och det finns ingen fältdata än.
- Verktyget kan formulera sig klumpigt eller missförstå ett svar. **Läs innan du skickar.**
- Det kan påstå obekräftbara saker om ärendets historik ("jag ringde förra veckan") som
  ingen kodspärr fångar. Håll faktarutan sann och läs utkasten.
- **Många företags villkor förbjuder automatiserad kontakt.** Du agerar i ditt eget ärende,
  i ditt namn — men villkoren skiljer sällan på det. Risken är liten men verklig, och din.
- Cross-origin widget-iframes (Intercom/Zendesk) kräver att du beviljar behörighet för både
  sajtens och widgetens adress när du klickar Starta.
- Väldigt långa trådar som laddar om sig (virtualisering) kan tappa toppen ur modellens
  kontext. För en nyss öppnad supportchatt är det inget problem.
- Din OpenRouter-nyckel sparas okrypterat i webbläsarens lagring på den här datorn.

## Utveckling

```bash
./run-tests.sh              # hela testsviten (node --test, jsdom som dev-beroende)
python3 -m http.server 8199 # och öppna test/harness.html för DOM-tester i riktig webbläsare
```

Arkitektur: sidopanelen äger sessionen och LLM-anropet (nyckeln bor där, aldrig i sidan);
content-scriptet äger DOM:en och den billiga settle-grinden; service workern äger ingenting.
Selektorer härleds ur dina klick med Playwrights rankning och läks via fingeravtryck.

## Första riktiga test — vad man kollar

1. **Når pickern in i widget-iframen?** Testa i ordning: en hemsnickrad `<textarea>`,
   Intercom, Zendesk messaging, Drift. Markerar klicket ingenting i en cross-origin widget
   behövs behörighetsbegäran (site + widget-origin) före pick.
2. **Knappdrivna bottar** (Intercom Fin): syns chips som `replies[]`, och klickas rätt chip?
3. **Onboarding-väggen**: förstår en icke-utvecklare OpenRouter-steget och att chatten måste
   öppnas först?
