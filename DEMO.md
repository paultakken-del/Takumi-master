# Demo-script webinar september — "De nieuwste AI-architectuur is 400 jaar oud"

> Webinar verplaatst naar september — extra tijd benut voor Fase 2 (auth, cross-client, registry). Zie ROADMAP-FASE2.md.

## Live flow (3 min)

1. **Setup-zin:** "Takumi handelt nooit. Maar oordelen zonder waarnemen is gokken. Dus: de agent meet, Takumi weegt, ik beslis."
2. **In Claude (vers gesprek):** zeg **"ochtendpuls"**.
   - Claude leest Strava (laatste activiteit → gereden/hersteld/rust)
   - Claude leest agenda vandaag (vol/ruim)
   - Claude roept `lees_kompas` aan met `orientatie: pulse/morning` + `coordinaten`
3. **Toon het JSON-antwoord** — wijs op het `weging`-veld: element, reden, coördinaten. *"Het oordeel staat ín het antwoord. Auditbaar per aanroep."*
4. **Open app.takumi-master.com/weegschaal** — *"En dit is de hele weging. Elf regels. Geen black box. Zelfde invoer, zelfde oordeel — ook over zes maanden, als de modellen alweer drie keer gewisseld zijn."*
5. **Slotzin:** "Musashi schreef vijf elementen, geen vijfduizend parameters. Judgment-as-a-service is geen groot model — het is een klein oordeel dat stilstaat terwijl alles eromheen beweegt."

## Fallback (als live MCP hapert)

Vooraf opgenomen of dit voorbeeld-antwoord tonen:

```json
{
  "type": "morning",
  "leader": { "kanji": "火", "name": "Ka", "element": "Vuur · Energie" },
  "question": "Wat verdient je volledige energie deze ochtend?",
  "weging": {
    "element": "ka",
    "reden": "Stilstand en ruimte — vuur: wakker het voorzichtig weer aan.",
    "coordinaten": { "beweging": "rust", "agenda": "ruim" }
  }
}
```

## Checks vooraf (ochtend van de demo)

- `GET https://app.takumi-master.com/mcp` → serverInfo.version = **0.3.0**
- Vers Claude-gesprek gestart (zodat de nieuwe tool-schema geladen is)
- /weegschaal opent op telefoon én laptop
- Strava-connector geautoriseerd in de demo-account
